import type { GridShape, PlacedBuilding } from "../model/types";
import { footprintCells, gridScale } from "../engine/geometry";
import type { DefLookup } from "../engine/rules";

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

/**
 * Marque l'emprise des bâtiments donnés comme NON constructible (obstacle) sur une
 * copie de la grille. Sert à faire CONTOURNER l'optimiseur autour des bâtiments
 * verrouillés posés à la main — y compris les diamants 45° (footprintCells gère la
 * rotation). Sans bâtiments → grille inchangée (pas de copie inutile).
 */
export function gridWithObstacles(grid: GridShape, buildings: PlacedBuilding[], lookup: DefLookup): GridShape {
  if (!buildings.length) return grid;
  const cpt = gridScale(grid); // cellules par tuile (½-tuile = 2)
  const usable = grid.usable.slice();
  const block = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < grid.w && y < grid.h) usable[y * grid.w + x] = false;
  };
  for (const b of buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    // On bloque la TUILE entière touchée (bloc cpt×cpt), pas la seule cellule : downscaleGrid
    // n'échantillonne que le coin haut-gauche de chaque tuile → un diamant qui rate ce coin
    // disparaîtrait sinon, et l'optimiseur passerait à travers le bâtiment verrouillé.
    for (const c of footprintCells(def, b.x, b.y, b.rotation, cpt)) {
      const bx = c.x - (c.x % cpt), by = c.y - (c.y % cpt);
      for (let dy = 0; dy < cpt; dy++) for (let dx = 0; dx < cpt; dx++) block(bx + dx, by + dy);
    }
  }
  return { ...grid, usable };
}

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
