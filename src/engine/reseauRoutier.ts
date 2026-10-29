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
 * Le masque `droite` s'écrit directement ; les losanges passent par `poserLosange` /
 * `retirerLosange`, qui tiennent le compte `losanges` : à zéro, les parcours sautent la
 * recherche des jonctions et coûtent ce qu'ils coûtaient avant.
 *
 * ORDRE D'ÉNUMÉRATION : les cases droites d'abord, dans l'ordre des moteurs (gauche, droite,
 * haut, bas — celui de `streetGrid.bfsType`), PUIS les losanges. Sans losange, un parcours
 * visite donc les mêmes cases dans le même ordre qu'avant : mêmes `parent`, même plan.
 */
import type { RoadTile } from "../model/types";

/** Les dimensions seules : la géométrie des contacts n'a pas besoin des routes. */
export interface Trame {
  W: number;
  H: number;
  /** Nombre de cases droites, W·H ; premier identifiant de losange. */
  N: number;
}

export const trameDe = (W: number, H: number): Trame => ({ W, H, N: W * H });

export interface ReseauRoutier extends Trame {
  /** Cases droites portant une route (l'actuel `roadAt`). */
  droite: Uint8Array;
  /** Losanges portant une route, indexés par coin : `Y·(W+1) + X`. */
  losange: Uint8Array;
  /** Nombre de losanges posés. */
  losanges: number;
}

/** Réseau sans route, ou posé sur un masque `droite` existant (le `roadAt` d'un moteur). */
export function reseauVide(W: number, H: number, droite: Uint8Array = new Uint8Array(W * H)): ReseauRoutier {
  return { W, H, N: W * H, droite, losange: new Uint8Array((W + 1) * (H + 1)), losanges: 0 };
}

export function poserLosange(r: ReseauRoutier, X: number, Y: number): void {
  const k = Y * (r.W + 1) + X;
  if (!r.losange[k]) { r.losange[k] = 1; r.losanges++; }
}

export function retirerLosange(r: ReseauRoutier, X: number, Y: number): void {
  const k = Y * (r.W + 1) + X;
  if (r.losange[k]) { r.losange[k] = 0; r.losanges--; }
}

/** Nombre total d'identifiants : cases droites puis coins. */
export const tailleReseau = (r: Trame): number => r.N + (r.W + 1) * (r.H + 1);

export const idDroite = (r: Trame, x: number, y: number): number => y * r.W + x;
export const idLosange = (r: Trame, X: number, Y: number): number => r.N + Y * (r.W + 1) + X;
export const estLosange = (r: Trame, id: number): boolean => id >= r.N;
/** Coin (X, Y) du losange `id`. */
export function coinDe(r: Trame, id: number): { X: number; Y: number } {
  const k = id - r.N;
  return { X: k % (r.W + 1), Y: (k / (r.W + 1)) | 0 };
}

export const estRoute = (r: ReseauRoutier, id: number): boolean =>
  id < r.N ? r.droite[id] === 1 : r.losange[id - r.N] === 1;

const coinValide = (r: Trame, X: number, Y: number): boolean => X >= 0 && Y >= 0 && X <= r.W && Y <= r.H;
const caseValide = (r: Trame, x: number, y: number): boolean => x >= 0 && y >= 0 && x < r.W && y < r.H;

// ─── LES ROUTES D'UN PLAN ────────────────────────────────────────────────────────────────

/** Identifiant de la case de route `t` (`t.losange` : losange centré sur le coin (x, y)), −1 hors grille. */
export function idDeRoute(r: Trame, t: RoadTile): number {
  if (t.losange) return coinValide(r, t.x, t.y) ? idLosange(r, t.x, t.y) : -1;
  return caseValide(r, t.x, t.y) ? idDroite(r, t.x, t.y) : -1;
}

/** La case de route du nœud `id`. */
export function routeDe(r: Trame, id: number): RoadTile {
  if (id < r.N) return { x: id % r.W, y: (id / r.W) | 0 };
  const { X, Y } = coinDe(r, id);
  return { x: X, y: Y, losange: true };
}

/** Réseau des routes d'un plan ; celles hors de la grille sont ignorées. */
export function reseauDeRoutes(W: number, H: number, roads: readonly RoadTile[]): ReseauRoutier {
  const r = reseauVide(W, H);
  for (const t of roads) {
    const id = idDeRoute(r, t);
    if (id < 0) continue;
    if (id < r.N) r.droite[id] = 1;
    else poserLosange(r, t.x, t.y);
  }
  return r;
}

