import { describe, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import rawIslands from "../data/islands.generated.json";
import { decodeMask } from "../data/islands";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape, Layout } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { analyzeCoverage } from "../economy/coverage";
import { buildTierProfile } from "../economy/solve";
import { planDistricts } from "./districtPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const tierTest = economy.tiers.find(
  (t) => t.residenceId && t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).length >= 3,
)!;
const patri = economy.tiers.find((t) => /atricien/i.test(t.name))!;
const islands = rawIslands as any[];

function report(label: string, grid: GridShape, tierGuid: string, floor = 1, serviceIds?: string[]) {
  const t0 = Date.now();
  const r = planDistricts(grid, tierGuid, lookup, { coverageFloor: floor, serviceIds });
  const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: [] };
  const an = analyzeCoverage(layout, lookup); // street = métrique du jeu
  const per = an.services.filter((s) => s.hasRadius).map((s) => `${s.name}:${s.pct}%(${s.present})`).join(" ");
  console.log(`${label}: houses=${r.houses} roads=${r.roads.length} bld=${r.buildings.length} ${Date.now() - t0}ms`);
  console.log("   ", per);
  return r;
}

describe("diag districts", () => {
  it("rect sizes (tier test)", () => {
    console.log("tier:", tierTest.name);
    for (const sz of [80, 120, 160, 192]) report(`${sz}²`, makeGrid(sz, sz), tierTest.guid);
  });
  it("île réelle Patriciens", () => {
    const isl = islands[0];
    const grid: GridShape = { w: isl.size.w, h: isl.size.h, usable: decodeMask(isl.mask, isl.size.w, isl.size.h) };
    const land = grid.usable.filter(Boolean).length;
    console.log("terre:", land, "résidence:", lookup(patri.residenceId!)?.size);
    // mode seuils : services retenus seulement
    const prof = buildTierProfile(patri.guid, { needSelection: "thresholds" });
    const retained = [...new Set(prof.services.map((s) => s.building).filter((b): b is string => !!b))];
    console.log("services retenus (seuils):", retained.length, "cap:", prof.cap);
    report(`${isl.name} SEUILS floor=1`, grid, patri.guid, 1, retained);
    const r = report(`${isl.name} floor=1`, grid, patri.guid, 1);
    // où sont les services, et y a-t-il des routes autour ?
    const roadSet = new Set(r.roads.map((t) => `${t.x},${t.y}`));
    for (const b of r.buildings) {
      if (b.defId === patri.residenceId) continue;
      const d = lookup(b.defId)!;
      let near = 0;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        if (roadSet.has(`${b.x + dx},${b.y + dy}`)) near++;
      }
      let landN = 0;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        const x = b.x + dx, y = b.y + dy;
        if (x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.usable[y * grid.w + x]) landN++;
      }
      console.log(`  ${d.name} @(${b.x},${b.y}) routes±12=${near} terre±12=${landN}/625`);
    }
  });
});
