import type { BuildingDef, GridShape } from "../model/types";

/**
 * ═══ LE REPÈRE DIAGONAL ═══════════════════════════════════════════════════════════════
 *
 * En jeu, une route diagonale est faite de losanges de côté √2 centrés sur les coins de la
 * grille, pointes sur les 4 coins voisins (route de √2 de large, 2 cases sur une ligne
 * horizontale). Un bâtiment posé en diagonale s'aligne sur ces losanges : une maison 3 × 3
 * droite y fait 2 × 2 cases de route (mesuré en jeu le 30/10/2026). Cf.
 * `docs/superpowers/specs/2026-10-29-diagonales-moteur.md`.
 *
 * Ces losanges pavent le plan : ce sont les cases d'une grille TOURNÉE de 45°, de côté √2.
 * Un quartier diagonal est donc un quartier droit dans cette grille — les moteurs y tournent
 * tels quels, avec un catalogue remis à l'échelle.
 *
 * Repère : la case diagonale (c, r) est centrée sur le coin de la grille droite
 *   X = u − v,  Y = u + v,  avec u = c et v = r − offV,
 * et couvre la moitié de chacune des 4 cases droites autour de ce coin.
 */
export interface CadreDiagonal {
  /** Dimensions de la grille droite, en cases. */
  W: number;
  H: number;
  /** Décalage des lignes : v = r − offV peut être négatif. */
  offV: number;
  /** Dimensions de la grille diagonale. */
  Wr: number;
  Hr: number;
}

export function cadreDe(W: number, H: number): CadreDiagonal {
  const offV = Math.ceil(W / 2);
  return { W, H, offV, Wr: Math.floor((W + H) / 2) + 1, Hr: offV + Math.floor(H / 2) + 1 };
}

/** Coin de la grille droite au centre de la case diagonale (c, r). */
export function centreDroit(k: CadreDiagonal, c: number, r: number): { X: number; Y: number } {
  const v = r - k.offV;
  return { X: c - v, Y: c + v };
}

/** Point continu de la grille droite → coordonnées continues de la grille diagonale. */
export function versDiagonalPoint(k: CadreDiagonal, x: number, y: number): { c: number; r: number } {
  return { c: (x + y) / 2, r: (y - x) / 2 + k.offV };
}

/** Point continu de la grille diagonale → grille droite. */
export function versDroitPoint(k: CadreDiagonal, c: number, r: number): { x: number; y: number } {
  const v = r - k.offV;
  return { x: c - v, y: c + v };
}

/**
 * Les 4 sommets, en coordonnées de la grille droite, d'un rectangle de cases diagonales
 * [c, c+w) × [r, r+h) : un losange (ou un parallélogramme tourné) dans l'île.
 */
export function polygoneDroit(k: CadreDiagonal, c: number, r: number, w: number, h: number): { x: number; y: number }[] {
  return [
    versDroitPoint(k, c - 0.5, r - 0.5),
    versDroitPoint(k, c + w - 0.5, r - 0.5),
    versDroitPoint(k, c + w - 0.5, r + h - 0.5),
    versDroitPoint(k, c - 0.5, r + h - 0.5),
  ];
}

/**
 * La grille d'une île (en cases droites) vue dans le repère diagonal. Une case diagonale est
 * constructible si les 4 cases droites qu'elle chevauche le sont ; elle est d'eau, de relief,
 * de rivière ou réservée à la route dès que l'une d'elles l'est.
 */
export function grilleDiagonale(g: GridShape): { grid: GridShape; cadre: CadreDiagonal } {
  const k = cadreDe(g.w, g.h);
  const N = k.Wr * k.Hr;
  const usable = new Array<boolean>(N).fill(false);
  const water = g.water ? new Array<boolean>(N).fill(false) : undefined;
  const relief = g.relief ? new Array<boolean>(N).fill(false) : undefined;
  const rivers = g.rivers ? new Array<boolean>(N).fill(false) : undefined;
  const voies = g.voies ? new Array<boolean>(N).fill(false) : undefined;
  const at = (m: boolean[] | undefined, x: number, y: number) =>
    !!m && x >= 0 && y >= 0 && x < g.w && y < g.h && m[y * g.w + x];
  for (let r = 0; r < k.Hr; r++) for (let c = 0; c < k.Wr; c++) {
    const { X, Y } = centreDroit(k, c, r);
    const autour: [number, number][] = [[X - 1, Y - 1], [X, Y - 1], [X - 1, Y], [X, Y]];
    const i = r * k.Wr + c;
    usable[i] = autour.every(([x, y]) => at(g.usable, x, y));
    if (water) water[i] = autour.some(([x, y]) => at(g.water, x, y));
    if (relief) relief[i] = autour.some(([x, y]) => at(g.relief, x, y));
    if (rivers) rivers[i] = autour.some(([x, y]) => at(g.rivers, x, y));
    if (voies) voies[i] = autour.some(([x, y]) => at(g.voies, x, y));
  }
  const slots = g.slots?.map((s) => {
    const p = versDiagonalPoint(k, s.x, s.y);
    return { ...s, x: p.c, y: p.r };
  });
  return {
    cadre: k,
    grid: {
      w: k.Wr, h: k.Hr, usable, water, relief, rivers, voies, slots, islandId: g.islandId, cellsPerTile: 1,
    },
  };
}

/** Hauteurs (une par case droite) → une par case diagonale : la plus haute des 4 chevauchées. */
export function hauteursDiagonales(h: Int8Array, g: { w: number; h: number }, k: CadreDiagonal): Int8Array {
  const out = new Int8Array(k.Wr * k.Hr).fill(-128);
  for (let r = 0; r < k.Hr; r++) for (let c = 0; c < k.Wr; c++) {
    const { X, Y } = centreDroit(k, c, r);
    let m = -128;
    for (const [x, y] of [[X - 1, Y - 1], [X, Y - 1], [X - 1, Y], [X, Y]]) {
      if (x >= 0 && y >= 0 && x < g.w && y < g.h) m = Math.max(m, h[y * g.w + x]);
    }
    out[r * k.Wr + c] = m;
  }
  return out;
}

/** Une longueur en cases droites, comptée en cases diagonales (côté √2). */
const enDiagonale = (n: number): number => Math.max(1, Math.round(n / Math.SQRT2));

/**
 * Le catalogue à l'échelle du repère diagonal : emprises divisées par √2 et arrondies (3 → 2,
 * mesuré en jeu), portées euclidiennes aussi. Les portées le long des routes restent en cases
 * de route : une case diagonale compte pour un pas (hypothèse, à vérifier en jeu). La partie
 * dans l'eau des bâtiments côtiers est ignorée : leur pose diagonale n'est pas modélisée.
 */
export function catalogueDiagonal(catalog: BuildingDef[]): BuildingDef[] {
  return catalog.map((d) => ({
    ...d,
    size: { w: enDiagonale(d.size.w), h: enDiagonale(d.size.h) },
    ...(d.radius ? { radius: { ...d.radius, range: enDiagonale(d.radius.range) } } : {}),
    ...(d.freeArea ? { freeArea: { radius: enDiagonale(d.freeArea.radius), area: Math.max(1, Math.round(d.freeArea.area / 2)) } } : {}),
    ...(d.field ? { field: { ...d.field, tiles: Math.max(1, Math.round(d.field.tiles / 2)) } } : {}),
    partieEau: undefined,
  }));
}
