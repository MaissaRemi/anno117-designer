import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { balanceBasket, normalizeBasket } from "./basket";
import { toNumber } from "./frac";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("normalizeBasket", () => {
  it("fusionne les doublons et écarte les comptes nuls ou négatifs", () => {
    const b = normalizeBasket([
      { defId: "g3174", count: 2 },
      { defId: "g3075", count: 0 },
      { defId: "g3174", count: 3 },
      { defId: "g2693", count: -1 },
    ]);
    expect(b.lines).toEqual([{ defId: "g3174", count: 5 }]);
  });

  it("range par defId — un ordre total, donc un plan reproductible", () => {
    const a = normalizeBasket([{ defId: "g3174", count: 1 }, { defId: "g2693", count: 1 }]);
    const b = normalizeBasket([{ defId: "g2693", count: 1 }, { defId: "g3174", count: 1 }]);
    expect(a).toEqual(b);
    expect(a.lines.map((l) => l.defId)).toEqual(["g2693", "g3174"]);
  });

  it("tronque les comptes fractionnaires — on ne pose pas un demi-moulin", () => {
    expect(normalizeBasket([{ defId: "g3075", count: 2.7 }]).lines).toEqual([
      { defId: "g3075", count: 2 },
    ]);
  });
});

describe("balanceBasket", () => {
  it("une boulangerie seule produit du pain et manque de farine", () => {
    const bal = balanceBasket(normalizeBasket([{ defId: "g3174", count: 1 }]), lookup);
    expect(bal.surplus.map((f) => f.good)).toEqual(["2137"]);
    expect(toNumber(bal.surplus[0].ratePerMin)).toBe(1);
    expect(bal.deficits.map((f) => f.good)).toEqual(["2119"]);
    expect(toNumber(bal.deficits[0].ratePerMin)).toBe(1);
  });

  it("le lot parfait du pain n'a plus aucun déficit", () => {
    const bal = balanceBasket(
      normalizeBasket([
        { defId: "g3174", count: 2 },
        { defId: "g3075", count: 1 },
        { defId: "g2693", count: 2 },
      ]),
      lookup,
    );
    expect(bal.deficits).toEqual([]);
    expect(bal.surplus.map((f) => f.good)).toEqual(["2137"]);
    expect(toNumber(bal.surplus[0].ratePerMin)).toBe(2);
  });

  it("un moulin de trop laisse un surplus de farine, pas un déficit", () => {
    const bal = balanceBasket(
      normalizeBasket([{ defId: "g3174", count: 1 }, { defId: "g3075", count: 1 }]),
      lookup,
    );
    expect(bal.deficits.map((f) => f.good)).toEqual(["2069"]);
    expect(bal.surplus.map((f) => f.good).sort()).toEqual(["2119", "2137"]);
  });

  it("un bâtiment à slotType passe en AVIS, pas en refus", () => {
    const bal = balanceBasket(normalizeBasket([{ defId: "g2878", count: 1 }]), lookup);
    expect(bal.advisories).toEqual([{ defId: "g2878", slotType: "forest" }]);
  });

  it("les biens portent leur nom lisible", () => {
    const bal = balanceBasket(normalizeBasket([{ defId: "g2786", count: 1 }]), lookup);
    expect(bal.surplus[0].name).toBe("Moutons");
  });
});
