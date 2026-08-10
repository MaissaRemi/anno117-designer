import { describe, expect, it } from "vitest";
import { at, BUILDING, fill, FIELD, makeOcc, RESERVED } from "./occupancy";
import { fillFields, reserveFreeArea } from "./fields";

describe("fillFields", () => {
  it("atteint le quota et marque les cases", () => {
    const o = makeOcc(20, 20);
    fill(o, 8, 8, 4, 3, BUILDING);
    const tiles = fillFields(o, { x: 8, y: 8, w: 4, h: 3, radius: 6, tiles: 30, fieldType: "bl", ownerUid: "b0" });
    expect(tiles.length).toBe(30);
    expect(at(o, tiles[0].x, tiles[0].y)).toBe(FIELD);
    for (const t of tiles) expect(t.ownerUid).toBe("b0");
  });

  it("ne dépasse jamais le rayon", () => {
    const o = makeOcc(40, 40);
    fill(o, 20, 20, 4, 3, BUILDING);
    const tiles = fillFields(o, { x: 20, y: 20, w: 4, h: 3, radius: 3, tiles: 999, fieldType: "bl", ownerUid: "b0" });
    for (const t of tiles) {
      const dx = Math.max(20 - t.x, 0, t.x - 23);
      const dy = Math.max(20 - t.y, 0, t.y - 22);
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(3);
    }
  });

  it("deux fermes serrées ne se volent pas leurs champs", () => {
    const o = makeOcc(20, 20);
    fill(o, 2, 2, 4, 3, BUILDING);
    fill(o, 8, 2, 4, 3, BUILDING);
    const a = fillFields(o, { x: 2, y: 2, w: 4, h: 3, radius: 8, tiles: 40, fieldType: "bl", ownerUid: "b0" });
    const b = fillFields(o, { x: 8, y: 2, w: 4, h: 3, radius: 8, tiles: 40, fieldType: "bl", ownerUid: "b1" });
    const keys = new Set([...a, ...b].map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(a.length + b.length);
  });

  it("rend moins que le quota quand la place manque, sans boucler", () => {
    const o = makeOcc(6, 6);
    fill(o, 0, 0, 4, 3, BUILDING);
    const tiles = fillFields(o, { x: 0, y: 0, w: 4, h: 3, radius: 20, tiles: 999, fieldType: "bl", ownerUid: "b0" });
    expect(tiles.length).toBe(36 - 12);
  });
});

describe("reserveFreeArea", () => {
  it("réserve les cases libres du rayon et rend leur compte", () => {
    const o = makeOcc(20, 20);
    fill(o, 9, 9, 2, 2, BUILDING);
    const n = reserveFreeArea(o, 9, 9, 2, 2, 3);
    expect(n).toBeGreaterThan(0);
    expect(at(o, 9, 6)).toBe(RESERVED);
    expect(at(o, 9, 9)).toBe(BUILDING);
    expect(at(o, 0, 0)).toBe(0);
  });
});
