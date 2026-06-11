import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape, PlacedBuilding } from "../model/types";
import { makeLookup } from "../engine/rules";
import { blockMountains, planWater, WATER_CAPACITY } from "./waterPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const BAINS = "g3620"; // 12x21, conso 25
const FORUM = "g3617"; // 18x12, conso 15
const CITERNE = "g19753"; // 4x4, raccordement requis

const pb = (defId: string, x: number, y: number): PlacedBuilding =>
  ({ uid: `t-${defId}-${x}-${y}`, defId, x, y, rotation: 0, locked: false });

function gridWithMountain(w = 140, h = 140, slots = [{ type: "mountain", x: 20, y: 20 }]): GridShape {
  const g = makeGrid(w, h);
  return { ...g, slots };
}

describe("planWater", () => {
  it("pose une source au slot montagne et raccorde Bains + Forum + citernes", () => {
    const grid = gridWithMountain();
    const buildings = [pb(BAINS, 60, 60), pb(FORUM, 90, 30), pb(CITERNE, 40, 100), pb(CITERNE, 85, 60)];
    const r = planWater(grid, buildings, [], lookup);
    expect(r.sources.length).toBeGreaterThanOrEqual(1);
    expect(r.used).toBe(25 + 15); // citernes ne consomment pas le budget
    for (const c of r.consumers) expect(c.connected).toBe(true);
    expect(r.aqueducts.length).toBeGreaterThan(0);
    expect(r.gaps).toEqual([]);
  });

  it("conduites jamais sur un bâtiment ni hors-terre", () => {
    const grid = gridWithMountain();
    const buildings = [pb(BAINS, 60, 60), pb(CITERNE, 100, 100)];
    const r = planWater(grid, buildings, [], lookup);
    const all = [...buildings, ...r.sources];
    const occ = new Set<string>();
    for (const b of all) {
      const d = lookup(b.defId)!;
      const w = b.rotation === 90 ? d.size.h : d.size.w, h = b.rotation === 90 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) occ.add(`${b.x + i},${b.y + j}`);
    }
    for (const a of r.aqueducts) {
      expect(occ.has(`${a.x},${a.y}`)).toBe(false);
    }
  });

  it("sans slot montagne : gap explicite, rien de posé", () => {
    const grid = makeGrid(100, 100);
    const r = planWater(grid, [pb(BAINS, 40, 40)], [], lookup);
    expect(r.sources.length).toBe(0);
    expect(r.consumers[0].connected).toBe(false);
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("budget : 5 Bains (125 u) dépassent une source → 2e source activée", () => {
    const grid = gridWithMountain(200, 200, [
      { type: "mountain", x: 20, y: 20 },
      { type: "mountain", x: 60, y: 140 },
    ]);
    const buildings = [
      pb(BAINS, 50, 40), pb(BAINS, 80, 40), pb(BAINS, 110, 40), pb(BAINS, 140, 40), pb(BAINS, 50, 90),
    ];
    const r = planWater(grid, buildings, [], lookup);
    expect(r.used).toBe(125);
    expect(r.sources.length).toBe(2);
    for (const c of r.consumers) expect(c.connected).toBe(true);
  });

  it("blockMountains : zone autour du slot exclue du masque moteur", () => {
    const grid = gridWithMountain(60, 60, [{ type: "mountain", x: 30, y: 30 }]);
    const blocked = blockMountains(grid);
    expect(blocked.usable[30 * 60 + 30]).toBe(false);
    expect(blocked.usable[30 * 60 + 36]).toBe(false); // r=6
    expect(blocked.usable[30 * 60 + 38]).toBe(true); // hors zone
    expect(grid.usable[30 * 60 + 30]).toBe(true); // l'original intact
  });

  it("capacité exportée cohérente", () => {
    expect(WATER_CAPACITY).toBe(100);
  });

  it("routes : croisement en ligne droite uniquement, jamais le long, terminus hors route", () => {
    const grid = gridWithMountain(140, 140, [{ type: "mountain", x: 20, y: 70 }]);
    // mur de routes vertical x=60 séparant source (gauche) et Bains (droite),
    // + route horizontale y=70 : la conduite DOIT croiser au moins le mur x=60
    const roads: { x: number; y: number }[] = [];
    for (let y = 0; y < 140; y++) roads.push({ x: 60, y });
    for (let x = 0; x < 140; x++) if (x !== 60) roads.push({ x, y: 70 });
    const buildings = [pb(BAINS, 90, 60)];
    const r = planWater(grid, buildings, roads, lookup);
    expect(r.consumers[0].connected).toBe(true);
    const roadSet = new Set(roads.map((t) => `${t.x},${t.y}`));
    const aq = new Set(r.aqueducts.map((a) => `${a.x},${a.y}`));
    for (const a of r.aqueducts) {
      if (!roadSet.has(`${a.x},${a.y}`)) continue;
      // case partagée avec une route = croisement STRICT : les deux voisins opposés
      // (gauche/droite OU haut/bas) sont aussi des conduites — jamais un terminus/virage
      const horiz = aq.has(`${a.x - 1},${a.y}`) && aq.has(`${a.x + 1},${a.y}`);
      const vert = aq.has(`${a.x},${a.y - 1}`) && aq.has(`${a.x},${a.y + 1}`);
      expect(horiz || vert).toBe(true);
    }
  });
});
