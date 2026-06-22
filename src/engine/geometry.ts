// Primitives géométriques. CONVENTION 45° + DEMI-TUILES (cf. specs/2026-06-21-diagonal-45) :
//  - les rotations diagonales (45/135/225/315) rastérisent un rectangle pivoté en DIAMANT ;
//  - la grille VIVANTE (éditeur/rendu) est en ½-tuiles : 1 tuile-jeu = 2 cellules
//    (GridShape.cellsPerTile = 2). L'optimiseur tourne en TUILES (cellsPerTile absent → 1)
//    derrière un adaptateur (downscale/upscale). La géométrie est donc paramétrée par
//    `scale` (= cellules par tuile) : def.size reste en TUILES, multiplié ×scale ici.
//  - scale par défaut = 1 (tuiles) ; les consommateurs « vivants » passent scale=2.
import type { BuildingDef, Cell, GridShape, Rotation } from "../model/types";

/** Rotation diagonale (diamant) ? */
export const isDiagonal = (rot: Rotation): boolean => rot === 45 || rot === 135 || rot === 225 || rot === 315;

/** Cellules par tuile d'une grille (½-tuile = 2 ; tuile/optimiseur = 1 par défaut). */
export const gridScale = (g: GridShape): number => g.cellsPerTile ?? 1;

/** Dimensions effectives après rotation, EN CELLULES (def.size ×scale). Diagonale → bbox carrée. */
export function footprintSize(def: BuildingDef, rot: Rotation, scale = 1): { w: number; h: number } {
  const w = def.size.w * scale, h = def.size.h * scale;
  if (isDiagonal(rot)) {
    // bbox d'un rectangle (w×h cellules) pivoté 45° : côté = (w+h)/√2 (diamètre du diamant)
    const side = Math.ceil((w + h) / Math.SQRT2);
    return { w: side, h: side };
  }
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Liste des cases occupées (EN CELLULES) par un bâtiment posé en (x,y). Diagonale → diamant rastérisé. */
export function footprintCells(def: BuildingDef, x: number, y: number, rot: Rotation, scale = 1): Cell[] {
  const cells: Cell[] = [];
  if (!isDiagonal(rot)) {
    const { w, h } = footprintSize(def, rot, scale);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.push({ x: x + i, y: y + j });
    return cells;
  }
  // diagonale : rectangle (w×h cellules, demi-largeurs a,b) pivoté de rot, rastérisé sur la bbox carrée.
  // Règle "aire" (packing serré, cf. objectif densité) : cellule bloquée si >= 50 % de son
  // aire est dans le rectangle → sous-échantillonnage SS×SS, seuil SS²/2. ~aire préservée.
  const w = def.size.w * scale, h = def.size.h * scale;
  const side = Math.ceil((w + h) / Math.SQRT2); // = footprintSize diagonal, recalculé inline
  const a = w / 2, b = h / 2; // demi-largeurs en cellules
  const cx = x + side / 2, cy = y + side / 2; // centre du bâtiment
  const rad = (-rot * Math.PI) / 180; // rotation INVERSE pour passer en repère local
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const SS = 4, thresh = (SS * SS) / 2; // 4×4 sous-points/cellule, >= 50 %
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    let inside = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const dxp = x + i + (si + 0.5) / SS - cx, dyp = y + j + (sj + 0.5) / SS - cy;
      const lx = dxp * cos - dyp * sin, ly = dxp * sin + dyp * cos;
      if (Math.abs(lx) <= a && Math.abs(ly) <= b) inside++;
    }
    if (inside >= thresh) cells.push({ x: x + i, y: y + j });
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

/** Décode une clé "x,y" en cellule (inverse de cellKey ; sans alloc de tableau). */
export const parseCellKey = (key: string): Cell => {
  const i = key.indexOf(",");
  return { x: +key.slice(0, i), y: +key.slice(i + 1) };
};

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

/** 1 tuile-jeu = 2 cellules (½-tuile). Conversions de coordonnées. */
export const tileToHT = (n: number): number => n * 2;
export const htToTile = (n: number): number => Math.floor(n / 2);
