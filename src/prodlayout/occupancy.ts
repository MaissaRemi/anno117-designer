/**
 * Grille d'occupation du blueprint. Un octet par case, pas de structure par case : le
 * placeur essaie une douzaine de boîtes et rejoue chacune entièrement, donc l'allocation
 * doit rester triviale.
 */

export const FREE = 0;
export const BUILDING = 1;
export const ROAD = 2;
export const FIELD = 3;
/** Aire libre réservée autour d'un bâtiment à `freeArea` : traversable, jamais bâtie. */
export const RESERVED = 4;

export interface Occ {
  w: number;
  h: number;
  cell: Uint8Array;
}

export const makeOcc = (w: number, h: number): Occ => ({ w, h, cell: new Uint8Array(w * h) });

export const inBox = (o: Occ, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < o.w && y < o.h;

/** Contenu d'une case, ou -1 hors limites. */
export const at = (o: Occ, x: number, y: number): number =>
  inBox(o, x, y) ? o.cell[y * o.w + x] : -1;

export const setAt = (o: Occ, x: number, y: number, v: number): void => {
  if (inBox(o, x, y)) o.cell[y * o.w + x] = v;
};

/** Le rectangle tient-il entièrement dans la boîte, sur des cases libres ? */
export function fits(o: Occ, x: number, y: number, w: number, h: number): boolean {
  if (x < 0 || y < 0 || x + w > o.w || y + h > o.h) return false;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) if (o.cell[(y + j) * o.w + x + i] !== FREE) return false;
  }
  return true;
}

export function fill(o: Occ, x: number, y: number, w: number, h: number, v: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setAt(o, x + i, y + j, v);
}

/** Nombre de cases portant une valeur donnée. */
export function count(o: Occ, v: number): number {
  let n = 0;
  for (let i = 0; i < o.cell.length; i++) if (o.cell[i] === v) n++;
  return n;
}
