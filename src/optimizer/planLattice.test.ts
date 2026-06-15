import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { islands, decodeMask } from "../data/islands";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape, Layout } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { analyzeCoverage } from "../economy/coverage";
import { planLattice } from "./planLattice";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const svcTypes = (t: (typeof economy.tiers)[number]) =>
  new Set(t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).map((s) => s.building)).size;
// tier le plus riche en services (Patriciens, 11 types avec wonders) = cas dur
const tierRich = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => svcTypes(b) - svcTypes(a))[0]!;

function streetMin(layout: Layout) {
  const an = analyzeCoverage(layout, lookup).services.filter((s) => s.hasRadius);
  return an.length ? Math.min(...an.map((s) => s.pct)) : 100;
}

function realIsland(id: string): GridShape {
  const isl = islands.find((i) => i.id === id)!;
  const mask = decodeMask(isl.mask, isl.size.w, isl.size.h);
  const grid = makeGrid(isl.size.w, isl.size.h, false);
  for (let i = 0; i < mask.length; i++) grid.usable[i] = mask[i];
  return grid;
}

describe("planLattice (clusters co-localisés + gros gain-prunés)", () => {
  it("floor 0.8 : ~80 % des maisons PLEINEMENT couvertes (sémantique par-maison)", () => {
    const W = 128, R = 55;
    const grid = makeGrid(W, W, false);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      if ((x - W / 2) ** 2 + (y - W / 2) ** 2 <= R * R) grid.usable[y * W + x] = true;
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    expect(r.houses).toBeGreaterThan(50);
    // garantie : la fraction de maisons au tier-cible respecte le floor (± marge greedy)
    expect(r.fullyCovered / r.houses).toBeGreaterThanOrEqual(0.78);
  });

  it("tous les types requis posés >= 1 fois", () => {
    const grid = makeGrid(120, 120);
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    const required = [...new Set(tierRich.services.map((s) => s.building).filter((b): b is string => !!b))]
      .filter((b) => { const d = lookup(b); return !!d && !!(d.streetRange || d.radius?.range); });
    for (const id of required) expect(r.servicesPlaced[id] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("pas de chevauchement, rien sur l'eau, maisons accès route", () => {
    const grid = realIsland("roman_island_medium_01");
    const W = grid.w;
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    const occ = new Set<string>();
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
      const w = b.rotation === 90 || b.rotation === 270 ? d.size.h : d.size.w;
      const h = b.rotation === 90 || b.rotation === 270 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = `${b.x + i},${b.y + j}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
        expect(grid.usable[(b.y + j) * W + (b.x + i)]).toBe(true);
      }
    }
    for (const rd of r.roads) expect(grid.usable[rd.y * W + rd.x]).toBe(true);
    // accès route des maisons
    const roads = new Set(r.roads.map((t) => `${t.x},${t.y}`));
    const resDef = lookup(tierRich.residenceId!)!;
    for (const b of r.buildings.filter((b) => b.defId === tierRich.residenceId)) {
      let touch = false;
      for (let j = -1; j <= resDef.size.h && !touch; j++) for (let i = -1; i <= resDef.size.w && !touch; i++) {
        const edge = (i >= 0 && i < resDef.size.w) !== (j >= 0 && j < resDef.size.h);
        if (edge && roads.has(`${b.x + i},${b.y + j}`)) touch = true;
      }
      expect(touch).toBe(true);
    }
  });

  it("régression île RÉELLE (medium_01, T4, floor 0.8) : densité + ratio + %-pleines", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    expect(r.houses).toBeGreaterThanOrEqual(200); // districtPlan : 51 (ancien bug confetti)
    expect(r.fullyCovered / r.houses).toBeGreaterThanOrEqual(0.78);
    // ratio anti-confetti : services bornés par min-cover (districtPlan ~1.5 avec
    // des centaines de copies redondantes ; ici 2.5+ malgré 11 types T4 denses)
    const svc = Object.values(r.servicesPlaced).reduce((a, b) => a + b, 0);
    expect(r.houses / svc).toBeGreaterThanOrEqual(2.5);
  });

  it("floor 1 : toutes les maisons gardées sont couvertes par TOUS les types", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 1 });
    const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: [] };
    expect(streetMin(layout)).toBe(100);
    expect(r.houses).toBeGreaterThan(80);
  });
});