/** Les routes du réseau en cases de plan : les droites dans l'ordre des indices, puis les losanges. */
export function routesDuReseau(r: ReseauRoutier): RoadTile[] {
  const out: RoadTile[] = [];
  for (let i = 0; i < r.N; i++) if (r.droite[i]) out.push({ x: i % r.W, y: (i / r.W) | 0 });
  if (r.losanges) for (let k = 0; k < r.losange.length; k++) if (r.losange[k]) out.push(routeDe(r, r.N + k));
  return out;
}

// ─── LA RELATION DE CONTACT ──────────────────────────────────────────────────────────────

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

/**
 * Tous les nœuds (route ou non) au contact du nœud `id` — la relation unique du réseau : par
 * un côté entre objets de même orientation, par un point entre une case droite et un losange.
 * C'est à la fois l'arête du graphe (entre deux routes) et le raccordement d'une case de
 * bâtiment (droite ou losange) aux routes. Case droite : les cases gauche, droite, haut, bas
 * (ordre de `streetGrid.bfsType`), puis les 8 losanges en pointe. Losange : ses 4 voisins par
 * un côté, puis les 8 cases droites en pointe. Hors de la grille : sautés.
 */
export function noeudsAuContact(r: Trame, id: number, f: (id: number) => void): void {
  if (id < r.N) { noeudsAuContactDeCase(r, id % r.W, (id / r.W) | 0, f); return; }
  const { X, Y } = coinDe(r, id);
  for (const [dx, dy] of COTES_DE_LOSANGE) if (coinValide(r, X + dx, Y + dy)) f(idLosange(r, X + dx, Y + dy));
  for (const [dx, dy] of CASES_DE_POINTE) if (caseValide(r, X + dx, Y + dy)) f((Y + dy) * r.W + X + dx);
}

/**
 * Les nœuds au contact de la case droite (x, y), qui peut déborder de la grille (une emprise
 * de bâtiment côtier, par exemple) : ses voisines dans la grille, puis les losanges en pointe.
 */
export function noeudsAuContactDeCase(r: Trame, x: number, y: number, f: (id: number) => void): void {
  const { W } = r;
  if (caseValide(r, x - 1, y)) f(y * W + x - 1);
  if (caseValide(r, x + 1, y)) f(y * W + x + 1);
  if (caseValide(r, x, y - 1)) f((y - 1) * W + x);
  if (caseValide(r, x, y + 1)) f((y + 1) * W + x);
  for (const [dx, dy] of POINTES_DE_CASE) if (coinValide(r, x + dx, y + dy)) f(idLosange(r, x + dx, y + dy));
}

/**
 * Les nœuds au contact d'une emprise droite rectangulaire [x, x+w) × [y, y+h) :
 *  - les cases droites qui partagent un côté avec elle, dans l'ordre historique des moteurs
 *    (`orthoRoadCells` : pour chaque colonne, dessus puis dessous ; pour chaque ligne, gauche
 *    puis droite) ;
 *  - puis les losanges dont une pointe touche son bord sans la chevaucher : 2 à chaque coin
 *    de l'emprise, 1 à chaque point de grille intérieur d'un côté.
 */
export function noeudsAuContactRect(r: Trame, x: number, y: number, w: number, h: number, f: (id: number) => void): void {
  droitesAuContactRect(r, x, y, w, h, f);
  losangesAuContactRect(r, x, y, w, h, f);
}

function droitesAuContactRect(r: Trame, x: number, y: number, w: number, h: number, f: (id: number) => void): void {
  const { W, H } = r;
  for (let i = 0; i < w; i++) {
    const cx = x + i;
    if (cx < 0 || cx >= W) continue;
    if (y - 1 >= 0 && y - 1 < H) f((y - 1) * W + cx);
    if (y + h >= 0 && y + h < H) f((y + h) * W + cx);
  }
  for (let j = 0; j < h; j++) {
    const cy = y + j;
    if (cy < 0 || cy >= H) continue;
    if (x - 1 >= 0 && x - 1 < W) f(cy * W + x - 1);
    if (x + w >= 0 && x + w < W) f(cy * W + x + w);
  }
}

