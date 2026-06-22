import type { GridShape, PlacedBuilding } from "../model/types";

/**
 * Adaptateur ½-tuile ⇄ tuile pour l'optimiseur. La grille VIVANTE est en ½-tuiles
 * (cellsPerTile=2, cf. geometry.ts) mais les moteurs (planLattice/packPlan/prodPlan)
 * tournent en TUILES — inchangés, leurs golden-snapshots intacts, et leurs routes
 * font 1 tuile de large (constructibles en jeu). On RÉSOUT donc en tuiles puis on
 * REPROJETTE le résultat en ½-tuiles :
 *  - downscaleGrid : ½-tuile → tuile (chaque bloc 2×2 → 1 tuile, coin haut-gauche) ;
 *  - upscale du résultat : bâtiments ×2 (l'emprise re-double via cellsPerTile=2) ;
 *    routes/champs/aqueducs → bloc 2×2 (1 tuile = 2×2 cellules → route large 1 tuile).
 */

/** Inverse de upscale2x : ½-tuile → tuile (coin haut-gauche de chaque bloc 2×2). */
export function downscaleGrid(g: GridShape): GridShape {
  if ((g.cellsPerTile ?? 1) === 1) return g; // déjà en tuiles
  const W = g.w, tw = Math.floor(W / 2), th = Math.floor(g.h / 2);
  const pick = (src: boolean[] | undefined): boolean[] | undefined => {
    if (!src) return undefined;
    const out = new Array<boolean>(tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) out[y * tw + x] = src[2 * y * W + 2 * x];
    return out;
  };
  return {
    w: tw,
    h: th,
    usable: pick(g.usable)!,
    water: pick(g.water),
    rivers: pick(g.rivers),
    slots: g.slots?.map((s) => ({ ...s, x: Math.floor(s.x / 2), y: Math.floor(s.y / 2) })),
    islandId: g.islandId,
    // cellsPerTile absent → tuile (scale 1) côté moteurs/coverage
  };
}

/** Bâtiments tuile → ½-tuile : position ×2 (l'emprise re-double via cellsPerTile=2). */
export function upscaleBuildings(blds: PlacedBuilding[]): PlacedBuilding[] {
  return blds.map((b) => ({ ...b, x: b.x * 2, y: b.y * 2 }));
}

/** Tuiles (route/champ/aqueduc) tuile → ½-tuile : 1 tuile → bloc 2×2 (route large 1 tuile). */
export function upscaleTiles<T extends { x: number; y: number }>(tiles: T[]): T[] {
  const out: T[] = [];
  for (const t of tiles) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      out.push({ ...t, x: t.x * 2 + dx, y: t.y * 2 + dy });
    }
  }
  return out;
}

/** Reprojette un résultat de plan d'île (tuile) en ½-tuiles si la grille d'origine l'était. */
export function scaleResultToHalfTile<
  R extends {
    buildings: PlacedBuilding[];
    roads: { x: number; y: number }[];
    fields: { x: number; y: number }[];
    aqueducts?: { x: number; y: number }[];
  },
>(result: R, halfTile: boolean): R {
  if (!halfTile) return result;
  return {
    ...result,
    buildings: upscaleBuildings(result.buildings),
    roads: upscaleTiles(result.roads),
    fields: upscaleTiles(result.fields),
    ...(result.aqueducts ? { aqueducts: upscaleTiles(result.aqueducts) } : {}),
  };
}
