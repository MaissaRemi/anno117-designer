import { describe, expect, it } from "vitest";
import { makeBuildingDef } from "../model/factories";
import { computeChain, mergeItems } from "./chain";

const wheatFarm = makeBuildingDef({
  id: "wheat",
  name: "Ferme blé",
  production: { cycleTime: 60, outputs: [{ good: "ble", amount: 1 }], inputs: [] },
});
const mill = makeBuildingDef({
  id: "mill",
  name: "Moulin",
  production: { cycleTime: 30, outputs: [{ good: "farine", amount: 1 }], inputs: [{ good: "ble", amount: 1 }] },
});
const bakery = makeBuildingDef({
  id: "bakery",
  name: "Boulangerie",
  production: { cycleTime: 60, outputs: [{ good: "pain", amount: 1 }], inputs: [{ good: "farine", amount: 1 }] },
});
const catalog = [wheatFarm, mill, bakery];

describe("computeChain", () => {
  it("explose la chaîne aux bons ratios", () => {
    const items = computeChain(catalog, "bakery", 2);
    const by = Object.fromEntries(items.map((i) => [i.defId, i.qty]));
    expect(by.bakery).toBe(2);
    expect(by.mill).toBe(1); // 2/60 consommé = 1/30 produit
    expect(by.wheat).toBe(2); // 1/30 consommé / (1/60 produit) = 2
  });

  it("stoppe sur les matières brutes (sans producteur)", () => {
    const items = computeChain(catalog, "mill", 1);
    const by = Object.fromEntries(items.map((i) => [i.defId, i.qty]));
    expect(by.mill).toBe(1);
    expect(by.wheat).toBe(2);
    expect(by.bakery).toBeUndefined();
  });
});

describe("mergeItems", () => {
  it("somme les quantités par defId", () => {
    const r = mergeItems([{ defId: "a", qty: 2 }], [{ defId: "a", qty: 3 }, { defId: "b", qty: 1 }]);
    const by = Object.fromEntries(r.map((i) => [i.defId, i.qty]));
    expect(by.a).toBe(5);
    expect(by.b).toBe(1);
  });
});
