import { describe, expect, it } from "vitest";
import { buildIslandGrid } from "./islandGrid";
import { islandById, islands } from "./islands";

describe("buildIslandGrid", () => {
  it("produit une grille ½-tuile (cellsPerTile=2) aux dims 2× de l'île", () => {
    const anyId = islands[0].id;
    const isl = islandById(anyId)!;
    const g = buildIslandGrid(anyId)!;
    expect(g.cellsPerTile).toBe(2);
    expect(g.w).toBe(isl.size.w * 2);
    expect(g.h).toBe(isl.size.h * 2);
    expect(g.islandId).toBe(anyId);
    expect(g.usable.length).toBe(g.w * g.h);
  });
  it("île inconnue → undefined", () => {
    expect(buildIslandGrid("nope")).toBeUndefined();
  });
});
