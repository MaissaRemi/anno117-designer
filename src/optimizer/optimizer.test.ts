import { describe, expect, it } from "vitest";
import { makeBuildingDef, makeGrid } from "../model/factories";
import { decode, makeDecoder } from "./greedy";
import { anneal } from "./anneal";
import { DEFAULT_WEIGHTS, type OptimizeRequest } from "./types";

const house = makeBuildingDef({ id: "house", name: "Maison", size: { w: 3, h: 3 }, needsRoad: true });
const farm = makeBuildingDef({
  id: "farm",
  name: "Ferme",
  size: { w: 3, h: 3 },
  needsRoad: false,
  field: { tiles: 9, fieldType: "ble" },
});

function req(items: { defId: string; qty: number }[], w = 40, h = 40): OptimizeRequest {
  return {
    catalog: [house, farm],
    grid: makeGrid(w, h),
    lockedBuildings: [],
    existingRoads: [],
    existingFields: [],
    items,
    weights: { ...DEFAULT_WEIGHTS },
    timeMs: 300,
  };
}

describe("decode", () => {
  it("place des bâtiments et génère des routes", () => {
    const r = req([{ defId: "house", qty: 10 }]);
    const dec = makeDecoder(r);
    const out = decode(r, dec, ["house", "house", "house", "house", "house"], 0);
    expect(out.buildings.length).toBeGreaterThan(0);
    expect(out.roads.length).toBeGreaterThan(0);
  });

  it("génère le champ requis pour une ferme (count, connecté, sous le bâtiment)", () => {
    const r = req([{ defId: "farm", qty: 1 }]);
    const dec = makeDecoder(r);
    const out = decode(r, dec, ["farm"], 0);
    expect(out.buildings.length).toBe(1);
    const farmB = out.buildings[0];
    const fields = out.fields.filter((f) => f.ownerUid === farmB.uid);
    expect(fields.length).toBe(9); // exactement field.tiles
    // au moins une case de champ adjacente au bâtiment
    const fp = new Set<string>();
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) fp.add(`${farmB.x + i},${farmB.y + j}`);
    const touches = fields.some((f) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => fp.has(`${f.x + dx},${f.y + dy}`)),
    );
    expect(touches).toBe(true);
  });

  it("ne dépasse pas la grille / pas de chevauchement", () => {
    const r = req([{ defId: "house", qty: 50 }], 20, 20);
    const dec = makeDecoder(r);
    const out = decode(r, dec, new Array(50).fill("house"), 0);
    const seen = new Set<string>();
    for (const b of out.buildings) {
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          const k = `${b.x + i},${b.y + j}`;
          expect(b.x + i).toBeLessThan(20);
          expect(b.y + j).toBeLessThan(20);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
    }
  });
});

describe("anneal", () => {
  it("place le maximum demandé dans une grande grille", () => {
    const r = req([{ defId: "house", qty: 20 }]);
    const { out, scored } = anneal(r);
    expect(out.buildings.length).toBeGreaterThanOrEqual(15);
    expect(scored.placed).toBe(out.buildings.length);
  });

  it("respecte les bâtiments verrouillés (ne les écrase pas)", () => {
    const r = req([{ defId: "house", qty: 20 }]);
    r.lockedBuildings = [{ uid: "lock1", defId: "house", x: 5, y: 5, rotation: 0, locked: true }];
    const { out } = anneal(r);
    // aucun bâtiment placé ne recouvre la case (5,5)..(7,7)
    for (const b of out.buildings) {
      const overlap = b.x < 8 && b.x + 3 > 5 && b.y < 8 && b.y + 3 > 5;
      expect(overlap).toBe(false);
    }
  });
});