function losangesAuContactRect(r: Trame, x: number, y: number, w: number, h: number, f: (id: number) => void): void {
  // un losange (X, Y) chevauche l'emprise ssi X ∈ [x, x+w] et Y ∈ [y, y+h]
  const pointe = (PX: number, PY: number) => {
    for (const [X, Y] of [[PX - 1, PY], [PX, PY - 1], [PX + 1, PY], [PX, PY + 1]]) {
      if (X >= x && X <= x + w && Y >= y && Y <= y + h) continue;
      if (coinValide(r, X, Y)) f(idLosange(r, X, Y));
    }
  };
  for (let i = 0; i <= w; i++) { pointe(x + i, y); pointe(x + i, y + h); }
  for (let j = 1; j < h; j++) { pointe(x, y + j); pointe(x + w, y + j); }
}

/** Les routes au contact d'une emprise droite rectangulaire, dans l'ordre de `noeudsAuContactRect`. */
export function routesAuContactRect(r: ReseauRoutier, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  droitesAuContactRect(r, x, y, w, h, (id) => { if (r.droite[id]) out.push(id); });
  if (r.losanges) losangesAuContactRect(r, x, y, w, h, (id) => { if (r.losange[id - r.N]) out.push(id); });
  return out;
}

/**
 * Les routes au contact du nœud `id` : ses voisines dans le graphe si `id` est une route, les
 * points de départ d'une case de bâtiment sinon. Écrite à plat : c'est le cœur des parcours.
 */
export function voisins(r: ReseauRoutier, id: number, f: (id: number) => void): void {
  const { W, H, N, droite, losange } = r;
  const W1 = W + 1;
  if (id < N) {
    const x = id % W, y = (id / W) | 0;
    if (x > 0 && droite[id - 1]) f(id - 1);
    if (x < W - 1 && droite[id + 1]) f(id + 1);
    if (y > 0 && droite[id - W]) f(id - W);
    if (y < H - 1 && droite[id + W]) f(id + W);
    if (!r.losanges) return;
    for (const [dx, dy] of POINTES_DE_CASE) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X <= W && Y <= H && losange[Y * W1 + X]) f(N + Y * W1 + X);
    }
    return;
  }
  const k = id - N, X = k % W1, Y = (k / W1) | 0;
  for (const [dx, dy] of COTES_DE_LOSANGE) {
    const a = X + dx, b = Y + dy;
    if (a >= 0 && b >= 0 && a <= W && b <= H && losange[b * W1 + a]) f(N + b * W1 + a);
  }
  for (const [dx, dy] of CASES_DE_POINTE) {
    const a = X + dx, b = Y + dy;
    if (a >= 0 && b >= 0 && a < W && b < H && droite[b * W + a]) f(b * W + a);
  }
}

/**
 * Le premier losange de route au contact de la case droite `c`, ou −1. Les tracés droits à
 * travers le terrain libre s'en servent pour savoir qu'ils ont atteint un réseau diagonal.
 */
export function losangeAuContact(r: ReseauRoutier, c: number): number {
  if (!r.losanges) return -1;
  const x = c % r.W, y = (c / r.W) | 0, W1 = r.W + 1;
  for (const [dx, dy] of POINTES_DE_CASE) {
    const X = x + dx, Y = y + dy;
    if (X >= 0 && Y >= 0 && X <= r.W && Y <= r.H && r.losange[Y * W1 + X]) return r.N + Y * W1 + X;
  }
  return -1;
}

/**
 * Les cases droites au contact du nœud `id` : celles qu'une route atteinte sert, puisqu'un
 * bâtiment droit qui en occupe une s'y raccorde.
 */
export function casesAuContact(r: Trame, id: number, f: (c: number) => void): void {
  noeudsAuContact(r, id, (n) => { if (n < r.N) f(n); });
}

/** Les 4 cases droites dont le losange (X, Y) couvre la moitié. */
export function casesSousLosange(r: Trame, X: number, Y: number, f: (c: number) => void): void {
  for (const [x, y] of [[X - 1, Y - 1], [X, Y - 1], [X - 1, Y], [X, Y]]) if (caseValide(r, x, y)) f(y * r.W + x);
}

/** Nombre de routes voisines. */
export function degre(r: ReseauRoutier, id: number): number {
  let n = 0;
  voisins(r, id, () => { n++; });
  return n;
}

// ─── LA PORTÉE ───────────────────────────────────────────────────────────────────────────

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

export function creerParcours(r: Trame): Parcours {
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
