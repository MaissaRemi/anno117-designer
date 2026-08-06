import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { solve } from "../economy/solve";
import { planIslandImport } from "./islandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
// tier réel avec résidence + au moins un service à rayon
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.some((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)),
)!;

const plan = (w: number, h: number, floor = 1) =>
  planIslandImport({ catalog, grid: makeGrid(w, h), tierGuid: tier.guid, coverageFloor: floor });

// capacité/maison par tier (mode "all" = capacité par défaut) + population MIXTE totale
const capOf = (guid: string) => economy.tiers.find((t) => t.guid === guid)?.capacityDefault ?? 1;
const mixed = (tc: Record<string, number>) => Object.entries(tc).reduce((s, [g, n]) => s + n * capOf(g), 0);

describe("planIslandImport (mode import)", () => {
  it("cale des maisons et renvoie un manifeste d'import", () => {
    const r = plan(36, 36, 0.5);
    expect(r.houses).toBeGreaterThan(0);
    // habitants = somme MIXTE (chaque maison au palier ATTEINT) ≥ cible seule
    expect(r.residents).toBe(mixed(r.tierCounts));
    expect(r.residents).toBeGreaterThanOrEqual(r.fullyCovered * r.cap);
    expect(Object.values(r.tierCounts).reduce((a, b) => a + b, 0)).toBe(r.houses); // Σ tiers = maisons
    expect(r.fullyCovered).toBeLessThanOrEqual(r.houses);
    expect(r.buildings.length).toBeGreaterThanOrEqual(r.houses); // résidences + services
    expect(r.importGoods.length).toBeGreaterThan(0); // biens à acheminer
    expect(r.importGoods.every((g) => g.perMin > 0)).toBe(true);
  });

  it("plus de surface => au moins autant de maisons (monotone)", () => {
    const small = plan(24, 24, 0.5);
    const big = plan(48, 48, 0.5);
    expect(big.houses).toBeGreaterThanOrEqual(small.houses);
  });

  it("manifeste = demande directe solve(vecteur pop MIXTE par tier)", () => {
    const r = plan(36, 36, 0.5);
    const targets = Object.entries(r.tierCounts).map(([g, n]) => ({ tier: g, pop: n * capOf(g) }));
    const capacities = Object.fromEntries(Object.keys(r.tierCounts).map((g) => [g, capOf(g)]));
    const sol = solve(
      targets,
      { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, capacities },
    );
    // chaque bien du manifeste correspond à la demande solve mixte (arrondie)
    for (const g of r.importGoods.slice(0, 5)) {
      expect(Math.round((sol.goodsPerMin[g.good] || 0) * 100) / 100).toBeCloseTo(g.perMin, 1);
    }
  });

  it("best-effort : grille minuscule => peu de maisons, jamais d'échec", () => {
    const r = plan(10, 10, 1);
    expect(r.houses).toBeGreaterThanOrEqual(0);
    expect(r.mode).toBe("import");
    expect(Array.isArray(r.gaps)).toBe(true);
  });

  it("rapporte la couverture et les trous", () => {
    const r = plan(40, 40, 1);
    expect(r.coverage.services.length).toBeGreaterThan(0);
    expect(typeof r.coverageMin).toBe("number");
  });
});
