import type { GridShape, PlacedBuilding } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { centreDroit, type CadreDiagonal } from "./cadreDiagonal";

/**
 * ═══ LE MAILLAGE COMMUN : 4 TRIANGLES PAR CASE ═════════════════════════════════════════
 *
 * Une case droite, coupée par ses deux diagonales, donne 4 triangles : haut, droite, bas,
 * gauche (la grille du dessin de Rémi, 30/10/2026). C'est le maillage commun aux deux trames :
 *  - une case droite = ses 4 triangles ;
 *  - une case diagonale (losange centré sur un coin) = les 8 triangles qui touchent ce coin,
 *    2 dans chacune des 4 cases autour.
 * Occupation, collisions et jonctions entre trames s'y lisent donc exactement. C'est l'étape 1
 * de la trame mêlée (`docs/superpowers/specs/2026-10-29-diagonales-moteur.md`).
 */
export const HAUT = 0, DROITE = 1, BAS = 2, GAUCHE = 3;

/** Indice du triangle `t` de la case droite (x, y). */
export const triangle = (W: number, x: number, y: number, t: number): number => (y * W + x) * 4 + t;

/** Les 8 triangles d'une case diagonale centrée sur le coin (X, Y) de la grille droite. */
export function trianglesDuCoin(W: number, H: number, X: number, Y: number): number[] {
  const out: number[] = [];
  const add = (x: number, y: number, a: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    out.push(triangle(W, x, y, a), triangle(W, x, y, b));
  };
  add(X - 1, Y - 1, BAS, DROITE); // la case en haut à gauche du coin
  add(X, Y - 1, GAUCHE, BAS); // en haut à droite
  add(X - 1, Y, HAUT, DROITE); // en bas à gauche
  add(X, Y, HAUT, GAUCHE); // en bas à droite
  return out;
}

/** Les 4 triangles d'une case droite. */
export const trianglesDeCase = (W: number, x: number, y: number): number[] =>
  [HAUT, DROITE, BAS, GAUCHE].map((t) => triangle(W, x, y, t));

/** Ce qui occupe un triangle : -1 libre, sinon l'indice de l'objet (bâtiment ou route). */
export interface Occupation {
  W: number;
  H: number;
  qui: Int32Array;
  /** Triangles revendiqués deux fois : `[triangle, premier, second]`. */
  conflits: [number, number, number][];
  /** Triangles occupés hors de la terre constructible (`usable`) de la grille droite. */
  horsTerre: number;
}

/**
 * Projette un plan sur le maillage. `cadre` absent : plan droit, en cases de la grille ;
 * présent : plan dans le repère diagonal. Les routes reçoivent les indices qui suivent ceux des
 * bâtiments. Les conduites d'eau ne sont pas projetées : elles enjambent les routes.
 */
export function occupation(
  grille: GridShape,
  buildings: PlacedBuilding[],
  roads: { x: number; y: number }[],
  lookup: DefLookup,
  cadre?: CadreDiagonal,
): Occupation {
  const W = grille.w, H = grille.h;
  const qui = new Int32Array(W * H * 4).fill(-1);
  const conflits: [number, number, number][] = [];
  let horsTerre = 0;
  const prendre = (tris: number[], id: number) => {
    for (const t of tris) {
      if (!grille.usable[(t / 4) | 0] && !grille.rivers?.[(t / 4) | 0] && !grille.voies?.[(t / 4) | 0]) horsTerre++;
      if (qui[t] >= 0 && qui[t] !== id) conflits.push([t, qui[t], id]);
      else qui[t] = id;
    }
  };
  const cellule = (c: number, r: number): number[] => {
    if (!cadre) return c >= 0 && r >= 0 && c < W && r < H ? trianglesDeCase(W, c, r) : [];
    const { X, Y } = centreDroit(cadre, c, r);
    return trianglesDuCoin(W, H, X, Y);
  };
  buildings.forEach((b, i) => {
    const d = lookup(b.defId);
    if (!d) return;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let k = 0; k < fp.w; k++) prendre(cellule(b.x + k, b.y + j), i);
  });
  roads.forEach((r, i) => prendre(cellule(r.x, r.y), buildings.length + i));
  return { W, H, qui, conflits, horsTerre };
}
