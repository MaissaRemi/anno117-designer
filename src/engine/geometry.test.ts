import { describe, expect, it } from "vitest";
import { makeBuildingDef } from "../model/factories";
import type { GridShape } from "../model/types";
import {
  cellIndex,
  cellKey,
  footprintCells,
  footprintSize,
  htToTile,
  inBounds,
  isBuildable,
  isUsable,
  isWater,
  neighbors8,
  orthoNeighbors,
  tileToHT,
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

describe("geometry 45° — rotations diagonales", () => {
  it("footprintSize accepte les 8 rotations ; diamant = bbox carrée", () => {
    const d = makeBuildingDef({ id: "d", size: { w: 3, h: 12 } });
    for (const rot of [45, 135, 225, 315] as const) {
      const s = footprintSize(d, rot);
      expect(s.w).toBe(s.h);
      expect(s.w).toBeGreaterThan(0);
    }
  });

  it("footprintSize diamant : côté = ceil(2(w+h)/√2)", () => {
    const d = makeBuildingDef({ id: "d", size: { w: 3, h: 3 } });
    // demi-largeurs 3,3 ; côté = ceil(2*6/√2) = ceil(8.49) = 9
    expect(footprintSize(d, 45)).toEqual({ w: 9, h: 9 });
    expect(footprintSize(d, 135)).toEqual({ w: 9, h: 9 });
  });

  it("footprintCells diamant 1×1 : croix de 5 cellules (calcul manuel)", () => {
    const d = makeBuildingDef({ id: "u", size: { w: 1, h: 1 } });
    // côté 3, centre (1.5,1.5), |lx|<=1 && |ly|<=1 → la croix centrale
    const cells = footprintCells(d, 0, 0, 45).map((c) => `${c.x},${c.y}`).sort();
    expect(cells).toEqual(["0,1", "1,0", "1,1", "1,2", "2,1"].sort());
  });

  it("footprintCells axis inchangé (régression)", () => {
    const d = makeBuildingDef({ id: "r", size: { w: 2, h: 3 } });
    expect(footprintCells(d, 5, 7, 0).length).toBe(6);
    expect(footprintCells(d, 5, 7, 90).length).toBe(6);
  });

  it("footprintCells diamant SERRÉ (règle ≥50% aire) : ~ aire préservée, pas gonflé", () => {
    // carré 3×3 (axe = 36 ½-tuiles) → diamant serré ≈ 37 (et NON 41 de la règle "centre")
    const d33 = makeBuildingDef({ id: "d33", size: { w: 3, h: 3 } });
    expect(footprintCells(d33, 0, 0, 45).length).toBe(37);
    // borne générale : jamais beaucoup plus que l'aire axis (sinon packing dégradé)
    for (const [w, h] of [[2, 2], [3, 3], [2, 4]] as const) {
      const d = makeBuildingDef({ id: `s${w}${h}`, size: { w, h } });
      const n = footprintCells(d, 0, 0, 45).length;
      const area = 2 * w * 2 * h;
      expect(n).toBeLessThanOrEqual(Math.ceil(area * 1.15)); // serré (≤ +15%)
      expect(n).toBeGreaterThan(0);
    }
  });

  const fpSet = (def: ReturnType<typeof makeBuildingDef>, rot: 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315) =>
    new Set(footprintCells(def, 0, 0, rot).map((c) => `${c.x},${c.y}`));

  it("symétrie 180° du rectangle : 45 ≡ 225 et 135 ≡ 315", () => {
    const rect = makeBuildingDef({ id: "rect", size: { w: 2, h: 4 } });
    expect(fpSet(rect, 45)).toEqual(fpSet(rect, 225));
    expect(fpSet(rect, 135)).toEqual(fpSet(rect, 315));
  });

  it("symétrie 90° du carré : 45 ≡ 135 (≡ 225 ≡ 315)", () => {
    const sq = makeBuildingDef({ id: "sq", size: { w: 3, h: 3 } });
    expect(fpSet(sq, 45)).toEqual(fpSet(sq, 135));
    expect(fpSet(sq, 45)).toEqual(fpSet(sq, 315));
  });

  it("rectangle non carré : 45 ≠ 135 (orientations distinctes)", () => {
    const rect = makeBuildingDef({ id: "r2", size: { w: 2, h: 5 } });
    expect(fpSet(rect, 45)).not.toEqual(fpSet(rect, 135));
  });
});

describe("geometry 45° — 8-adjacence + conversions", () => {
  it("neighbors8 = 4 ortho + 4 diagonaux", () => {
    const n = neighbors8(5, 5).map((c) => `${c.x},${c.y}`).sort();
    expect(n).toEqual(["4,4", "4,5", "4,6", "5,4", "5,6", "6,4", "6,5", "6,6"].sort());
  });
  it("tileToHT / htToTile", () => {
    expect(tileToHT(3)).toBe(6);
    expect(htToTile(6)).toBe(3);
    expect(htToTile(7)).toBe(3);
  });
});
