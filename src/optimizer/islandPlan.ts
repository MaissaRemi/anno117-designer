import { makeLookup } from "../engine/rules";
import type { AqueductTile, BuildingDef, FieldTile, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import { economy, residentialChain, upkeepOf } from "../economy/economy";
import { buildTierProfile, solve } from "../economy/solve";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";
import { planLattice } from "./planLattice";
import { planPacked } from "./packPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";
import { blockMountains, needsWater, planWater, type WaterConsumerReport, type WaterPlanResult } from "./waterPlan";
import { connectKontor, pickKontorDef, repairRoadConnectivity, reserveKontor } from "./kontor";

export interface IslandPlanRequest {
  catalog: BuildingDef[];
  grid: GridShape;
  /** Archetype d'île : population (défaut, mode import) ou production (export). */
  mode?: "population" | "production";
  tierGuid: string; // tier-cible (ex Patriciens) — mode population
  coverageFloor?: number; // 0..1, défaut 1 (seuil pour le flag feasible)
  /** "all" = tous les besoins (max bonus/maison) ; "thresholds" = sous-ensemble le
   *  moins cher atteignant les seuils d'upgrade (moins de services → plus de maisons). */
  needMode?: "all" | "thresholds";
  /** Mode production : bien cible (GUID) + débit u/min. */
  productionGood?: string;
  productionRate?: number;
  /** Fertilités/gisements disponibles sur l'île (GUIDs) — vide = toutes supposées OK. */
  islandFertilities?: string[];
  /** Hauteurs quantifiées de l'île (q = h/16, mer < 0) — pente des aqueducs.
   *  Décodées par le worker depuis terrain.generated (grid.islandId). */
  heights?: Int8Array;
}

export interface ImportGood {
  good: string;
  name: string;
  perMin: number;
}

export interface IslandPlanResult {
  mode: "import";
  tierGuid: string;
  tierName: string;
  cap: number;
  houses: number;
  fullyCovered: number; // maisons couvertes par TOUS leurs besoins (= tier-cible atteint)
  fullyCoveredPct: number; // 0..100 (fullyCovered / houses)
  /** Maisons par tier ATTEINT (guid → nb) : accounting MIXTE. Une maison sous-desservie
   *  retombe au meilleur palier atteint (min = base) — d'où residents = somme mixte. */
  tierCounts: Record<string, number>;
  residents: number; // habitants TOTAUX (mixte, tous paliers atteints)
  buildings: PlacedBuilding[]; // résidences + services + sources d'eau
  roads: RoadTile[];
  fields: FieldTile[];
  aqueducts: AqueductTile[]; // conduites d'eau (réseau source → consommateurs)
  water: {
    sources: number;
    capacity: number;
    used: number;
    consumers: WaterConsumerReport[];
  } | null; // null = aucun consommateur d'eau dans le plan
  importGoods: ImportGood[];
  coverage: CoverageReport;
  coverageMin: number; // min % parmi les services à rayon (métrique de faisabilité)
  money: { gross: number; upkeep: number; net: number };
  attributes: Record<string, number>; // bonus cumulés (maisons pleines)
  gaps: string[]; // services non plaçables / trous de couverture
  feasible: boolean; // a atteint le seuil de couverture
}

const goodName = (g: string): string => economy.goodNames[g] || g;

/**
 * Point d'entrée UNIQUE du plan d'île : dispatch par archetype (population/import
 * vs production/export) + validation des paramètres. Le worker n'est qu'un shim.
 */
export function planIsland(
  req: IslandPlanRequest,
  onProgress?: (step: number, total: number) => void,
): IslandPlanResult | ProdPlanResult {
  if (req.mode === "production") {
    if (!req.productionGood || !req.productionRate) throw new Error("Bien et débit cibles requis.");
    return planIslandProduction(
      req.catalog, req.grid, makeLookup(req.catalog),
      req.productionGood, req.productionRate,
      { islandFertilities: req.islandFertilities }, onProgress,
    );
  }
  return planIslandImport(req, onProgress);
}

/**
 * Plan d'île — mode IMPORT. Cale le maximum de résidences du tier-cible sur l'île,
 * place les services publics pour couvrir au mieux (best-effort), et renvoie le
 * manifeste des biens à importer (u/min) pour satisfaire tous les besoins.
 *
 * Production et main-d'œuvre sont supposées sur une AUTRE île : l'île principale ne
 * contient que des maisons du tier-cible + leurs services d'influence.
 */
export function planIslandImport(
  req: IslandPlanRequest,
  onProgress?: (step: number, total: number) => void,
): IslandPlanResult {
  const floor = (req.coverageFloor ?? 1) * 100;
  const needMode = req.needMode ?? "all";
  const lookup = makeLookup(req.catalog);
  const tier = economy.tiers.find((t) => t.guid === req.tierGuid);
  if (!tier || !tier.residenceId) {
    throw new Error("Tier-cible invalide ou sans résidence.");
  }
  // profil de besoins retenus (mode seuils : sous-ensemble le moins cher atteignant
  // les seuils d'upgrade) → capacité/maison + services à placer cohérents
  const profile = buildTierProfile(req.tierGuid, { needSelection: needMode });
  const cap = needMode === "thresholds" ? profile.cap : tier.capacityDefault || 10;
  const retainedServices = [...new Set(profile.services.map((s) => s.building).filter((b): b is string => !!b))];

  // capacité/maison par tier (mode seuils = profil seuils ; sinon capacité par défaut)
  const chain = residentialChain(req.tierGuid);
  const capForTier = (guid: string): number => {
    const t = economy.tiers.find((x) => x.guid === guid);
    if (!t) return 1;
    return needMode === "thresholds"
      ? buildTierProfile(guid, { needSelection: "thresholds" }).cap
      : (t.capacityDefault || 10);
  };
  const mixedResidents = (tc: Record<string, number>): number =>
    Object.entries(tc).reduce((s, [g, n]) => s + n * capForTier(g), 0);
  // en mode seuils, seuls les services RETENUS comptent pour la faisabilité/couverture-tier
  const relevant = needMode === "thresholds" ? new Set(retainedServices) : null;
  const residenceIds = new Set(chain.map((t) => t.residenceId).filter((r): r is string => !!r));

  // --- COMPTOIR (racine du réseau + entrée des imports) : réservé AVANT les moteurs ---
  // Aucun moteur n'en posait : le plan était formellement valide (sans racine,
  // rootedRoadSet accepte toutes les routes) mais injouable — sur une île d'IMPORT, les
  // 27 biens transitent par le port. On retire l'emprise du masque constructible pour que
  // les moteurs bâtissent autour, plutôt que d'avoir à raser un quartier après coup.
  const islandRegion = req.grid.islandId?.includes("celtic") ? "Celtic" : "Roman";
  const kontorDef = pickKontorDef(req.catalog, islandRegion);
  const kontor = kontorDef ? reserveKontor(req.grid, kontorDef) : null;

  // PORTFOLIO de moteurs (cf. session refonte placement) : lattice co-localisé
  // (gagne sur tiers riches en services, 11 types T4) vs houses-first min-cover
  // (gagne sur tiers à peu de types). On garde le meilleur résultat réel.
  const engineOpts = {
    coverageFloor: req.coverageFloor ?? 1,
    serviceIds: needMode === "thresholds" ? retainedServices : undefined,
  };
  // moteurs sur grille SANS les zones montagne (non constructibles en vrai, et la
  // source d'aqueduc en a besoin) ; l'eau est planifiée sur la grille d'origine
  const planGrid = blockMountains(kontor?.grid ?? req.grid);
  onProgress?.(1, 3);
  // lattice route l'eau EN COURS de placement (corridors avant les maisons)
  const candA = planLattice(planGrid, req.tierGuid, lookup, { ...engineOpts, water: true, heights: req.heights });
  onProgress?.(2, 3);
  const candB = planPacked(planGrid, req.tierGuid, lookup, engineOpts);
  const svcCount = (r: { servicesPlaced: Record<string, number> }) =>
    Object.values(r.servicesPlaced).reduce((a, b) => a + b, 0);

  // --- ÉVALUATION D'UN CANDIDAT, EAU COMPRISE ---------------------------------------
  // planLattice route l'eau PENDANT le placement et exclut déjà de son comptage les
  // services non raccordés ; packPlan ne route rien et suppose tout actif. Comparer leurs
  // `tierCounts` bruts revenait donc à opposer un candidat pénalisé par la réalité à un
  // candidat optimiste. Mesuré (île 320², cible Patriciens, mode seuils) : packPlan
  // l'emportait de 9 habitants (0,1 %), puis l'eau routée après coup ne raccordait que
  // 2/40 consommateurs — contre 30/30 pour le lattice écarté. Critère de sélection ≠
  // métrique livrée. On route donc l'eau et on applique la démotion À CHAQUE candidat
  // AVANT de trancher.
  type Cand = typeof candA | typeof candB;
  interface Evaluated {
    cand: Cand;
    water: WaterPlanResult;
    buildings: PlacedBuilding[];
    tierCounts: Record<string, number>;
    deadTypes: Set<string>;
    residents: number;
    /** part des consommateurs d'eau réellement raccordés (0..1 ; 1 si aucun) */
    waterPct: number;
  }
  const evaluate = (cand: Cand): Evaluated => {
    const water = cand.water ?? planWater(req.grid, cand.buildings, cand.roads, lookup, req.heights);
    const buildings = cand.water ? cand.buildings : [...cand.buildings, ...water.sources];
    // types de service dont AUCUN exemplaire n'est raccordé → inactifs en jeu
    const defOfUid = new Map(buildings.map((b) => [b.uid, b.defId]));
    const connectedByDef = new Map<string, number>();
    for (const c of water.consumers) {
      if (!c.connected) continue;
      const id = defOfUid.get(c.uid);
      if (id) connectedByDef.set(id, (connectedByDef.get(id) ?? 0) + 1);
    }
    const deadTypes = new Set(
      [...new Set(tier.services.map((s) => s.building))]
        .filter((id): id is string => !!id && (!relevant || relevant.has(id)))
        .filter((id) => { const d = lookup(id); return !!d && needsWater(d) && !connectedByDef.get(id); }),
    );
    // DÉMOTION : les maisons comptées à un tier « eau-bloqué » retombent au plus haut
    // tier sûr (la chaîne est nichée → le blocage est monotone), au lieu d'annuler
    // toute la population comme le faisait l'ancien gate tout-ou-rien.
    const tierSafe = (t: (typeof chain)[number]): boolean => t.services.every((s) =>
      !s.building || (relevant && !relevant.has(s.building)) ? true : !deadTypes.has(s.building));
    const tierCounts: Record<string, number> = { ...cand.tierCounts };
    let cutoff = chain.length;
    for (let k = 0; k < chain.length; k++) if (!tierSafe(chain[k])) { cutoff = k; break; }
    if (cutoff < chain.length) {
      const safeGuid = chain[Math.max(0, cutoff - 1)]?.guid;
      let moved = 0;
      for (let k = cutoff; k < chain.length; k++) { moved += tierCounts[chain[k].guid] || 0; delete tierCounts[chain[k].guid]; }
      if (moved && safeGuid) tierCounts[safeGuid] = (tierCounts[safeGuid] || 0) + moved;
    }
    const nCons = water.consumers.length;
    const nOk = water.consumers.filter((c) => c.connected).length;
    return {
      cand, water, buildings, tierCounts, deadTypes,
      residents: mixedResidents(tierCounts),
      waterPct: nCons ? nOk / nCons : 1,
    };
  };
  onProgress?.(3, 3);
  const evA = evaluate(candA);
  const evB = evaluate(candB);
  // Critère LEXICOGRAPHIQUE, faisabilité d'abord.
  //
  // 1) VIABILITÉ EAU. Un plan dont la majorité des consommateurs d'eau reste sèche n'est pas
  //    un plan valide pour ce tier : en jeu ces services sont inactifs, donc les maisons ne
  //    montent pas. Le gate par TYPE ne suffit pas à le capter (il ne démote que si AUCUNE
  //    copie n'est raccordée — 1 copie sur 21 suffit à le désarmer), d'où ce filtre explicite.
  //    C'est structurel : packPlan pose toutes ses maisons AVANT de router l'eau, il ne reste
  //    plus de corridor libre ; seul un moteur eau-aware peut être viable sur un tier à eau.
  // 2) Puis la population mixte, à 2 % près (en deçà c'est du bruit).
  // 3) Puis le taux de raccordement, la densité, et le moins de services (anti-confetti).
  const WATER_VIABLE = 0.5;
  const viable = (e: Evaluated): boolean => e.waterPct >= WATER_VIABLE;
  const better = (a: Evaluated, b: Evaluated): boolean => {
    if (viable(a) !== viable(b)) return viable(a);
    const close = Math.abs(a.residents - b.residents) <= 0.02 * Math.max(a.residents, b.residents, 1);
    if (!close) return a.residents > b.residents;
    if (a.waterPct !== b.waterPct) return a.waterPct > b.waterPct;
    if (a.cand.houses !== b.cand.houses) return a.cand.houses > b.cand.houses;
    return svcCount(a.cand) <= svcCount(b.cand);
  };
  const pick = better(evA, evB) ? evA : evB;
  const dist = pick.cand;
  const water = pick.water;
  const deadTypes = pick.deadTypes;

  // --- pose du comptoir + raccordement au réseau produit -----------------------------
  const buildings = [...pick.buildings];
  const roads: RoadTile[] = [...dist.roads];
  const kontorGaps: string[] = [];
  let removedHouses = 0;
  const tierCounts: Record<string, number> = { ...pick.tierCounts };
  if (kontor) {
    const kp = connectKontor(req.grid, kontor, buildings, roads, lookup, (id) => residenceIds.has(id));
    if (kp.connected) {
      // les maisons rasées par le stub sortent du décompte (et de leur palier)
      const tierOfRes = new Map(chain.filter((t) => t.residenceId).map((t) => [t.residenceId!, t.guid]));
      const gone = new Set(kp.removed);
      if (gone.size) {
        for (const b of buildings) {
          if (!gone.has(b.uid)) continue;
          const g = tierOfRes.get(b.defId);
          if (g && tierCounts[g]) { tierCounts[g]--; removedHouses++; }
        }
      }
      const keep = buildings.filter((b) => !gone.has(b.uid));
      buildings.length = 0;
      buildings.push(...keep, kp.building);
      const seen = new Set(roads.map((r) => `${r.x},${r.y}`));
      for (const r of kp.roads) if (!seen.has(`${r.x},${r.y}`)) { seen.add(`${r.x},${r.y}`); roads.push(r); }
    } else {
      kontorGaps.push("Comptoir non raccordable au réseau routier (île saturée ou littoral isolé)");
    }
  } else {
    kontorGaps.push("Aucun comptoir posable : pas de littoral exploitable → réseau routier sans racine");
  }

  // CONNEXITÉ : l'élagage des moteurs peut laisser des îlots de route (case d'accès dont le
  // connecteur a sauté). En jeu, un bâtiment desservi par une route coupée du comptoir est
  // INACTIF. On raccroche ce qui peut l'être et on signale le reste.
  const repair = repairRoadConnectivity(req.grid, buildings, roads, lookup);
  if (repair.orphans) {
    kontorGaps.push(`${repair.orphans} case(s) de route isolées du comptoir (bâtiments desservis inactifs en jeu)`);
  }

  const layout: Layout = { grid: req.grid, buildings, roads: repair.roads, fields: dist.fields, aqueducts: water.aqueducts };
  // couverture DISTANCE-RUE = la vraie mécanique du jeu. `requiredServices` scope le gate
  // "pleinement couverte" au sous-ensemble retenu (mode seuils), sinon tous les services.
  // `inactiveBuildings` = consommateurs d'eau NON raccordés (inactifs en jeu) → une maison
  // servie uniquement par une copie sèche n'est PAS comptée couverte (corrige l'optimisme
  // du raccordement partiel : le gate eau par-def ne voyait que le cas 0-raccordé).
  const inactiveWater = new Set(water.consumers.filter((c) => !c.connected).map((c) => c.uid));
  const coverage = analyzeCoverage(layout, lookup, {
    ...(relevant ? { requiredServices: relevant } : {}),
    inactiveBuildings: inactiveWater,
  });
  const analyzable = coverage.services.filter((s) => s.hasRadius && (!relevant || relevant.has(s.serviceId)));
  const coverageMin = analyzable.length ? Math.min(...analyzable.map((s) => s.pct)) : 100;
  const houses = dist.houses - removedHouses;
  const fullyCovered = tierCounts[req.tierGuid] || 0; // maisons AU tier-cible (tous besoins)
  const fullyCoveredPct = houses ? Math.round((fullyCovered / houses) * 100) : 0;
  // habitants = population MIXTE totale : chaque maison au tier qu'elle atteint réellement
  // (cible où couvert, palier inférieur ailleurs). Densité max, aucune terre gâchée.
  const residents = mixedResidents(tierCounts);

  // manifeste d'import : vecteur de population MULTI-TIERS (solve gère plusieurs tiers)
  const capacities: Record<string, number> = {};
  for (const t of chain) capacities[t.guid] = capForTier(t.guid);
  const popTargets = chain
    .map((t) => ({ tier: t.guid, pop: (tierCounts[t.guid] || 0) * capForTier(t.guid) }))
    .filter((p) => p.pop > 0);
  const sol = solve(
    popTargets.length ? popTargets : [{ tier: req.tierGuid, pop: 0 }],
    { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, needSelection: needMode, capacities },
  );
  const importGoods: ImportGood[] = Object.entries(sol.goodsPerMin)
    .filter(([, v]) => v > 0)
    .map(([good, perMin]) => ({ good, name: goodName(good), perMin: Math.round(perMin * 100) / 100 }))
    .sort((a, b) => b.perMin - a.perMin);

  // bonus d'attributs cumulés (par tier atteint × maisons de ce tier)
  const attributes: Record<string, number> = {};
  for (const t of chain) {
    const n = tierCounts[t.guid] || 0;
    if (!n) continue;
    for (const [k, v] of Object.entries(t.perHouse || {})) attributes[k] = (attributes[k] || 0) + Math.round(v * n);
  }

  // ARGENT : la taxe (`gross`) vient du solveur, par tier réellement atteint. L'ENTRETIEN
  // est calculé sur les bâtiments RÉELLEMENT POSÉS — auparavant il venait aussi de solve(),
  // qui estime le nombre de services avec la constante DEFAULT_HOUSES_PER_SERVICE = 30
  // (« un service couvre 30 maisons »), alors que le plan spatial connaît le compte exact.
  const upkeep = Math.round(buildings.reduce((s, b) => s + upkeepOf(b.defId), 0));
  const money = { gross: sol.money.gross, upkeep, net: sol.money.gross - upkeep };

  // TROUS. Ordre délibéré : d'abord ce qui BLOQUE (l'UI n'affiche que les premiers),
  // ensuite les trous de couverture qui ne sont que du best-effort.
  const gaps: string[] = [...kontorGaps];
  for (const id of deadTypes) {
    const d = lookup(id);
    gaps.push(`${d?.name ?? id} sans eau (aucun raccordé) → maisons plafonnées au palier inférieur`);
  }
  gaps.push(...water.gaps);
  for (const s of tier.services) {
    if (relevant && s.building && !relevant.has(s.building)) continue; // écarté volontairement
    if (!s.building) gaps.push("Service sans bâtiment au catalogue (non plaçable)");
    else {
      const def = lookup(s.building);
      if (!def) gaps.push(`Service ${s.building} absent du catalogue`);
      else if (!(def.streetRange || def.radius?.range)) gaps.push(`${def.name} : rayon inconnu (non couvrable)`);
    }
  }
  if (removedHouses) gaps.push(`${removedHouses} maison(s) rasée(s) pour raccorder le comptoir`);
  for (const s of analyzable) {
    if (s.pct < 100) gaps.push(`${s.name} : ${s.pct}% des maisons couvertes (distance-rue)`);
  }

  const hasWaterConsumers = water.consumers.length > 0;
  return {
    mode: "import",
    tierGuid: req.tierGuid,
    tierName: tier.name,
    cap,
    houses,
    fullyCovered,
    fullyCoveredPct,
    residents,
    buildings: layout.buildings,
    roads: layout.roads,
    fields: layout.fields,
    aqueducts: water.aqueducts,
    water: hasWaterConsumers
      ? { sources: water.sources.length, capacity: water.capacity, used: water.used, consumers: water.consumers }
      : null,
    importGoods,
    tierCounts,
    coverage,
    coverageMin,
    money,
    attributes,
    gaps: [...new Set(gaps)],
    // faisable = au moins une maison ET fraction au tier-cible ≥ seuil (l'eau morte
    // démote désormais les maisons au lieu d'annuler la population)
    feasible: houses > 0 && fullyCoveredPct >= floor,
  };
}
