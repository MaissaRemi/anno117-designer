import type { BuildingDef, Cell, GridShape, Rotation } from "../model/types";

/** Dimensions effectives après rotation. */
export function footprintSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  const { w, h } = def.size;
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Liste des cases occupées par un bâtiment posé en (x,y). */
export function footprintCells(def: BuildingDef, x: number, y: number, rot: Rotation): Cell[] {
  const { w, h } = footprintSize(def, rot);
  const cells: Cell[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      cells.push({ x: x + i, y: y + j });
    }
  }
  return cells;
}

export const inBounds = (g: GridShape, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < g.w && y < g.h;

export const cellIndex = (g: GridShape, x: number, y: number): number => y * g.w + x;

export const isUsable = (g: GridShape, x: number, y: number): boolean =>
  inBounds(g, x, y) && g.usable[cellIndex(g, x, y)];

/** Case d'eau (mer) ? true seulement si la grille porte une carte `water`. */
export const isWater = (g: GridShape, x: number, y: number): boolean =>
  inBounds(g, x, y) && !!g.water && g.water[cellIndex(g, x, y)];

/**
 * Case constructible pour un bâtiment selon son terrain de pose.
 * - "water" : exige une case d'eau.
 * - "land" (défaut) : exige une case terre utilisable.
 */
export const isBuildable = (g: GridShape, x: number, y: number, placement?: "land" | "water"): boolean =>
  placement === "water" ? isWater(g, x, y) : isUsable(g, x, y);

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Voisins orthogonaux (4-connexité). */
export function orthoNeighbors(x: number, y: number): Cell[] {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}
