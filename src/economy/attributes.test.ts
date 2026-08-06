import { describe, expect, it } from "vitest";
import { cityStatusAttrs, economy, effectOf, type Tier } from "./economy";
import { houseAttrs, institutionDefs, isViable, needAttrs, VITAL_ATTRS, worstAttr, zoneAttrs } from "./attributes";

const t4 = economy.tiers.find((t) => t.name === "Patriciens")!;
const svcIds = (t: Tier) => new Set(t.services.map((s) => s.building).filter((b): b is string => !!b));

describe("données d'attributs", () => {
  it("chaque besoin porte ses attributs complets, pas seulement Population et Argent", () => {
    const all = [...t4.goods, ...t4.services];
    expect(all.some((n) => n.attrs && Object.keys(n.attrs).length > 0)).toBe(true);
    const keys = new Set(all.flatMap((n) => Object.keys(n.attrs ?? {})));
    for (const k of ["Happiness", "Health", "FireSafety", "Knowledge"]) expect(keys.has(k)).toBe(true);
  });

  it("PAS DE DOUBLE COMPTAGE : attributs du besoin == effet de zone du bâtiment", () => {
    // C'est l'invariant qui justifie d'exclure les services du calcul d'effets de zone.
    for (const s of t4.services) {
      const fx = s.building ? effectOf(s.building) : undefined;
      if (!fx) continue;
      expect(fx.attrs).toEqual(s.attrs);
    }
  });

  it("le rang de cité s'aggrave avec la population", () => {
    const a = cityStatusAttrs(1_000);
    const b = cityStatusAttrs(70_000);
    expect(b.Happiness).toBeLessThan(a.Happiness ?? 0);
    expect(b.FireSafety).toBeLessThan(a.FireSafety ?? 0);
    // …et les bonus, eux, montent
    expect(b.Belief).toBeGreaterThan(a.Belief ?? 0);
  });
});

describe("bilan par maison", () => {
  it("tous les services couvrants → total = perHouse du palier", () => {
    const a = needAttrs(t4, svcIds(t4));
    for (const [k, v] of Object.entries(t4.perHouse)) expect(a[k] ?? 0).toBeCloseTo(v, 5);
  });

  it("aucun service couvrant → seuls les biens comptent", () => {
    const a = needAttrs(t4, new Set());
    const goodsOnly: Record<string, number> = {};
    for (const g of t4.goods) for (const [k, v] of Object.entries(g.attrs ?? {})) goodsOnly[k] = (goodsOnly[k] ?? 0) + v;
    expect(a).toEqual(goodsOnly);
  });

  it("un effet de zone cumulable se cumule, un bonus non cumulable compte une fois", () => {
    const mine = "g2918"; // Mine de fer : Santé −2, cumulable
    const fx = effectOf(mine)!;
    expect(fx.stackable).toBe(true);
    const one = zoneAttrs(new Map([[mine, 1]]), new Set());
    const three = zoneAttrs(new Map([[mine, 3]]), new Set());
    expect(three.Health).toBeCloseTo(one.Health * 3, 5);

    const lyre = "g4832"; // Lyrier : Argent +1 Bonheur +1, NON cumulable
    expect(effectOf(lyre)!.stackable).toBe(false);
    expect(zoneAttrs(new Map([[lyre, 4]]), new Set())).toEqual(zoneAttrs(new Map([[lyre, 1]]), new Set()));
  });

  it("un bâtiment qui remplit un besoin n'est PAS recompté comme effet de zone", () => {
    const bains = "g3620";
    expect(zoneAttrs(new Map([[bains, 1]]), svcIds(t4))).toEqual({});
  });

  it("le rang de cité fait basculer une maison pleinement desservie", () => {
    const covered = svcIds(t4);
    const petite = houseAttrs({ tier: t4, coveringServices: covered, population: 500 });
    const grande = houseAttrs({ tier: t4, coveringServices: covered, population: 260_000 });
    expect(isViable(petite)).toBe(true);
    expect(isViable(grande)).toBe(false);
    expect(worstAttr(grande)?.attr).toBeDefined();
  });

  it("isViable exige les quatre attributs vitaux ≥ 0", () => {
    expect(isViable({ Happiness: 0, Money: 0, Health: 0, FireSafety: 0 })).toBe(true);
    for (const k of VITAL_ATTRS) {
      const a: Record<string, number> = { Happiness: 1, Money: 1, Health: 1, FireSafety: 1 };
      a[k] = -1;
      expect(isViable(a)).toBe(false);
      expect(worstAttr(a)?.attr).toBe(k);
    }
  });
});

describe("institutions anti-incidents", () => {
  const inst = institutionDefs("Roman");

  it("en propose, à portée-rue, hors besoins de palier", () => {
    expect(inst.length).toBeGreaterThan(0);
    const needBuildings = new Set(economy.tiers.flatMap((t) => t.services.map((s) => s.building)));
    for (const i of inst) {
      expect(needBuildings.has(i.defId)).toBe(false);
      expect(i.range).toBeGreaterThan(0);
      expect(VITAL_ATTRS.some((k) => (i.attrs[k] ?? 0) > 0)).toBe(true);
    }
  });

  it("couvre bien la sécurité incendie et la santé", () => {
    expect(inst.some((i) => (i.attrs.FireSafety ?? 0) > 0)).toBe(true);
    expect(inst.some((i) => (i.attrs.Health ?? 0) > 0)).toBe(true);
  });
});
