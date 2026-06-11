import { makeLookup } from "../engine/rules";
import type { AqueductTile, BuildingDef, FieldTile, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import { economy } from "../economy/economy";
import { buildTierProfile, solve } from "../economy/solve";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";
import { planLattice } from "./planLattice";
import { planPacked } from "./packPlan";
import { blockMountains, planWater, type WaterConsumerReport } from "./waterPlan";

export interface IslandPlanRequest {
  catalog: BuildingDef[];
  grid: GridShape;
  tierGuid: string; // tier-cible (ex Patriciens)
  coverageFloor?: number; // 0..1, défaut 1 (seuil pour le flag feasible)
  /** "all" = tous les besoins (max bonus/maison) ; "thresholds" = sous-ensemble le
   *  moins cher atteignant les seuils d'upgrade (moins de services → plus de maisons). */
  needMode?: "all" | "thresholds";
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
  residents: number;
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
  const candA = planLattice(planGrid, req.tierGuid, lookup, { ...engineOpts, water: true });
  onProgress?.(2, 3);
  const candB = planPacked(planGrid, req.tierGuid, lookup, engineOpts);
  const svcCount = (r: { servicesPlaced: Record<string, number> }) =>
    Object.values(r.servicesPlaced).reduce((a, b) => a + b, 0);
  const dist = candA.houses > candB.houses || (candA.houses === candB.houses && svcCount(candA) <= svcCount(candB))
    ? candA : candB;

  // réseau d'eau : intégré au lattice ; sinon (gagnant packPlan, tiers sans
  // consommateurs d'eau en pratique) routage post-hoc best-effort
  onProgress?.(3, 3);
  const integratedWater = dist === candA ? candA.water : undefined;
  const water = integratedWater ?? planWater(req.grid, dist.buildings, dist.roads, lookup);
  const buildings = integratedWater
    ? dist.buildings // sources déjà intégrées par le lattice
    : [...dist.buildings, ...water.sources];
  const layout: Layout = { grid: req.grid, buildings, roads: dist.roads, fields: dist.fields, aqueducts: water.aqueducts };
  // couverture DISTANCE-RUE = la vraie mécanique du jeu (et ce que le district garantit)
  const coverage = analyzeCoverage(layout, lookup);
  // en mode seuils, seuls les services RETENUS comptent pour la faisabilité
  const relevant = needMode === "thresholds" ? new Set(retainedServices) : null;
  const analyzable = coverage.services.filter((s) => s.hasRadius && (!relevant || relevant.has(s.serviceId)));
  const coverageMin = analyzable.length ? Math.min(...analyzable.map((s) => s.pct)) : 100;
  const houses = dist.houses;
  const residents = houses * cap;

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

  // bonus d'attributs cumulés (maisons pleines)
  const attributes: Record<string, number> = {};
  for (const [k, v] of Object.entries(tier.perHouse || {})) attributes[k] = Math.round(v * houses);

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

  const hasWaterConsumers = water.consumers.length > 0;
  return {
    mode: "import",
    tierGuid: req.tierGuid,
    tierName: tier.name,
    cap,
    houses,
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
    feasible: coverageMin >= floor, // a atteint le seuil de couverture visé
  };
}
