import { describe, expect, it } from "vitest";
import { upscale2x } from "../data/islands";
import type { GridShape } from "../model/types";
import { downscaleGrid, scaleResultToHalfTile, upscaleBuildings, upscaleTiles } from "./halfTileAdapter";

describe("downscaleGrid — ½-tuile → tuile (inverse de upscale2x)", () => {
  it("round-trip upscale2x → downscaleGrid récupère le masque tuile", () => {
    const tw = 3, th = 4;
    const tileMask = Array.from({ length: tw * th }, (_, i) => i % 3 !== 0);
    const ht: GridShape = { w: tw * 2, h: th * 2, usable: upscale2x(tileMask, tw, th), cellsPerTile: 2 };
    const back = downscaleGrid(ht);
    expect(back.w).toBe(tw);
    expect(back.h).toBe(th);
    expect(back.usable).toEqual(tileMask);
    expect(back.cellsPerTile).toBeUndefined(); // tuile (scale 1)
  });

  it("slots ÷2, grille déjà tuile inchangée", () => {
    const ht: GridShape = {
      w: 4, h: 4, usable: new Array(16).fill(true),
      slots: [{ type: "mountain", x: 4, y: 2 }], cellsPerTile: 2,
    };
    expect(downscaleGrid(ht).slots).toEqual([{ type: "mountain", x: 2, y: 1 }]);
    const tile: GridShape = { w: 2, h: 2, usable: [true, true, true, true] };
    expect(downscaleGrid(tile)).toBe(tile); // pas de copie inutile
  });
});

describe("scaleResultToHalfTile — reprojection tuile → ½-tuile", () => {
  const result = {
    buildings: [{ uid: "b", defId: "d", x: 5, y: 7, rotation: 0 as const, locked: false }],
    roads: [{ x: 1, y: 2 }],
    fields: [{ x: 3, y: 3, ownerUid: "b", fieldType: "ble" }],
    aqueducts: [{ x: 0, y: 0, gen: true }],
  };

  it("halfTile=true : bâtiments ×2, tuiles → blocs 2×2 (route large 1 tuile)", () => {
    const r = scaleResultToHalfTile(result, true);
    expect(r.buildings[0]).toMatchObject({ x: 10, y: 14 });
    // route (1,2) → 4 cellules (2,4),(3,4),(2,5),(3,5)
    expect(new Set(r.roads.map((t) => `${t.x},${t.y}`))).toEqual(new Set(["2,4", "3,4", "2,5", "3,5"]));
    expect(r.fields.length).toBe(4);
    expect(r.fields.every((f) => f.ownerUid === "b" && f.fieldType === "ble")).toBe(true);
    expect(r.aqueducts!.length).toBe(4);
    expect(r.aqueducts!.every((a) => a.gen === true)).toBe(true);
  });

  it("halfTile=false : identité", () => {
    expect(scaleResultToHalfTile(result, false)).toBe(result);
  });
});

describe("upscaleBuildings / upscaleTiles", () => {
  it("buildings position ×2, props préservées", () => {
    const out = upscaleBuildings([{ uid: "u", defId: "d", x: 3, y: 4, rotation: 45, locked: true }]);
    expect(out[0]).toEqual({ uid: "u", defId: "d", x: 6, y: 8, rotation: 45, locked: true });
  });
  it("tiles → 4 cellules par tuile", () => {
    expect(upscaleTiles([{ x: 0, y: 0 }]).length).toBe(4);
  });
});
