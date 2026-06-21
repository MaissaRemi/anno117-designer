import { describe, expect, it } from "vitest";
import { makeBuildingDef, makeGrid, placeBuilding } from "../model/factories";
import type { PlacedBuilding, RoadTile } from "../model/types";
import { scoreDecode } from "./score";
import type { DecodeOutput } from "./greedy";
import { DEFAULT_WEIGHTS, type OptimizeRequest, type Weights } from "./types";

const house = makeBuildingDef({ id: "house", size: { w: 2, h: 2 } }); // servi (sans portée)
const svcA = makeBuildingDef({ id: "svcA", size: { w: 2, h: 2 }, radius: { kind: "service", range: 30 } }); // fournisseur à rayon
const svcB = makeBuildingDef({ id: "svcB", size: { w: 2, h: 2 }, streetRange: 10 }); // fournisseur portée-rue

function req(items: { defId: string; qty: number }[], weights: Weights): OptimizeRequest {
  return {
    catalog: [house, svcA, svcB],
    grid: makeGrid(40, 40),
    lockedBuildings: [],
    existingRoads: [],
    existingFields: [],
    items,
    weights,
    timeMs: 0,
  };
}
const out = (buildings: PlacedBuilding[], roads: RoadTile[] = []): DecodeOutput =>
  ({ buildings, roads, fields: [], placedByDef: {} });

const W = (w: Partial<Weights>): Weights => ({ count: 0, roads: 0, compact: 0, coverage: 0, ...w });

describe("scoreDecode — fonction objectif", () => {
  it("countTerm : placer plus (du demandé) augmente le score", () => {
    const r = req([{ defId: "house", qty: 10 }], W({ count: 1 }));
    const full = scoreDecode(r, out(Array.from({ length: 10 }, (_, i) => placeBuilding("house", i * 2, 0))));
    const half = scoreDecode(r, out(Array.from({ length: 5 }, (_, i) => placeBuilding("house", i * 2, 0))));
    expect(full.score).toBeCloseTo(100); // (10/10)*100
    expect(half.score).toBeCloseTo(50); // (5/10)*100
    expect(full.score).toBeGreaterThan(half.score);
  });

  it("roadTerm : plus de routes pénalise", () => {
    const r = req([{ defId: "house", qty: 1 }], W({ roads: 1 }));
    const b = [placeBuilding("house", 0, 0)];
    const few = scoreDecode(r, out(b, [{ x: 0, y: 2 }]));
    const many = scoreDecode(r, out(b, Array.from({ length: 20 }, (_, i) => ({ x: i, y: 2 }))));
    expect(many.score).toBeLessThan(few.score);
  });

  it("fillRatio : disposition compacte > étalée", () => {
    const r = req([{ defId: "house", qty: 2 }], W({ compact: 1 }));
    const tight = scoreDecode(r, out([placeBuilding("house", 0, 0), placeBuilding("house", 2, 0)]));
    const spread = scoreDecode(r, out([placeBuilding("house", 0, 0), placeBuilding("house", 30, 30)]));
    expect(tight.score).toBeGreaterThan(spread.score);
  });

  it("B7 : un fournisseur portée-rue dans le rayon d'un autre service n'est PAS compté servi", () => {
    // svcA (rayon 30, euclidien) couvre svcB (portée-rue) posé à côté. svcB est un
    // FOURNISSEUR → exclu du numérateur (fix B7). Sans le fix (exclusion `radius` seule),
    // svcB serait compté comme bâtiment servi → couverture > 0.
    const providersOnly = scoreDecode(
      req([{ defId: "svcA", qty: 1 }, { defId: "svcB", qty: 1 }], W({ coverage: 1 })),
      out([placeBuilding("svcA", 10, 10), placeBuilding("svcB", 13, 10)]),
    );
    expect(providersOnly.breakdown.coverage).toBe(0); // garde B7
    // contrôle : une MAISON (non-fournisseur) dans le rayon de svcA est bien comptée
    const withHouse = scoreDecode(
      req([{ defId: "svcA", qty: 1 }, { defId: "house", qty: 1 }], W({ coverage: 1 })),
      out([placeBuilding("svcA", 10, 10), placeBuilding("house", 13, 10)]),
    );
    expect(withHouse.breakdown.coverage).toBeGreaterThan(0);
  });

  it("requête vide : score fini, pas de NaN (gardes division par 0)", () => {
    const r = req([], DEFAULT_WEIGHTS);
    const s = scoreDecode(r, out([]));
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.placed).toBe(0);
  });
});
