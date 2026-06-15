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

describe("planIslandImport (mode import)", () => {
  it("cale des maisons et renvoie un manifeste d'import", () => {
    const r = plan(36, 36, 0.5);
    expect(r.houses).toBeGreaterThan(0);
    // habitants = maisons PLEINEMENT couvertes × cap (les partielles = tier inférieur)
    expect(r.residents).toBe(r.fullyCovered * r.cap);
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

  it("manifeste = demande directe solve(pop = fullyCovered*cap)", () => {
    const r = plan(36, 36, 0.5);
    const sol = solve(
      [{ tier: tier.guid, pop: r.fullyCovered * r.cap }],
      { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, capacities: { [tier.guid]: r.cap } },
    );
    // chaque bien du manifeste correspond à la demande solve (arrondie)
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
