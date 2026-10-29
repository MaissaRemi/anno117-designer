/**
 * ═══ LE RÉSEAU ROUTIER EN GRAPHE ═══════════════════════════════════════════════════════
 *
 * Trame mêlée, étape 2 (`docs/superpowers/specs/2026-10-29-reseau-routier-graphe.md`). Une
 * route du jeu est un graphe de tronçons ; ses cases sont de deux sortes :
 *  - DROITE : la case (x, y) de la grille, identifiant `y·W + x`, dans [0, N) — l'indice de
 *    case de tous les moteurs ;
 *  - LOSANGE : la case diagonale centrée sur le coin (X, Y) de la grille, 0 ≤ X ≤ W,
 *    0 ≤ Y ≤ H, identifiant `N + Y·(W+1) + X`. Elle couvre la moitié des 4 cases autour du
 *    coin (ses 8 triangles : `trianglesDuCoin`), pointes sur les 4 coins voisins.
 * Tous les coins sont admis, quelle que soit la parité de X + Y. Deux losanges qui se
 * chevauchent sont refusés par l'occupation en triangles, pas ici.
 *
 * Arêtes, figées par la géométrie :
 *  - droite – droite : un côté partagé, les 4 voisines ;
 *  - losange – losange : un côté partagé, les coins (X ± 1, Y ± 1) ;
 *  - droite – losange : JONCTION DE TRAME, la pointe du losange sur un coin du carré, sans
 *    chevauchement — 8 losanges par carré, 8 carrés par losange. Règle géométrique, encore à
 *    vérifier en jeu (question Q1 de la conception).
 * Deux objets de même orientation qui ne se touchent que par un point ne sont pas reliés :
 * deux cases droites en coin (comportement établi des moteurs), deux losanges pointe contre
 * pointe (hypothèse, Q2).
 *
 * Un bâtiment se raccorde de la même façon : par un côté à une route de son orientation, par
 * un point à une route de l'autre (vérifié en jeu, 30/10/2026).
 *
 * L'état reste dans deux masques modifiables en place — `droite` est l'actuel `roadAt` des
 * moteurs. Le graphe est IMPLICITE : rien à reconstruire quand une route est posée ou retirée.
 *
 * ORDRE D'ÉNUMÉRATION : les cases droites d'abord, dans l'ordre des moteurs (gauche, droite,
 * haut, bas — celui de `streetGrid.bfsType`), PUIS les losanges. Sans losange, un parcours
 * visite donc les mêmes cases dans le même ordre qu'avant : mêmes `parent`, même plan.
 */

export interface ReseauRoutier {
  W: number;
  H: number;
  /** Nombre de cases droites, W·H ; premier identifiant de losange. */
  N: number;
  /** Cases droites portant une route (l'actuel `roadAt`). */
  droite: Uint8Array;
  /** Losanges portant une route, indexés par coin : `Y·(W+1) + X`. */
  losange: Uint8Array;
}

export function reseauVide(W: number, H: number): ReseauRoutier {
  return { W, H, N: W * H, droite: new Uint8Array(W * H), losange: new Uint8Array((W + 1) * (H + 1)) };
}

/** Réseau des seules cases droites `roads` ; celles hors de la grille sont ignorées. */
export function reseauDeCases(W: number, H: number, roads: readonly { x: number; y: number }[]): ReseauRoutier {
  const r = reseauVide(W, H);
  for (const c of roads) if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) r.droite[c.y * W + c.x] = 1;
  return r;
}

/** Nombre total d'identifiants : cases droites puis coins. */
export const tailleReseau = (r: ReseauRoutier): number => r.N + (r.W + 1) * (r.H + 1);

export const idLosange = (r: ReseauRoutier, X: number, Y: number): number => r.N + Y * (r.W + 1) + X;
export const estLosange = (r: ReseauRoutier, id: number): boolean => id >= r.N;
/** Coin (X, Y) du losange `id`. */
export function coinDe(r: ReseauRoutier, id: number): { X: number; Y: number } {
  const k = id - r.N;
  return { X: k % (r.W + 1), Y: (k / (r.W + 1)) | 0 };
}

export const estRoute = (r: ReseauRoutier, id: number): boolean =>
  id < r.N ? r.droite[id] === 1 : r.losange[id - r.N] === 1;

const coinValide = (r: ReseauRoutier, X: number, Y: number): boolean => X >= 0 && Y >= 0 && X <= r.W && Y <= r.H;
const caseValide = (r: ReseauRoutier, x: number, y: number): boolean => x >= 0 && y >= 0 && x < r.W && y < r.H;

/**
 * Les 8 losanges qui touchent la case droite (x, y) par une pointe posée sur l'un de ses
 * coins, sans la chevaucher : 2 par coin. Le losange (X, Y) couvre les cases
 * [X−1, X] × [Y−1, Y] ; ses pointes sont (X ± 1, Y) et (X, Y ± 1).
 */
