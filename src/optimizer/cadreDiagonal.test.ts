import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, GridShape } from "../model/types";
import { makeGrid } from "../model/factories";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIsland, type IslandPlanResult } from "./islandPlan";
import { keepMainLandmass } from "./kontor";
import {
  cadreDe, catalogueDiagonal, centreDroit, grilleDiagonale, polygoneDroit, versDiagonalPoint, versDroitPoint,
} from "./cadreDiagonal";

const catalog = rawCatalog as unknown as BuildingDef[];

describe("repère diagonal", () => {
  it("une case diagonale est centrée sur un coin, ses voisines sur les coins en biais", () => {
    const k = cadreDe(10, 10);
    const a = centreDroit(k, 4, k.offV), b = centreDroit(k, 5, k.offV), c = centreDroit(k, 4, k.offV + 1);
    expect([b.X - a.X, b.Y - a.Y]).toEqual([1, 1]);
    expect([c.X - a.X, c.Y - a.Y]).toEqual([-1, 1]);
    const p = versDiagonalPoint(k, 3.25, 7.5);
    expect(versDroitPoint(k, p.c, p.r)).toEqual({ x: 3.25, y: 7.5 });
  });

  it("un losange couvre 2 cases droites : 2 × 2 cases diagonales font 8 cases, une maison 3 × 3 droite 9", () => {
    const k = cadreDe(20, 20);
    const poly = polygoneDroit(k, 5, k.offV, 2, 2);
    let aire = 0;
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      aire += p.x * q.y - q.x * p.y;
    }
    expect(Math.abs(aire) / 2).toBeCloseTo(8);
  });

  it("une case diagonale n'est constructible que si ses 4 cases droites le sont", () => {
    const g: GridShape = makeGrid(6, 6);
    g.usable[2 * 6 + 2] = false; // la case droite (2, 2)
    const { grid, cadre } = grilleDiagonale(g);
    for (let r = 0; r < grid.h; r++) for (let c = 0; c < grid.w; c++) {
      const { X, Y } = centreDroit(cadre, c, r);
      const touche = [[X - 1, Y - 1], [X, Y - 1], [X - 1, Y], [X, Y]].some(([x, y]) => x === 2 && y === 2);
      if (touche) expect(grid.usable[r * grid.w + c]).toBe(false);
    }
  });

  it("le catalogue diagonal : maison 3 × 3 → 2 × 2 (mesuré en jeu), portées-rue divisées par √2", () => {
    const maison = catalog.find((d) => d.id === "g3141")!;
    const diag = catalogueDiagonal(catalog).find((d) => d.id === "g3141")!;
    expect(maison.size).toEqual({ w: 3, h: 3 });
    expect(diag.size).toEqual({ w: 2, h: 2 });
    // la portée est une longueur de trajet : un losange de route est long de √2
    const taverne = catalogueDiagonal(catalog).find((d) => d.streetRange && d.radius)!;
    expect(taverne.streetRange! * Math.SQRT2).toBeCloseTo(catalog.find((d) => d.id === taverne.id)!.streetRange!);
  });
});

describe("terre gardée autour du comptoir", () => {
  it("la plus grande terre du voisinage, pas la première trouvée", () => {
    // une case isolée collée au comptoir, la terre principale deux cases plus loin
    const g = makeGrid(20, 20);
    g.usable.fill(false);
    g.usable[5 * 20 + 5] = true;
    for (let y = 2; y < 18; y++) for (let x = 8; x < 18; x++) g.usable[y * 20 + x] = true;
    const kept = keepMainLandmass(g, { x: 5, y: 5 });
    expect(kept.usable[5 * 20 + 5]).toBe(false);
    expect(kept.usable[10 * 20 + 10]).toBe(true);
  });
});

describe("trame diagonale dans les plans au choix", () => {
  // small_05 : la seule île romaine où la diagonale gagne nettement (+41 % d'habitants) une fois
  // la portée comptée en longueur (√2 par losange) ; large_07, l'exemple d'avant, y perd 10 %.
  it("roman_island_small_05 : le plan diagonal est proposé, dans son repère", () => {
    const r = planIsland({
      catalog, grid: downscaleGrid(buildIslandGrid("roman_island_small_05")!), tierGuid: "1498",
      coverageFloor: 0.8, roadType: "pavee", essayerDiagonale: true,
    }) as IslandPlanResult;
    expect(r.repere).toBeUndefined(); // le recommandé reste le plan droit
    const diag = (r.alternatives ?? []).find((a) => a.repere?.type === "diagonal");
    expect(diag).toBeDefined();
    expect(diag!.houses).toBeGreaterThan(0);
    expect(diag!.gaps[0]).toMatch(/expérimental/);
  }, 600_000);
});
