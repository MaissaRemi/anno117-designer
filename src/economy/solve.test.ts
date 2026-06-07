import { describe, expect, it } from "vitest";
import { tiers } from "./economy";
import { solve } from "./solve";

const liberti = tiers.find((t) => /liberti/i.test(t.name)) ?? tiers[0];

describe("solve (économie)", () => {
  it("loge la population cible et converge", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: true,
      includeServices: true,
      capacities: {},
    });
    expect(r.populationByTier[liberti.guid]).toBeGreaterThanOrEqual(1000);
    expect(r.residencesByTier[liberti.guid]).toBeGreaterThan(0);
    expect(r.iterations).toBeLessThan(200); // a convergé
    expect(r.populationByTier[liberti.guid]).toBeLessThan(5_000_000); // pas de divergence
    expect(r.items.length).toBeGreaterThan(0);
  });

  it("génère des bâtiments de production quand includeProduction", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: true,
      includeServices: false,
      capacities: {},
    });
    expect(Object.keys(r.productionCounts).length).toBeGreaterThan(0);
  });

  it("sans production : pas de cascade, pop = cible", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: false,
      includeServices: true,
      capacities: {},
    });
    expect(Object.keys(r.productionCounts).length).toBe(0);
    expect(r.populationByTier[liberti.guid]).toBe(1000);
  });

  it("la capacité influe sur le nombre de résidences", () => {
    const a = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: false,
      includeServices: false,
      capacities: { [liberti.guid]: 10 },
    });
    const b = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: false,
      includeServices: false,
      capacities: { [liberti.guid]: 50 },
    });
    expect(a.residencesByTier[liberti.guid]).toBe(100);
    expect(b.residencesByTier[liberti.guid]).toBe(20);
  });
});
