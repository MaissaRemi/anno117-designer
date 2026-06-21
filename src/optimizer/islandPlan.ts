import { makeLookup } from "../engine/rules";
import type { AqueductTile, BuildingDef, FieldTile, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import { economy } from "../economy/economy";
import { buildTierProfile, solve } from "../economy/solve";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";
import { planLattice } from "./planLattice";
import { planPacked } from "./packPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";
import { blockMountains, needsWater, planWater, type WaterConsumerReport } from "./waterPlan";

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
  residents: number; // habitants des maisons PLEINEMENT couvertes (au tier-cible)
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

  // PORTFOLIO de moteurs (cf. session refonte placement) : lattice co-localisé
  // (gagne sur tiers riches en services, 11 types T4) vs houses-first min-cover
  // (gagne sur tiers à peu de types). On garde le meilleur résultat réel.
  const engineOpts = {
    coverageFloor: req.coverageFloor ?? 1,
    serviceIds: needMode === "thresholds" ? retainedServices : undefined,
  };
  // moteurs sur grille SANS les zones montagne (non constructibles en vrai, et la
  // source d'aqueduc en a besoin) ; l'eau est planifiée sur la grille d'origine
  const planGrid = blockMountains(req.grid);
  onProgress?.(1, 3);
  // lattice route l'eau EN COURS de placement (corridors avant les maisons)
  const candA = planLattice(planGrid, req.tierGuid, lookup, { ...engineOpts, water: true, heights: req.heights });
  onProgress?.(2, 3);
  const candB = planPacked(planGrid, req.tierGuid, lookup, engineOpts);
  const svcCount = (r: { servicesPlaced: Record<string, number> }) =>
    Object.values(r.servicesPlaced).reduce((a, b) => a + b, 0);
  // critère : d'abord les maisons PLEINEMENT couvertes (= tier-cible, tous bonus),
  // puis le total de maisons, puis le moins de services (anti-confetti)
  const better = (a: typeof candA, b: typeof candB): boolean =>
    a.fullyCovered !== b.fullyCovered ? a.fullyCovered > b.fullyCovered
    : a.houses !== b.houses ? a.houses > b.houses
    : svcCount(a) <= svcCount(b);
  const dist = better(candA, candB) ? candA : candB;

  // réseau d'eau : intégré au moteur s'il le fournit (lattice) ; sinon routage
  // post-hoc best-effort (packPlan — tiers sans consommateurs d'eau en pratique)
  onProgress?.(3, 3);
  const water = dist.water ?? planWater(req.grid, dist.buildings, dist.roads, lookup, req.heights);
  const buildings = dist.water
    ? dist.buildings // sources déjà intégrées par le moteur
    : [...dist.buildings, ...water.sources];
  const layout: Layout = { grid: req.grid, buildings, roads: dist.roads, fields: dist.fields, aqueducts: water.aqueducts };
  // en mode seuils, seuls les services RETENUS comptent pour la faisabilité/couverture-tier
  const relevant = needMode === "thresholds" ? new Set(retainedServices) : null;
  // couverture DISTANCE-RUE = la vraie mécanique du jeu. `requiredServices` scope le gate
  // "pleinement couverte" au sous-ensemble retenu (mode seuils), sinon tous les services.
  const coverage = analyzeCoverage(layout, lookup, relevant ? { requiredServices: relevant } : {});
  const analyzable = coverage.services.filter((s) => s.hasRadius && (!relevant || relevant.has(s.serviceId)));
  const coverageMin = analyzable.length ? Math.min(...analyzable.map((s) => s.pct)) : 100;
  const houses = dist.houses;
  // EAU : un service consommateur d'eau requis mais dont AUCUN exemplaire n'est
  // raccordé est INACTIF en jeu (Bains/Forum/Colisée/Citerne sans aqueduc) → les
  // maisons qui en dépendent ne montent PAS au tier. analyzeCoverage ne le voit pas
  // (couverture géométrique) → on annule la couverture-tier si un tel service est mort.
  const defOfUid = new Map(buildings.map((b) => [b.uid, b.defId]));
  const connectedByDef = new Map<string, number>();
  for (const c of water.consumers) {
    if (!c.connected) continue;
    const id = defOfUid.get(c.uid);
    if (id) connectedByDef.set(id, (connectedByDef.get(id) ?? 0) + 1);
  }
  const waterDead = [...new Set(tier.services.map((s) => s.building))]
    .filter((id): id is string => !!id && (!relevant || relevant.has(id)))
    .filter((id) => { const d = lookup(id); return d && needsWater(d) && !connectedByDef.get(id); });
  const waterOk = waterDead.length === 0;
  // borne autoritative DANS LES DEUX MODES : analyzeCoverage (scopé aux services
  // retenus) exige TOUS les services pertinents — y compris un type que le moteur
  // n'aurait pas pu poser (sorti de son propre compte) → corrige le sur-comptage
  // quand un service requis finit à 0 copie sur île saturée.
  const fullyCappable = Math.min(dist.fullyCovered, coverage.housesFullyCovered);
  const fullyCovered = waterOk ? fullyCappable : 0; // service eau mort → aucune maison au tier
  const fullyCoveredPct = houses ? Math.round((fullyCovered / houses) * 100) : 0;
  // habitants au TIER-CIBLE = maisons pleinement couvertes (les partielles n'ont pas
  // tous les besoins → tier inférieur). Manifeste d'import + bonus basés là-dessus.
  const residents = fullyCovered * cap;

  // manifeste d'import : biens consommables (pas d'explosion de chaîne → on ship le fini)
  const sol = solve(
    [{ tier: req.tierGuid, pop: residents }],
    {
      includeProduction: false, includeServices: true, includeWorkforce: false,
      optimizeNeeds: false, needSelection: needMode, capacities: { [req.tierGuid]: cap },
    },
  );
  const importGoods: ImportGood[] = Object.entries(sol.goodsPerMin)
    .filter(([, v]) => v > 0)
    .map(([good, perMin]) => ({ good, name: goodName(good), perMin: Math.round(perMin * 100) / 100 }))
    .sort((a, b) => b.perMin - a.perMin);

  // bonus d'attributs cumulés (maisons PLEINEMENT couvertes = au tier-cible)
  const attributes: Record<string, number> = {};
  for (const [k, v] of Object.entries(tier.perHouse || {})) attributes[k] = Math.round(v * fullyCovered);

  // trous best-effort (en mode seuils : seulement les services retenus)
  const gaps: string[] = [];
  for (const s of tier.services) {
    if (relevant && s.building && !relevant.has(s.building)) continue; // écarté volontairement
    if (!s.building) gaps.push("Service sans bâtiment au catalogue (non plaçable)");
    else {
      const def = lookup(s.building);
      if (!def) gaps.push(`Service ${s.building} absent du catalogue`);
      else if (!(def.streetRange || def.radius?.range)) gaps.push(`${def.name} : rayon inconnu (non couvrable)`);
    }
  }
  for (const s of analyzable) {
    if (s.pct < 100) gaps.push(`${s.name} : ${s.pct}% des maisons couvertes (distance-rue)`);
  }
  gaps.push(...water.gaps);
  for (const id of waterDead) {
    const d = lookup(id);
    gaps.push(`${d?.name ?? id} sans eau (aucun raccordé) → 0 maison au tier-cible`);
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
    coverage,
    coverageMin,
    money: sol.money,
    attributes,
    gaps: [...new Set(gaps)],
    // faisable = au moins une maison ET fraction au tier-cible ≥ seuil ET eau OK
    feasible: houses > 0 && waterOk && fullyCoveredPct >= floor,
  };
}
