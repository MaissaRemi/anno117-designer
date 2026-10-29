import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeGrid } from "../model/factories";
import { makeLookup } from "../engine/rules";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { cadreDe, catalogueDiagonal, grilleDiagonale } from "./cadreDiagonal";
import { BAS, DROITE, GAUCHE, HAUT, occupation, triangle, trianglesDuCoin } from "./maillageTriangles";

const catalog = rawCatalog as unknown as BuildingDef[];

describe("maillage de triangles", () => {
  it("une case diagonale = les 8 triangles autour d'un coin, comme le dessin de Rémi", () => {
    // coin commun de A6, B6, A7, B7 : colonnes A-B = x 0-1, lignes 6-7 = y 5-6, coin (1, 6)
    const W = 8, H = 8;
    const t = new Set(trianglesDuCoin(W, H, 1, 6));
    expect(t).toEqual(new Set([
      triangle(W, 0, 5, BAS), triangle(W, 0, 5, DROITE), // A6 : bas, droite
      triangle(W, 1, 5, GAUCHE), triangle(W, 1, 5, BAS), // B6 : gauche, bas
      triangle(W, 0, 6, HAUT), triangle(W, 0, 6, DROITE), // A7 : haut, droite
      triangle(W, 1, 6, HAUT), triangle(W, 1, 6, GAUCHE), // B7 : haut, gauche
    ]));
  });

  it("deux cases diagonales voisines se touchent sans se chevaucher, et pavent le plan", () => {
    const g = makeGrid(12, 12);
    const k = cadreDe(12, 12);
    const roads: { x: number; y: number }[] = [];
    for (let r = 0; r < k.Hr; r++) for (let c = 0; c < k.Wr; c++) roads.push({ x: c, y: r });
    const occ = occupation(g, [], roads, makeLookup(catalog), k);
    expect(occ.conflits).toHaveLength(0);
    // tout triangle intérieur est couvert une fois
    for (let i = 0; i < occ.qui.length; i++) expect(occ.qui[i]).toBeGreaterThanOrEqual(0);
  });

  for (const diagonal of [false, true]) {
    it(`roman_island_large_07, plan ${diagonal ? "diagonal" : "droit"} : aucun triangle revendiqué deux fois`, () => {
      const g = downscaleGrid(buildIslandGrid("roman_island_large_07")!);
      const { grid, cadre } = diagonal ? grilleDiagonale(g) : { grid: g, cadre: undefined };
      const cat = diagonal ? catalogueDiagonal(catalog) : catalog;
      const r = planIslandImport({ catalog: cat, grid, tierGuid: "1498", coverageFloor: 0.8, roadType: "pavee" });
      expect(r.houses).toBeGreaterThan(0);
      const occ = occupation(g, r.buildings, r.roads, makeLookup(cat), cadre);
      expect(occ.conflits).toHaveLength(0);
    }, 300_000);
  }
});
