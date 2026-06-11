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
    expect(r.used).toBe(25 + 15 + 10 + 10); // citernes = 10u chacune (WaterConsumption template)
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

  it("hauteurs : l'eau ne monte pas — une crête plus haute que la source bloque la conduite", () => {
    const W = 100;
    const grid = gridWithMountain(W, W, [{ type: "mountain", x: 15, y: 50 }]);
    // source en plaine (q=10 partout), crête verticale q=50 en x=50..53, Bains derrière
    const heights = new Int8Array(W * W).fill(10);
    for (let y = 0; y < W; y++) for (let x = 50; x <= 53; x++) heights[y * W + x] = 50;
    const blocked = planWater(grid, [pb(BAINS, 70, 40)], [], lookup, heights);
    expect(blocked.consumers[0].connected).toBe(false);
    // même config SANS hauteurs : passe
    const flat = planWater(grid, [pb(BAINS, 70, 40)], [], lookup, null);
    expect(flat.consumers[0].connected).toBe(true);
    // source HAUTE (q=60 autour du slot) : la crête (50) devient franchissable
    const high = new Int8Array(heights);
    for (let y = 40; y < 60; y++) for (let x = 5; x < 25; x++) high[y * W + x] = 60;
    const ok = planWater(grid, [pb(BAINS, 70, 40)], [], lookup, high);
    expect(ok.consumers[0].connected).toBe(true);
  });

  it("Colisée (50u) + Bains + Forum = 90u sur une source ; citerne en plus force une 2e source", () => {
    const grid = gridWithMountain(160, 160, [
      { type: "mountain", x: 20, y: 20 },
      { type: "mountain", x: 140, y: 140 },
    ]);
    const buildings = [
      pb("g3621", 50, 50), // Colisée 31×27, 50u Mandatory
      pb(BAINS, 90, 40), pb(FORUM, 40, 95), pb(CITERNE, 100, 100),
    ];
    const r = planWater(grid, buildings, [], lookup);
    expect(r.used).toBe(50 + 25 + 15 + 10);
    for (const c of r.consumers) expect(c.connected).toBe(true);
    expect(r.sources.length).toBe(2); // 100u < 100 requis sur la 1re source seule
  });

  it("no-merge : 2 réseaux ne partagent jamais une case (pas de cumul d'eau)", () => {
    // 2 sources et 8 Bains entremêlés (200u total > 100/source) → les 2 réseaux
    // doivent rester physiquement disjoints
    const grid = gridWithMountain(200, 200, [
      { type: "mountain", x: 30, y: 100 },
      { type: "mountain", x: 170, y: 100 },
    ]);
    const buildings = [
      pb(BAINS, 60, 40), pb(BAINS, 90, 40), pb(BAINS, 120, 40), pb(BAINS, 150, 40),
      pb(BAINS, 60, 130), pb(BAINS, 90, 130), pb(BAINS, 120, 130), pb(BAINS, 150, 130),
    ];
    const r = planWater(grid, buildings, [], lookup);
    expect(r.sources.length).toBe(2);
    // best-effort : ≥ 6 Bains raccordés (les conduites d'un réseau sont des
    // obstacles pour l'autre — conséquence directe du no-merge)
    expect(r.used).toBeGreaterThanOrEqual(150);
    // chaque case de conduite appartient à UN réseau : reconstituer les réseaux par
    // flood-fill 4-adj des tuiles (+sources) → chaque composante touche 1 SEULE source
    const tiles = new Set(r.aqueducts.map((a) => `${a.x},${a.y}`));
    const srcCells = r.sources.map((s) => {
      const d = lookup(s.defId)!;
      const w = s.rotation === 90 ? d.size.h : d.size.w, h = s.rotation === 90 ? d.size.w : d.size.h;
      const set = new Set<string>();
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set.add(`${s.x + i},${s.y + j}`);
      return set;
    });
    const seen = new Set<string>();
    for (const start of tiles) {
      if (seen.has(start)) continue;
      // flood-fill d'une composante de conduites
      const comp: string[] = [start];
      seen.add(start);
      for (let i = 0; i < comp.length; i++) {
        const [x, y] = comp[i].split(",").map(Number);
        for (const k of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
          if (tiles.has(k) && !seen.has(k)) { seen.add(k); comp.push(k); }
        }
      }
      // sources adjacentes à cette composante
      let touched = 0;
      for (const si of srcCells) {
        const adj = comp.some((c) => {
          const [x, y] = c.split(",").map(Number);
          return si.has(`${x - 1},${y}`) || si.has(`${x + 1},${y}`) || si.has(`${x},${y - 1}`) || si.has(`${x},${y + 1}`);
        });
        if (adj) touched++;
      }
      expect(touched).toBeLessThanOrEqual(1); // jamais 2 sources sur la même composante
    }
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
