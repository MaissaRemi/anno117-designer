import { makeLookup } from "../engine/rules";
import type { AqueductTile, BuildingDef, FieldTile, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import { economy, residentialChain, upkeepOf } from "../economy/economy";
import { buildTierProfile, solve } from "../economy/solve";
import { compileTierEvaluator } from "../economy/needsModel";
import { cityStatusAttrs } from "../economy/economy";
import { institutionDefs, isViable, VITAL_ATTRS, worstAttr } from "../economy/attributes";
import { effectOf } from "../economy/economy";
import { footprintSize } from "../engine/geometry";
import { candidateRecipes } from "./recipes";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";
import { planLattice, type LatticeResult } from "./planLattice";
import { planPacked, type PackResult } from "./packPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";
import { blockMountains, needsWater, planWater, type WaterConsumerReport, type WaterPlanResult } from "./waterPlan";
import { connectKontor, pickKontorDef, repairRoadConnectivity, reserveKontor } from "./kontor";
import { planSlots, type ExploitedSlot } from "./slotPlan";

export interface IslandPlanRequest {
  catalog: BuildingDef[];
  grid: GridShape;
  /** Archetype d'île : population (défaut, mode import) ou production (export). */
  mode?: "population" | "production";
  tierGuid: string; // tier-cible (ex Patriciens) — mode population
  coverageFloor?: number; // 0..1, défaut 1 (seuil pour le flag feasible)
  /** Choix des services à poser :
   *  - "auto" (défaut) : RECHERCHE DE RECETTE — on énumère les sous-ensembles minimaux
   *    qui franchissent les seuils du palier, on présélectionne par taxe foncière, puis
   *    on tranche en faisant tourner le vrai moteur sur chacun (cf. optimizer/recipes.ts).
   *    Mesuré ×1,48 sur la population face à « tous les services ».
   *  - "all" : tous les services du palier (max de bonus par maison, densité minimale).
   *  - "thresholds" : ancien pré-choix par ratio entretien/poids — conservé pour
   *    comparaison, mais il retient systématiquement les services les plus coûteux
   *    en sol (Grammaticus, Marché, Taverne) et perd contre "auto". */
  needMode?: "auto" | "all" | "thresholds";
  /** Nombre de recettes évaluées avec le moteur réel en mode "auto" (défaut 8).
   *  Chaque évaluation coûte 80 à 400 ms selon la taille de l'île. */
  recipeCount?: number;
  /** Exploiter les emplacements de terrain (montagne, rivière, marais) que le réseau
   *  d'eau n'a PAS consommés : mines, carrières, argile… plus les entrepôts nécessaires
   *  pour que leur production sorte. L'eau reste prioritaire. Défaut false. */
  exploitSlots?: boolean;
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
  /** Emplacements de terrain exploités (option `exploitSlots`) — vide si l'option est off. */
  exploited: ExploitedSlot[];
  /** BILAN DE L'ÎLE par attribut vital : somme sur toutes les maisons, malus de rang de
   *  cité compris. C'est le total qui doit rester ≥ 0 — une maison en déficit compensée
   *  par ses voisines ne pose pas de problème. */
  attrsTotal: Record<string, number>;
  /** Le bilan de l'île tient-il sur les quatre attributs vitaux ? */
  viable: boolean;
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
  const needMode = req.needMode ?? "auto";
  const lookup = makeLookup(req.catalog);
  const tier = economy.tiers.find((t) => t.guid === req.tierGuid);
  if (!tier || !tier.residenceId) {
    throw new Error("Tier-cible invalide ou sans résidence.");
  }
  const chain = residentialChain(req.tierGuid);
  const residenceIds = new Set(chain.map((t) => t.residenceId).filter((r): r is string => !!r));

  // --- RECETTES À ESSAYER ------------------------------------------------------------
  // `undefined` = tous les services du palier. Chaque entrée sera placée pour de vrai puis
  // évaluée ; c'est la population LIVRÉE qui tranche, pas une estimation. Un modèle
  // analytique ne suffit pas : confronté au moteur, son classement ne corrèle qu'à 0,45,
  // et le routage d'eau l'inverse (chaque citerne coûte 10 u, une conduite, un corridor).
  let landTiles = 0;
  for (const u of req.grid.usable) if (u) landTiles++;
  const trials: (string[] | undefined)[] = [];
  if (needMode === "auto") {
    // budget adaptatif : une évaluation coûte ~0,1 s sur une île moyenne mais plusieurs
    // secondes sur une continentale de 400 000 tuiles
    const land = landTiles;
    const keep = req.recipeCount ?? (land > 200_000 ? 2 : land > 60_000 ? 5 : 7);
    for (const r of candidateRecipes(chain, lookup, { keep })) trials.push(r.serviceIds);
    // La recette COMPLÈTE en dernier recours — mais seulement tant qu'elle est abordable.
    // Elle pose 5 à 7 fois plus de copies, donc coûte 5 à 7 fois le temps d'un plan maigre
    // (5,5 s à elle seule sur une île continentale). Au-delà de 200 000 tuiles elle est de
    // toute façon battue par les recettes à filet de repli (437 287 contre 546 147 mesurés),
    // parce que la portée du Colisée y plafonne la part de maisons au palier cible.
    if (land <= 200_000) trials.push(undefined);
  } else if (needMode === "thresholds") {
    const profile = buildTierProfile(req.tierGuid, { needSelection: "thresholds" });
    trials.push([...new Set(profile.services.map((s) => s.building).filter((b): b is string => !!b))]);
  }
  if (!trials.length) trials.push(undefined); // "all", ou repli si l'énumération n'a rien donné

  // --- COMPTOIR (racine du réseau + entrée des imports) : réservé AVANT les moteurs ---
  // Aucun moteur n'en posait : le plan était formellement valide (sans racine,
  // rootedRoadSet accepte toutes les routes) mais injouable — sur une île d'IMPORT, les
  // 27 biens transitent par le port. On retire l'emprise du masque constructible pour que
  // les moteurs bâtissent autour, plutôt que d'avoir à raser un quartier après coup.
  const islandRegion = req.grid.islandId?.includes("celtic") ? "Celtic" : "Roman";
  // INSTITUTIONS anti-incidents : elles ne remplissent aucun besoin, l'optimiseur ne les
  // posait donc jamais — alors qu'elles sont le seul contrepoids au malus de rang de cité.
  // Mesuré : sans elles aucune ville ne dépasse 3 000 habitants avec tous ses attributs
  // positifs ; avec elles la recette complète tient jusqu'à 260 000.
  const institutions = institutionDefs(islandRegion)
    .filter((i) => lookup(i.defId))
    .map((i) => i.defId);
  const kontorDef = pickKontorDef(req.catalog, islandRegion);
  const kontor = kontorDef ? reserveKontor(req.grid, kontorDef) : null;

  // moteurs sur grille SANS les zones montagne (non constructibles en vrai, et la
  // source d'aqueduc en a besoin) ; l'eau est planifiée sur la grille d'origine
  const planGrid = blockMountains(kontor?.grid ?? req.grid);
  const coverageFloor = req.coverageFloor ?? 1;
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
  type Cand = LatticeResult | PackResult;
  interface Evaluated {
    cand: Cand;
    /** services que ce candidat était censé poser (undefined = tous ceux du palier) */
    relevant: Set<string> | null;
    water: WaterPlanResult;
    buildings: PlacedBuilding[];
    tierCounts: Record<string, number>;
    capByTier: Record<string, number>;
    deadTypes: Set<string>;
    residents: number;
    houseMoney: number;
    /** part des consommateurs d'eau réellement raccordés (0..1 ; 1 si aucun) */
    waterPct: number;
    /** bilan de l'île par attribut vital, rang de cité compris */
    attrsTotal: Record<string, number>;
    /** le bilan de l'île tient-il ? */
    viable: boolean;
  }
  const evaluate = (cand: Cand, relevant: Set<string> | null): Evaluated => {
    // évaluateur scopé à CE jeu de services : un service hors recette ne compte ni pour
    // les seuils ni pour la capacité (utilisé ici seulement par le repli de démotion)
    const evaluator = compileTierEvaluator(chain, { goodsMet: true, relevant: relevant ?? undefined });
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
    const capByTier: Record<string, number> = { ...cand.capByTier };
    let houseMoney = cand.houseMoney;
    let cutoff = chain.length;
    for (let k = 0; k < chain.length; k++) if (!tierSafe(chain[k])) { cutoff = k; break; }
    if (cutoff < chain.length) {
      const safeIdx = Math.max(0, cutoff - 1);
      const safeGuid = chain[safeIdx]?.guid;
      // capacité attribuée aux maisons démotées : la moyenne OBSERVÉE du palier sûr si
      // des maisons y vivent déjà, sinon la référence tous-services-couverts. C'est une
      // approximation, sur un chemin de repli : les moteurs eau-aware ont déjà exclu les
      // services secs de leur comptage par maison, seul packPlan passe par ici.
      const avg = safeGuid && tierCounts[safeGuid]
        ? (capByTier[safeGuid] || 0) / tierCounts[safeGuid]
        : evaluator.reference(safeIdx).cap;
      const before = Object.values(capByTier).reduce((a, b) => a + b, 0);
      let moved = 0;
      for (let k = cutoff; k < chain.length; k++) {
        moved += tierCounts[chain[k].guid] || 0;
        delete tierCounts[chain[k].guid];
        delete capByTier[chain[k].guid];
      }
      if (moved && safeGuid) {
        tierCounts[safeGuid] = (tierCounts[safeGuid] || 0) + moved;
        capByTier[safeGuid] = (capByTier[safeGuid] || 0) + moved * avg;
      }
      const after = Object.values(capByTier).reduce((a, b) => a + b, 0);
      houseMoney = before > 0 ? houseMoney * (after / before) : 0;
    }
    const nCons = water.consumers.length;
    const nOk = water.consumers.filter((c) => c.connected).length;
    const residents = Math.round(Object.values(capByTier).reduce((a, b) => a + b, 0));
    // BILAN DE L'ÎLE : somme des attributs sur toutes les maisons, plus le malus de RANG
    // DE CITÉ appliqué à chacune — il dépend de la population totale et n'est donc connu
    // qu'ici. Le jugement porte sur le total, pas sur la pire maison : un quartier de
    // bordure en déficit compensé par le cœur de la ville ne pose pas de problème.
    const rank = cityStatusAttrs(residents, islandRegion);
    const attrsTotal: Record<string, number> = {};
    for (const k of VITAL_ATTRS) attrsTotal[k] = (cand.attrsSum[k] ?? 0) + cand.houses * (rank[k] ?? 0);
    return {
      cand, relevant, water, buildings, tierCounts, capByTier, deadTypes, houseMoney,
      residents,
      waterPct: nCons ? nOk / nCons : 1,
      attrsTotal,
      viable: isViable(attrsTotal),
    };
  };
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
  //
  // Le plancher est volontairement TRÈS BAS. Un raccordement partiel est déjà pénalisé une
  // première fois par la démotion (`deadTypes`) ; en faire aussi un filtre à 50 % revenait à
  // une double peine, qui coûtait ~100 000 habitants sur une île continentale (un plan à
  // 437 000 habitants et 39 % de raccordement était rejeté au profit d'un plan à 339 000).
  // Ce qu'il faut éliminer, c'est le plan structurellement injouable — typiquement packPlan,
  // qui pose toutes ses maisons avant de router l'eau et ne laisse plus aucun corridor.
  const WATER_VIABLE = 0.15;
  const waterViable = (e: Evaluated): boolean => e.waterPct >= WATER_VIABLE;
  const better = (a: Evaluated, b: Evaluated): boolean => {
    if (waterViable(a) !== waterViable(b)) return waterViable(a);
    // VIABILITÉ DE L'ÎLE avant la population : un bilan négatif en Bonheur, Argent, Santé
    // ou Sécurité incendie déclenche émeutes, incendies et maladies. Maximiser la
    // population sans cette contrainte revenait à optimiser une ville que le jeu punit.
    if (a.viable !== b.viable) return a.viable;
    const close = Math.abs(a.residents - b.residents) <= 0.02 * Math.max(a.residents, b.residents, 1);
    if (!close) return a.residents > b.residents;
    if (a.waterPct !== b.waterPct) return a.waterPct > b.waterPct;
    if (a.cand.houses !== b.cand.houses) return a.cand.houses > b.cand.houses;
    return svcCount(a.cand) <= svcCount(b.cand);
  };

  // --- ÉVALUATION DE CHAQUE RECETTE PAR LE MOTEUR RÉEL --------------------------------
  // C'est la population LIVRÉE qui décide. On garde aussi packPlan sur la première recette :
  // il gagne parfois sur les paliers sans consommateur d'eau (où son houses-first paie).
  // seuils de densification à balayer sur la recette GAGNANTE (cf. plus bas) : au-delà de
  // 0,9 le moteur sur-densifie (services 10,8 % → 19,4 % du sol) et la population baisse.
  const REFINE_FLOOR = 0.9;
  const total = trials.length + 2;
  let pick: Evaluated | null = null;
  const runLattice = (serviceIds: string[] | undefined, floor: number): Evaluated =>
    evaluate(
      planLattice(planGrid, req.tierGuid, lookup, { coverageFloor: floor, serviceIds, water: true, heights: req.heights, institutions }),
      serviceIds ? new Set(serviceIds) : null,
    );
  let bestTrial: string[] | undefined;
  for (let i = 0; i < trials.length; i++) {
    onProgress?.(i + 1, total);
    const ev = runLattice(trials[i], coverageFloor);
    if (!pick || better(ev, pick)) { pick = ev; bestTrial = trials[i]; }
  }
  // RAFFINAGE : la recette gagnante rejouée à un seuil de densification plus exigeant.
  // Mesuré +4,0 % (65 357 → 67 940 habitants) — le moteur pose une ou deux copies de plus
  // là où la couverture était juste, et récupère des maisons entières au palier cible.
  if (Math.abs(coverageFloor - REFINE_FLOOR) > 1e-6) {
    onProgress?.(trials.length + 1, total);
    const ev = runLattice(bestTrial, REFINE_FLOOR);
    if (!pick || better(ev, pick)) pick = ev;
  }
  // packPlan sur la meilleure recette : il ne gagne jamais sur un palier à eau (il pose ses
  // maisons avant de router), mais il reste pertinent sur les paliers qui n'en consomment
  // pas. Sur les très grandes îles il coûte un plan complet pour un résultat toujours
  // perdant (mesuré −0,7 % et −1,7 %) : on s'en passe.
  onProgress?.(total, total);
  if (landTiles <= 200_000) {
    const serviceIds = bestTrial;
    const packed = planPacked(planGrid, req.tierGuid, lookup, { coverageFloor, serviceIds });
    const ev = evaluate(packed, serviceIds ? new Set(serviceIds) : null);
    if (!pick || better(ev, pick)) pick = ev;
  }
  const chosen = pick!;
  const relevant = chosen.relevant;
  const dist = chosen.cand;
  const water = chosen.water;
  const deadTypes = chosen.deadTypes;
  const attrsTotal: Record<string, number> = { ...chosen.attrsTotal };
  // capacité de référence d'une maison au palier cible SOUS LA RECETTE RETENUE : c'est ce
  // que le panneau affiche, et ce n'est plus `capacityDefault` — une recette maigre héberge
  // moins par maison mais bien plus de maisons.
  const cap = compileTierEvaluator(chain, { goodsMet: true, relevant: relevant ?? undefined })
    .reference(chain.length - 1).cap;

  // --- pose du comptoir + raccordement au réseau produit -----------------------------
  const buildings = [...chosen.buildings];
  const roads: RoadTile[] = [...dist.roads];
  const kontorGaps: string[] = [];
  let removedHouses = 0;
  const tierCounts: Record<string, number> = { ...chosen.tierCounts };
  const capByTier: Record<string, number> = { ...chosen.capByTier };
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
          if (g && tierCounts[g]) {
            const avg = (capByTier[g] || 0) / tierCounts[g];
            tierCounts[g]--;
            capByTier[g] = Math.max(0, (capByTier[g] || 0) - avg);
            removedHouses++;
          }
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

  // --- EXPLOITATION DES EMPLACEMENTS LIBRES (option) ---------------------------------
  // Appelée APRÈS le routage d'eau : les sources ont déjà pris les slots montagne dont
  // elles avaient besoin, ce module ne voit que le complément. Il pose aussi les entrepôts
  // sans lesquels la production ne sortirait pas.
  let exploited: ExploitedSlot[] = [];
  if (req.exploitSlots) {
    const sp = planSlots(
      req.grid, req.catalog, lookup, buildings, roads, water.usedSlots,
      (id) => residenceIds.has(id),
      { fertilities: req.islandFertilities, region: islandRegion },
    );
    if (sp.removed.length) {
      const tierOfRes = new Map(chain.filter((t) => t.residenceId).map((t) => [t.residenceId!, t.guid]));
      const gone = new Set(sp.removed);
      for (const b of buildings) {
        if (!gone.has(b.uid)) continue;
        const g = tierOfRes.get(b.defId);
        if (g && tierCounts[g]) {
          const avg = (capByTier[g] || 0) / tierCounts[g];
          tierCounts[g]--;
          capByTier[g] = Math.max(0, (capByTier[g] || 0) - avg);
          removedHouses++;
        }
      }
      const keep = buildings.filter((b) => !gone.has(b.uid));
      buildings.length = 0;
      buildings.push(...keep);
    }
    buildings.push(...sp.buildings);
    const seenR = new Set(roads.map((r) => `${r.x},${r.y}`));
    for (const r of sp.roads) if (!seenR.has(`${r.x},${r.y}`)) { seenR.add(`${r.x},${r.y}`); roads.push(r); }
    exploited = sp.exploited;
    kontorGaps.push(...sp.gaps);
  }

  // --- EFFETS DE ZONE DES BÂTIMENTS POSÉS HORS MOTEUR ---------------------------------
  // Les exploitations d'emplacement (mines, carrières, ferme à bœufs) portent toutes un
  // malus de Santé −2 CUMULABLE dans un rayon EUCLIDIEN de 20 à 24. Elles sont posées après
  // les moteurs, donc leur effet échappait au bilan calculé par ceux-ci. On le rattrape ici,
  // sur les maisons réellement à portée.
  const zoneDelta: Record<string, number> = {};
  {
    const houseList = buildings.filter((b) => residenceIds.has(b.defId));
    const svcOfTiers = new Set(chain.flatMap((t) => t.services.map((s) => s.building)));
    const centre = (b: PlacedBuilding) => {
      const d = lookup(b.defId);
      const fp = d ? footprintSize(d, b.rotation) : { w: 1, h: 1 };
      return { x: b.x + fp.w / 2, y: b.y + fp.h / 2 };
    };
    const houseCentres = houseList.map(centre);
    // non cumulable : une seule fois par type et par maison
    const seenOnce = new Map<string, Set<number>>();
    for (const b of buildings) {
      const fx = effectOf(b.defId);
      if (!fx || fx.scope !== "radius" || svcOfTiers.has(b.defId)) continue;
      const c = centre(b);
      const r2 = fx.range * fx.range;
      for (let i = 0; i < houseCentres.length; i++) {
        const h = houseCentres[i];
        const dx = h.x - c.x, dy = h.y - c.y;
        if (dx * dx + dy * dy > r2) continue;
        if (!fx.stackable) {
          let set = seenOnce.get(b.defId);
          if (!set) seenOnce.set(b.defId, (set = new Set()));
          if (set.has(i)) continue;
          set.add(i);
        }
        for (const [k, v] of Object.entries(fx.attrs)) zoneDelta[k] = (zoneDelta[k] ?? 0) + v;
      }
    }
    for (const k of VITAL_ATTRS) attrsTotal[k] = (attrsTotal[k] ?? 0) + (zoneDelta[k] ?? 0);
  }
  const planViable = isViable(attrsTotal);

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
  const fullyCovered = tierCounts[req.tierGuid] || 0; // maisons ayant atteint le palier cible
  const fullyCoveredPct = houses ? Math.round((fullyCovered / houses) * 100) : 0;
  // Habitants = Σ des capacités RÉELLES, maison par maison (Σ Population des besoins
  // remplis). Deux maisons du même palier n'ont pas la même capacité : celle qui voit un
  // service de plus héberge davantage. C'est ce gradient qui guide l'optimisation.
  const residents = Math.round(Object.values(capByTier).reduce((a, b) => a + b, 0));

  // Manifeste d'import : vecteur de population MULTI-PALIERS. La capacité passée à `solve`
  // est la MOYENNE OBSERVÉE par palier (capacité cumulée / nb de maisons), pas la capacité
  // théorique tous-besoins-remplis : sinon `solve` déduirait un nombre de maisons faux et
  // la demande de biens avec (elle est proportionnelle aux MAISONS, pas aux habitants).
  const capacities: Record<string, number> = {};
  for (const t of chain) {
    const n = tierCounts[t.guid] || 0;
    capacities[t.guid] = n > 0 ? Math.max(1, (capByTier[t.guid] || 0) / n) : (t.capacityDefault || 10);
  }
  const popTargets = chain
    .map((t) => ({ tier: t.guid, pop: (tierCounts[t.guid] || 0) * capacities[t.guid] }))
    .filter((p) => p.pop > 0);
  // needSelection: "all" — la DEMANDE DE BIENS est toujours complète : sur une île d'import
  // tous les biens sont acheminés (c'est l'hypothèse `goodsMet` du modèle de besoins). Ce
  // que la recette restreint, ce sont les SERVICES, qui ne consomment rien.
  const sol = solve(
    popTargets.length ? popTargets : [{ tier: req.tierGuid, pop: 0 }],
    { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, needSelection: "all", capacities },
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
  {
    const w = worstAttr(attrsTotal);
    if (w) {
      const label: Record<string, string> = {
        Happiness: "Bonheur", Money: "Argent", Health: "Santé", FireSafety: "Sécurité incendie",
      };
      gaps.push(`${label[w.attr] ?? w.attr} négatif sur l'île (${w.value.toFixed(0)}) — émeutes/incendies/maladies en jeu`);
    }
  }
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
    exploited,
    attrsTotal,
    viable: planViable,
    tierCounts,
    coverage,
    coverageMin,
    money,
    attributes,
    gaps: [...new Set(gaps)],
    // FAISABLE = le plan tient debout en jeu : des maisons, des habitants, et un réseau
    // d'eau qui n'est pas mort. Le critère précédent (`fullyCoveredPct ≥ curseur`) déclarait
    // « best-effort » les MEILLEURS plans mesurés : une recette maigre loge bien plus de
    // monde tout en laissant une part plus grande de maisons sous le palier cible. Le
    // curseur reste un objectif affiché, pas un verdict.
    feasible: houses > 0 && residents > 0 && chosen.waterPct >= WATER_VIABLE,
  };
}
