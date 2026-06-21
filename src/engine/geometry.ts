// Primitives géométriques. CONVENTION 45° (cf. specs/2026-06-21-diagonal-45-foundation) :
//  - les rotations diagonales (45/135/225/315) rastérisent un rectangle pivoté en DIAMANT ;
//  - à terme la grille est en ½-tuiles (1 tuile = 2 unités, tileToHT/htToTile) — la
//    réinterprétation ×2 de def.size arrive en palier 2 (migration). Ici, additif : les
//    rotations axis restent en unités def.size (comportement inchangé).
import type { BuildingDef, Cell, GridShape, Rotation } from "../model/types";

const isDiagonal = (rot: Rotation): boolean => rot === 45 || rot === 135 || rot === 225 || rot === 315;

/** Dimensions effectives après rotation. Diagonale → bbox carrée du diamant. */
export function footprintSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  const { w, h } = def.size;
  if (isDiagonal(rot)) {
    // demi-largeurs (w,h) ; bbox d'un rectangle pivoté 45° : demi = (w+h)/√2 par axe
    const side = Math.ceil((2 * (w + h)) / Math.SQRT2);
    return { w: side, h: side };
  }
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Liste des cases occupées par un bâtiment posé en (x,y). Diagonale → diamant rastérisé. */
export function footprintCells(def: BuildingDef, x: number, y: number, rot: Rotation): Cell[] {
  const cells: Cell[] = [];
  if (!isDiagonal(rot)) {
    const { w, h } = footprintSize(def, rot);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.push({ x: x + i, y: y + j });
    return cells;
  }
  // diagonale : rectangle (demi-largeurs a,b) pivoté de rot, rastérisé sur la bbox carrée.
  const side = footprintSize(def, rot).w;
  const a = def.size.w, b = def.size.h;
  const cx = x + side / 2, cy = y + side / 2; // centre du bâtiment
  const rad = (-rot * Math.PI) / 180; // rotation INVERSE pour passer en repère local
  const cos = Math.cos(rad), sin = Math.sin(rad);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const dxp = x + i + 0.5 - cx, dyp = y + j + 0.5 - cy; // centre de cellule − centre
    const lx = dxp * cos - dyp * sin, ly = dxp * sin + dyp * cos;
    if (Math.abs(lx) <= a && Math.abs(ly) <= b) cells.push({ x: x + i, y: y + j });
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

/** Voisins 8-connexité (4 ortho + 4 diagonaux) — connexion au coin du jeu 45°. */
export function neighbors8(x: number, y: number): Cell[] {
  return [
    { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
    { x: x + 1, y: y + 1 }, { x: x + 1, y: y - 1 }, { x: x - 1, y: y + 1 }, { x: x - 1, y: y - 1 },
  ];
}

/** 1 tuile-jeu = 2 unités-grille (½-tuile). Conversions de coordonnées. */
export const tileToHT = (n: number): number => n * 2;
export const htToTile = (n: number): number => Math.floor(n / 2);
