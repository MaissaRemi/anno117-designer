import { describe, expect, it } from "vitest";
import { makeBuildingDef } from "../model/factories";
import type { Layout } from "../model/types";
import { computeRadiusCoverage, makeLookup } from "./rules";
import { planningRange, roadFactor } from "./roads";

describe("portée selon le type de route", () => {
  const puits = makeBuildingDef({ id: "puits", size: { w: 2, h: 2 }, radius: { kind: "service", range: 18 }, streetRange: 20 });
  const disque = makeBuildingDef({ id: "disque", size: { w: 2, h: 2 }, radius: { kind: "service", range: 12 } });

  it("pavée et marbre allongent la portée-rue de moitié, la terre non (données du jeu)", () => {
    expect(roadFactor(undefined)).toBe(1);
    expect(planningRange(puits)).toBe(20);
    expect(planningRange(puits, "terre")).toBe(20);
    expect(planningRange(puits, "pavee")).toBe(30);
    expect(planningRange(puits, "marbre")).toBe(30);
  });

  it("un rayon en disque ne suit pas les rues : il ne prend pas le facteur", () => {
    expect(planningRange(disque, "pavee")).toBe(12);
  });

  it("la couverture de l'éditeur suit le type de route du layout", () => {
    const svc = makeBuildingDef({ id: "svc", size: { w: 1, h: 1 }, radius: { kind: "service", range: 2 }, streetRange: 2 });
    const roads = Array.from({ length: 8 }, (_, i) => ({ x: 5, y: 6 + i }));
    const layout: Layout = {
      grid: { w: 20, h: 20, usable: new Array(400).fill(true) },
      buildings: [{ uid: "s", defId: "svc", x: 5, y: 5, rotation: 0, locked: false }],
      fields: [], roads,
    };
    const lk = makeLookup([svc]);
    // portée 2 sur terre : routes atteintes (5,6) et (5,7) ; pavée : floor(2 × 1,5) = 3 → (5,8)
    expect(computeRadiusCoverage(layout, lk).get("s")!.has("5,9")).toBe(false);
    expect(computeRadiusCoverage({ ...layout, roadType: "pavee" }, lk).get("s")!.has("5,9")).toBe(true);
    expect(computeRadiusCoverage({ ...layout, roadType: "pavee" }, lk).get("s")!.has("5,10")).toBe(false);
  });
});
