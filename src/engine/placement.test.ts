import { describe, expect, it } from "vitest";
import { makeBuildingDef, makeGrid } from "../model/factories";
import type { GridShape, Layout } from "../model/types";
import { canPlace, makeLookup, validateLayout } from "./rules";

// --- Bâtiments côtiers : terre vs eau ---
describe("placement terre / eau", () => {
  // grille 10×10 : moitié gauche TERRE, moitié droite EAU
  function splitGrid(): GridShape {
    const g = makeGrid(10, 10, false);
    g.water = new Array(100).fill(false);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const i = y * 10 + x;
        if (x < 5) g.usable[i] = true; // terre
        else g.water[i] = true; // mer
      }
    return g;
  }
  const land = makeBuildingDef({ id: "land", name: "Terre", size: { w: 2, h: 2 }, needsRoad: false });
  const coast = makeBuildingDef({ id: "coast", name: "Pêcherie", size: { w: 2, h: 2 }, needsRoad: false, placement: "water" });
  const lookup = makeLookup([land, coast]);
  const base = (): Layout => ({ grid: splitGrid(), buildings: [], fields: [], roads: [] });

  it("bâtiment terrestre : OK sur terre, refusé sur l'eau", () => {
    const l = base();
    expect(canPlace(l, lookup, land, 0, 0, 0)).toBe(true); // terre
    expect(canPlace(l, lookup, land, 6, 0, 0)).toBe(false); // eau
  });

  it("bâtiment côtier : OK sur l'eau, refusé sur terre", () => {
    const l = base();
    expect(canPlace(l, lookup, coast, 6, 0, 0)).toBe(true); // eau
    expect(canPlace(l, lookup, coast, 0, 0, 0)).toBe(false); // terre
  });

  it("validateLayout signale le mauvais terrain", () => {
    const l = base();
    // pêcherie posée à tort sur la terre
    l.buildings.push({ uid: "p1", defId: "coast", x: 0, y: 0, rotation: 0, locked: false });
    const i = validateLayout(l, lookup).get("p1")!;
    expect(i.terrain).toBe(true);
    expect(i.ok).toBe(false);
    // bien posée sur l'eau
    const l2 = base();
    l2.buildings.push({ uid: "p2", defId: "coast", x: 6, y: 0, rotation: 0, locked: false });
    const j = validateLayout(l2, lookup).get("p2")!;
    expect(j.terrain).toBe(false);
    expect(j.ok).toBe(true);
  });
});
