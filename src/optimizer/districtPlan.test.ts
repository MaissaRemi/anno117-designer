import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef, Layout } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { analyzeCoverage } from "../economy/coverage";
import { planDistricts } from "./districtPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).length >= 3,
)!;

// couverture min par DISTANCE-RUE (mécanique réelle, ce que mesure l'UI)
function streetMin(layout: Layout) {
  const an = analyzeCoverage(layout, lookup).services.filter((s) => s.hasRadius);
  return an.length ? Math.min(...an.map((s) => s.pct)) : 100;
}

describe("planDistricts", () => {
  it("place maisons + tous les types de service, avec routes", () => {
    const grid = makeGrid(100, 100);
    const r = planDistricts(grid, tier.guid, lookup);
    expect(r.houses).toBeGreaterThan(50);
    expect(r.roads.length).toBeGreaterThan(0);
    // tous les types de service requis (à rayon) sont posés ≥ 1 fois
    const required = [...new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b))]
      .filter((b) => { const d = lookup(b); return !!d && !!(d.streetRange || d.radius?.range); });
    for (const id of required) expect(r.servicesPlaced[id] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("couverture distance-rue quasi totale par construction (>=90%)", () => {
    const grid = makeGrid(120, 120);
    const r = planDistricts(grid, tier.guid, lookup);
    const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: [] };
    expect(streetMin(layout)).toBeGreaterThanOrEqual(90);
  });

  it("plus de surface => plus de maisons", () => {
    const small = planDistricts(makeGrid(80, 80), tier.guid, lookup).houses;
    const big = planDistricts(makeGrid(160, 160), tier.guid, lookup).houses;
    expect(big).toBeGreaterThan(small);
  });

  it("pas de chevauchement entre bâtiments", () => {
    const grid = makeGrid(100, 100);
    const r = planDistricts(grid, tier.guid, lookup);
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

  it("rendement : grille 192² ≥ 800 maisons (régression densité)", () => {
    const r = planDistricts(makeGrid(192, 192), tier.guid, lookup);
    expect(r.houses).toBeGreaterThanOrEqual(800);
  });

  it("île irrégulière (disque) : s'adapte au contour, rien sur l'eau, couverture par construction", () => {
    // disque de terre rayon 55 dans une grille 128² (le lattice bbox naïf échouait ici)
    const W = 128, cx = 64, cy = 64, R = 55;
    const grid = makeGrid(W, W, false);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= R * R) grid.usable[y * W + x] = true;
    }
    const r = planDistricts(grid, tier.guid, lookup);
    expect(r.houses).toBeGreaterThan(50);
    // tout bâtiment et toute route reste sur la terre
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
      for (let j = 0; j < d.size.h; j++) for (let i = 0; i < d.size.w; i++) {
        expect(grid.usable[(b.y + j) * W + (b.x + i)]).toBe(true);
      }
    }
    for (const rd of r.roads) expect(grid.usable[rd.y * W + rd.x]).toBe(true);
    // tous les types requis posés ≥ 1 fois
    const required = [...new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b))]
      .filter((b) => { const d = lookup(b); return !!d && !!(d.streetRange || d.radius?.range); });
    for (const id of required) expect(r.servicesPlaced[id] ?? 0).toBeGreaterThanOrEqual(1);
    // couverture euclidienne ~totale (filtre par construction)
    const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: [] };
    expect(streetMin(layout)).toBeGreaterThanOrEqual(95);
  });

  it("seuil partiel : floor 0.7 ⇒ plus de maisons, chaque type reste ≥ 70 %", () => {
    const W = 128, cx = 64, cy = 64, R = 55;
    const grid = makeGrid(W, W, false);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= R * R) grid.usable[y * W + x] = true;
    }
    const full = planDistricts(grid, tier.guid, lookup, { coverageFloor: 1 });
    const part = planDistricts(grid, tier.guid, lookup, { coverageFloor: 0.7 });
    expect(part.houses).toBeGreaterThanOrEqual(full.houses);
    const layout: Layout = { grid, buildings: part.buildings, roads: part.roads, fields: [] };
    expect(streetMin(layout)).toBeGreaterThanOrEqual(70);
  });

  it("chaque maison touche une route (accès garanti)", () => {
    const grid = makeGrid(100, 100);
    const r = planDistricts(grid, tier.guid, lookup);
    const roads = new Set(r.roads.map((t) => `${t.x},${t.y}`));
    const houses = r.buildings.filter((b) => b.defId === tier.residenceId);
    for (const b of houses) {
      const d = lookup(b.defId)!;
      let touch = false;
      for (let j = -1; j <= d.size.h && !touch; j++) for (let i = -1; i <= d.size.w && !touch; i++) {
        const edge = (i >= 0 && i < d.size.w) !== (j >= 0 && j < d.size.h); // 4-adjacence (pas les coins)
        if (edge && roads.has(`${b.x + i},${b.y + j}`)) touch = true;
      }
      expect(touch).toBe(true);
    }
  });
});
