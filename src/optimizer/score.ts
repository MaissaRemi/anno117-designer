import { footprintCells } from "../engine/geometry";
import { computeRadiusCoverage, makeLookup } from "../engine/rules";
import type { Layout } from "../model/types";
import type { DecodeOutput } from "./greedy";
import type { OptimizeRequest } from "./types";

export interface Scored {
  score: number;
  placed: number;
  breakdown: { count: number; roadLen: number; bboxArea: number; coverage: number };
}

export function scoreDecode(req: OptimizeRequest, out: DecodeOutput): Scored {
  const requested = req.items.reduce((s, it) => s + it.qty, 0);
  const placed = out.buildings.length;
  const countTerm = requested ? placed / requested : 0;

  let totalUsable = 0;
  for (let i = 0; i < req.grid.usable.length; i++) if (req.grid.usable[i]) totalUsable++;
  const roadLen = out.roads.length;
  const roadTerm = totalUsable ? roadLen / totalUsable : 0;

  // emprise (bbox) des bâtiments placés + verrouillés
  const lookup = makeLookup(req.catalog);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, buildingCells = 0;
  const all = [...req.lockedBuildings, ...out.buildings];
  for (const b of all) {
    const def = lookup(b.defId);
    if (!def) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation)) {
      buildingCells++;
      if (c.x < bx0) bx0 = c.x;
      if (c.y < by0) by0 = c.y;
      if (c.x > bx1) bx1 = c.x;
      if (c.y > by1) by1 = c.y;
    }
  }
  const bboxArea = bx1 >= bx0 ? (bx1 - bx0 + 1) * (by1 - by0 + 1) : 1;
  const fillRatio = buildingCells / Math.max(bboxArea, 1);

  // couverture par les rayons
  const layout: Layout = {
    grid: req.grid,
    buildings: all,
    roads: [...req.existingRoads, ...out.roads],
    fields: [...req.existingFields, ...out.fields],
  };
  const cov = computeRadiusCoverage(layout, lookup);
  const covered = new Set<string>();
  for (const set of cov.values()) for (const k of set) covered.add(k);
  let coveredBuildingCells = 0;
  for (const b of all) {
    const def = lookup(b.defId);
    // on mesure ce qui est SERVI (hors fournisseurs : rayon classique OU portée-rue)
    if (!def || def.radius || def.streetRange) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation)) {
      if (covered.has(`${c.x},${c.y}`)) coveredBuildingCells++;
    }
  }
  const coverageTerm = buildingCells ? coveredBuildingCells / buildingCells : 0;

  const w = req.weights;
  const score =
    w.count * countTerm * 100 +
    w.coverage * coverageTerm * 20 +
    w.compact * fillRatio * 20 -
    w.roads * roadTerm * 20;

  return {
    score,
    placed,
    breakdown: { count: placed, roadLen, bboxArea, coverage: coverageTerm },
  };
}
