import { describe, expect, it } from "vitest";
import { makeBuildingDef } from "../model/factories";
import type { GridShape } from "../model/types";
import {
  cellIndex,
  cellKey,
  footprintCells,
  footprintSize,
  inBounds,
  isBuildable,
  isUsable,
  isWater,
  orthoNeighbors,
} from "./geometry";

const def = makeBuildingDef({ id: "g", size: { w: 3, h: 12 } }); // asymétrique → détecte la transposition

describe("geometry — footprint & rotation", () => {
  it("footprintSize swappe w/h à 90 et 270, pas à 0/180", () => {
    expect(footprintSize(def, 0)).toEqual({ w: 3, h: 12 });
    expect(footprintSize(def, 180)).toEqual({ w: 3, h: 12 });
    expect(footprintSize(def, 90)).toEqual({ w: 12, h: 3 });
    expect(footprintSize(def, 270)).toEqual({ w: 12, h: 3 });
  });

  it("footprintCells : w*h cases, étendue correcte par rotation", () => {
    const c0 = footprintCells(def, 5, 7, 0);
    expect(c0.length).toBe(36);
    expect(Math.max(...c0.map((c) => c.x))).toBe(7); // x..x+2
    expect(Math.max(...c0.map((c) => c.y))).toBe(18); // y..y+11
    const c90 = footprintCells(def, 5, 7, 90);
    expect(c90.length).toBe(36);
    expect(Math.max(...c90.map((c) => c.x))).toBe(16); // x..x+11
    expect(Math.max(...c90.map((c) => c.y))).toBe(9); // y..y+2
  });
});

describe("geometry — grille", () => {
  const g: GridShape = {
    w: 3,
    h: 3,
    usable: [true, true, false, true, true, true, true, true, true],
    water: [false, false, true, false, false, false, false, false, false],
  };

  it("inBounds / cellIndex", () => {
    expect(inBounds(g, 0, 0)).toBe(true);
    expect(inBounds(g, 3, 0)).toBe(false);
    expect(inBounds(g, -1, 0)).toBe(false);
    expect(cellIndex(g, 2, 1)).toBe(5);
  });

  it("isUsable lit le masque et borne", () => {
    expect(isUsable(g, 0, 0)).toBe(true);
    expect(isUsable(g, 2, 0)).toBe(false); // usable[2]=false
    expect(isUsable(g, 9, 9)).toBe(false); // hors limites
  });

  it("isWater : false sans carte water, lit la carte sinon", () => {
    expect(isWater(g, 2, 0)).toBe(true);
    expect(isWater(g, 0, 0)).toBe(false);
    const noWater: GridShape = { w: 2, h: 2, usable: [true, true, true, true] };
    expect(isWater(noWater, 0, 0)).toBe(false);
  });

  it("isBuildable : 'water' exige eau, défaut exige terre utilisable", () => {
    expect(isBuildable(g, 2, 0, "water")).toBe(true); // case eau
    expect(isBuildable(g, 0, 0, "water")).toBe(false); // terre, pas eau
    expect(isBuildable(g, 0, 0)).toBe(true); // terre utilisable
    expect(isBuildable(g, 2, 0)).toBe(false); // usable=false
  });

  it("cellKey / orthoNeighbors", () => {
    expect(cellKey(4, 9)).toBe("4,9");
    expect(orthoNeighbors(1, 1)).toEqual([
      { x: 2, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 0 },
    ]);
  });
});
