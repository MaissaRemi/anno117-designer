import { describe, expect, it } from "vitest";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { decode, makeDecoder } from "./greedy";
import { DEFAULT_WEIGHTS } from "./types";

// ferme synthétique 3×3 + 20 tuiles de champ
const farm: BuildingDef = {
  id: "farm", name: "Ferme test", category: "production", size: { w: 3, h: 3 },
  rotatable: false, needsRoad: true, color: "#fff",
  field: { tiles: 20, fieldType: "test" },
} as BuildingDef;

describe("champs en forme libre (blob connexe, contact ferme)", () => {
  it("rectangle sous la ferme partiellement bloqué → blob contourne, 20/20 tuiles", () => {
    const W = 40;
    const grid = makeGrid(W, W);
    // mur d'eau horizontal y=12..13 sauf un passage x=18..21 : l'ancien rectangle
    // sous la ferme (rangées pleines) ne tenait pas, le blob doit passer par le trou
    for (let y = 12; y <= 13; y++) for (let x = 0; x < W; x++) {
      if (x < 18 || x > 21) grid.usable[y * W + x] = false;
    }
    const req = {
      catalog: [farm], grid, lockedBuildings: [], existingRoads: [], existingFields: [],
      items: [{ defId: "farm", qty: 4 }], weights: DEFAULT_WEIGHTS, timeMs: 0,
    };
    const dec = makeDecoder(req as never);
    const out = decode(req as never, dec, ["farm", "farm", "farm", "farm"], 0);
    expect(out.buildings.length).toBeGreaterThanOrEqual(3);
    for (const b of out.buildings) {
      const tiles = out.fields.filter((f) => f.ownerUid === b.uid);
      expect(tiles.length).toBe(20); // production 100 % garantie
      // aucune tuile sur l'eau
      for (const t of tiles) expect(grid.usable[t.y * W + t.x]).toBe(true);
      // ≥1 tuile ortho-adjacente à l'emprise 3×3
      const touches = tiles.some((t) =>
        (t.y === b.y + 3 && t.x >= b.x && t.x < b.x + 3) ||
        (t.y === b.y - 1 && t.x >= b.x && t.x < b.x + 3) ||
        (t.x === b.x + 3 && t.y >= b.y && t.y < b.y + 3) ||
        (t.x === b.x - 1 && t.y >= b.y && t.y < b.y + 3));
      expect(touches).toBe(true);
      // connexité du blob (flood-fill depuis la 1re tuile)
      const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
      const stack = [`${tiles[0].x},${tiles[0].y}`];
      const seen = new Set(stack);
      while (stack.length) {
        const [x, y] = stack.pop()!.split(",").map(Number);
        for (const k of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
          if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
      expect(seen.size).toBe(tiles.length);
    }
  });
});
