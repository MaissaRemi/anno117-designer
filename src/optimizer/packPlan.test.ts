import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef, Layout } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { analyzeCoverage } from "../economy/coverage";
import { planPacked } from "./packPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).length >= 3,
)!;

function streetMin(layout: Layout) {
  const an = analyzeCoverage(layout, lookup).services.filter((s) => s.hasRadius);
  return an.length ? Math.min(...an.map((s) => s.pct)) : 100;
}

const requiredIds = [...new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b))]
  .filter((b) => { const d = lookup(b); return !!d && !!(d.streetRange || d.radius?.range); });

describe("planPacked (houses-first + min-cover)", () => {
  it("pose maisons + tous les types de service, avec routes", () => {
    const grid = makeGrid(100, 100);
    const r = planPacked(grid, tier.guid, lookup);
    expect(r.houses).toBeGreaterThan(50);
    expect(r.roads.length).toBeGreaterThan(0);
    for (const id of requiredIds) expect(r.servicesPlaced[id] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("couverture distance-rue quasi totale (>=90%)", () => {
    const grid = makeGrid(120, 120);
    const r = planPacked(grid, tier.guid, lookup);
    const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: [] };
    expect(streetMin(layout)).toBeGreaterThanOrEqual(90);
  });

  it("plus de surface => plus de maisons", () => {
    const small = planPacked(makeGrid(80, 80), tier.guid, lookup).houses;
    const big = planPacked(makeGrid(160, 160), tier.guid, lookup).houses;
    expect(big).toBeGreaterThan(small);
  });

  it("pas de chevauchement entre bâtiments", () => {
    const grid = makeGrid(100, 100);
    const r = planPacked(grid, tier.guid, lookup);
    const occ = new Set<string>();
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
      for (let j = 0; j < d.size.h; j++) for (let i = 0; i < d.size.w; i++) {
        const k = `${b.x + i},${b.y + j}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
      }
    }
  });

  it("MIN-COVER : ratio maisons/services sain sur île irrégulière (anti-confetti)", () => {
    // 3 lobes ~ contour réel ; districtPlan y faisait ~3 maisons/service
    const W = 200;
    const grid = makeGrid(W, W, false);
    const blobs = [[W * 0.3, W * 0.4, W * 0.18], [W * 0.6, W * 0.35, W * 0.15], [W * 0.5, W * 0.65, W * 0.2]] as const;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      for (const [bx, by, br] of blobs) if ((x - bx) ** 2 + (y - by) ** 2 <= br * br) { grid.usable[y * W + x] = true; break; }
    const pack = planPacked(grid, tier.guid, lookup);
    const svc = Object.values(pack.servicesPlaced).reduce((a, b) => a + b, 0);
    expect(pack.houses).toBeGreaterThan(150);
    expect(pack.houses / svc).toBeGreaterThanOrEqual(4);
  });

  it("chaque maison touche une route (accès garanti)", () => {
    const grid = makeGrid(100, 100);
    const r = planPacked(grid, tier.guid, lookup);
    const roads = new Set(r.roads.map((t) => `${t.x},${t.y}`));
    const housesB = r.buildings.filter((b) => b.defId === tier.residenceId);
    for (const b of housesB) {
      const d = lookup(b.defId)!;
      let touch = false;
      for (let j = -1; j <= d.size.h && !touch; j++) for (let i = -1; i <= d.size.w && !touch; i++) {
        const edge = (i >= 0 && i < d.size.w) !== (j >= 0 && j < d.size.h);
        if (edge && roads.has(`${b.x + i},${b.y + j}`)) touch = true;
      }
      expect(touch).toBe(true);
    }
  });

  it("île irrégulière (disque) : rien sur l'eau", () => {
    const W = 128, cx = 64, cy = 64, R = 55;
    const grid = makeGrid(W, W, false);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= R * R) grid.usable[y * W + x] = true;
    }
    const r = planPacked(grid, tier.guid, lookup);
    expect(r.houses).toBeGreaterThan(50);
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
      for (let j = 0; j < d.size.h; j++) for (let i = 0; i < d.size.w; i++) {
        expect(grid.usable[(b.y + j) * W + (b.x + i)]).toBe(true);
      }
    }
    for (const rd of r.roads) expect(grid.usable[rd.y * W + rd.x]).toBe(true);
  });
});