const POINTES_DE_CASE: readonly (readonly [number, number])[] = [
  [-1, 0], [0, -1], // coin haut-gauche (x, y)
  [2, 0], [1, -1], // coin haut-droit (x+1, y)
  [-1, 1], [0, 2], // coin bas-gauche (x, y+1)
  [2, 1], [1, 2], // coin bas-droit (x+1, y+1)
];
/** L'inverse : les 8 cases droites touchées par une pointe du losange (X, Y). */
const CASES_DE_POINTE: readonly (readonly [number, number])[] = POINTES_DE_CASE.map(([dx, dy]) => [-dx, -dy] as const);
/** Losanges voisins par un côté. */
const COTES_DE_LOSANGE: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export const idDroite = (r: ReseauRoutier, x: number, y: number): number => y * r.W + x;

/**
 * Tous les nœuds (route ou non) au contact du nœud `id` — la relation unique du réseau : par
 * un côté entre objets de même orientation, par un point entre une case droite et un losange.
 * C'est à la fois l'arête du graphe (entre deux routes) et le raccordement d'une case de
 * bâtiment (droite ou losange) aux routes. Case droite : les cases gauche, droite, haut, bas
 * (ordre de `streetGrid.bfsType`), puis les 8 losanges en pointe. Losange : ses 4 voisins par
 * un côté, puis les 8 cases droites en pointe. Hors de la grille : sautés.
 */
export function noeudsAuContact(r: ReseauRoutier, id: number, f: (id: number) => void): void {
  const { W, H, N } = r;
  if (id < N) {
    const x = id % W, y = (id / W) | 0;
    if (x > 0) f(id - 1);
    if (x < W - 1) f(id + 1);
    if (y > 0) f(id - W);
    if (y < H - 1) f(id + W);
    for (const [dx, dy] of POINTES_DE_CASE) if (coinValide(r, x + dx, y + dy)) f(idLosange(r, x + dx, y + dy));
    return;
  }
  const { X, Y } = coinDe(r, id);
  for (const [dx, dy] of COTES_DE_LOSANGE) if (coinValide(r, X + dx, Y + dy)) f(idLosange(r, X + dx, Y + dy));
  for (const [dx, dy] of CASES_DE_POINTE) if (caseValide(r, X + dx, Y + dy)) f((Y + dy) * W + X + dx);
}

/**
 * Les routes au contact du nœud `id` : ses voisines dans le graphe si `id` est une route, les
 * points de départ d'une case de bâtiment sinon.
 */
export function voisins(r: ReseauRoutier, id: number, f: (id: number) => void): void {
  noeudsAuContact(r, id, (n) => { if (estRoute(r, n)) f(n); });
}

/**
 * Les cases droites au contact du nœud `id` : celles qu'une route atteinte sert, puisqu'un
 * bâtiment droit qui en occupe une s'y raccorde.
 */
export function casesAuContact(r: ReseauRoutier, id: number, f: (c: number) => void): void {
  noeudsAuContact(r, id, (n) => { if (n < r.N) f(n); });
}

/** Nombre de routes voisines. */
export function degre(r: ReseauRoutier, id: number): number {
  let n = 0;
  voisins(r, id, () => { n++; });
  return n;
}

/**
 * Un parcours réutilisable : `dist` (−1 non atteint, 1 pour une source), `parent` (−2 non
 * atteint, −1 pour une source), `atteints` dans l'ordre de visite. Relancer un parcours ne
 * remet à zéro que les nœuds atteints la fois précédente.
 */
export interface Parcours {
  dist: Int32Array;
  parent: Int32Array;
  atteints: number[];
}

export function creerParcours(r: ReseauRoutier): Parcours {
  const n = tailleReseau(r);
  return { dist: new Int32Array(n).fill(-1), parent: new Int32Array(n).fill(-2), atteints: [] };
}

/**
 * PORTÉE le long des routes, en nœuds : une case de route, droite ou losange, compte pour
 * un pas (vérifié en jeu). Les sources (des routes) sont à distance 1 ; le parcours s'étend
 * tant que la distance est sous `portee` — la sémantique de `streetGrid.bfsType` et de
 * `streetCoverage`. `portee` = Infinity : tout le réseau joignable.
 */
export function parcourir(r: ReseauRoutier, p: Parcours, sources: Iterable<number>, portee = Infinity): void {
  for (const id of p.atteints) { p.dist[id] = -1; p.parent[id] = -2; }
  p.atteints.length = 0;
  let front: number[] = [];
  for (const s of sources) {
    if (p.dist[s] >= 0 || !estRoute(r, s)) continue;
    p.dist[s] = 1; p.parent[s] = -1;
    p.atteints.push(s); front.push(s);
  }
  for (let d = 1; front.length && d < portee; d++) {
    const suivant: number[] = [];
    for (const c of front) {
      voisins(r, c, (n) => {
        if (p.dist[n] >= 0) return;
        p.dist[n] = d + 1; p.parent[n] = c;
        p.atteints.push(n); suivant.push(n);
      });
    }
    front = suivant;
  }
}
