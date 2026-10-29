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
 * ARÊTES DU GRAPHE (route – route), figées par la géométrie :
 *  - droite – droite : un côté partagé, les 4 voisines ;
 *  - losange – losange : un côté partagé, les coins (X ± 1, Y ± 1) ;
 *  - droite – losange : JONCTION PAR RECOUVREMENT — le losange couvre une partie de la case
 *    droite (les 4 losanges centrés sur ses coins ; les 4 cases sous un losange). En jeu, une
 *    route droite ENTRE dans la route en biais : sa dernière case est la case entière de la
 *    bande diagonale, la précédente est à moitié sous le pavage (captures de Rémi, Q1).
 * Deux routes qui ne se touchent que par un point ne sont pas reliées : deux cases droites en
 * coin (comportement établi des moteurs), deux losanges pointe contre pointe (hypothèse, Q2),
 * une case droite contre la pointe d'un losange.
 *
 * CONTACT D'UN BÂTIMENT (bâtiment – route), une autre relation : par un côté à une route de
 * son orientation, par un point à une route de l'autre (vérifié en jeu, 30/10/2026) — une
 * maison droite se raccorde à la pointe d'un losange, que la route droite, elle, ne joint pas.
 *
 * PORTÉE : une longueur de trajet. Une case droite coûte 1, un losange √2 (sa longueur ;
 * captures de Rémi : la zone servie s'arrête à la même distance réelle sur une branche droite
 * et sur une branche diagonale).
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
 * CONTACT D'UN BÂTIMENT : tous les nœuds (route ou non) au contact de la case de bâtiment
 * `id` — par un côté entre objets de même orientation, par un point entre une case droite et
 * un losange. Case droite : les cases gauche, droite, haut, bas (ordre de
 * `streetGrid.bfsType`), puis les 8 losanges en pointe. Losange : ses 4 voisins par un côté,
 * puis les 8 cases droites en pointe. Hors de la grille : sautés.
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

/** Les routes au contact de la case de bâtiment `id` : ses points de départ. */
export function routesAuContact(r: ReseauRoutier, id: number, f: (id: number) => void): void {
  noeudsAuContact(r, id, (n) => { if (estRoute(r, n)) f(n); });
}

/** Les 4 losanges qui recouvrent une partie de la case droite (x, y) : centrés sur ses coins. */
const LOSANGES_SUR_CASE: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1], [1, 1]];
/** L'inverse : les 4 cases droites sous le losange (X, Y). */
const CASES_SOUS_LOSANGE: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [-1, 0], [0, 0]];

/**
 * ARÊTES DU GRAPHE : tous les nœuds (route ou non) liés au nœud `id` s'ils portaient une
 * route. Case droite : gauche, droite, haut, bas, puis les 4 losanges qui la recouvrent.
 * Losange : ses 4 voisins par un côté, puis les 4 cases droites qu'il recouvre.
 */
export function noeudsLies(r: Trame, id: number, f: (id: number) => void): void {
  const { W, H, N } = r;
  if (id < N) {
    const x = id % W, y = (id / W) | 0;
    if (x > 0) f(id - 1);
    if (x < W - 1) f(id + 1);
    if (y > 0) f(id - W);
    if (y < H - 1) f(id + W);
    for (const [dx, dy] of LOSANGES_SUR_CASE) f(idLosange(r, x + dx, y + dy));
    return;
  }
  const { X, Y } = coinDe(r, id);
  for (const [dx, dy] of COTES_DE_LOSANGE) if (coinValide(r, X + dx, Y + dy)) f(idLosange(r, X + dx, Y + dy));
  for (const [dx, dy] of CASES_SOUS_LOSANGE) if (caseValide(r, X + dx, Y + dy)) f((Y + dy) * W + X + dx);
}

/**
 * `noeudsLies`, sans les losanges candidats quand le réseau n'en porte aucun : pour les tracés
 * droits qui explorent le terrain libre autour des routes, et ne posent jamais de losange.
 */
export function noeudsLiesDuReseau(r: ReseauRoutier, id: number, f: (id: number) => void): void {
  if (r.losanges || id >= r.N) { noeudsLies(r, id, f); return; }
  const { W, H } = r, x = id % W, y = (id / W) | 0;
  if (x > 0) f(id - 1);
  if (x < W - 1) f(id + 1);
  if (y > 0) f(id - W);
  if (y < H - 1) f(id + W);
}

/** Les routes voisines de la route `id` dans le graphe. Écrite à plat : c'est le cœur des parcours. */
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
    for (const [dx, dy] of LOSANGES_SUR_CASE) {
      const k = (y + dy) * W1 + x + dx; // les coins d'une case de la grille sont toujours valides
      if (losange[k]) f(N + k);
    }
    return;
  }
  const k = id - N, X = k % W1, Y = (k / W1) | 0;
  for (const [dx, dy] of COTES_DE_LOSANGE) {
    const a = X + dx, b = Y + dy;
    if (a >= 0 && b >= 0 && a <= W && b <= H && losange[b * W1 + a]) f(N + b * W1 + a);
  }
  for (const [dx, dy] of CASES_SOUS_LOSANGE) {
    const a = X + dx, b = Y + dy;
    if (a >= 0 && b >= 0 && a < W && b < H && droite[b * W + a]) f(b * W + a);
  }
}

/**
 * Le premier losange de route qui recouvre la case droite `c`, ou −1. Un tracé droit à travers
 * le terrain libre qui entre dans cette case a rejoint le réseau diagonal : c'est la jonction
 * par recouvrement du jeu.
 */
export function losangeSur(r: ReseauRoutier, c: number): number {
  if (!r.losanges) return -1;
  const x = c % r.W, y = (c / r.W) | 0, W1 = r.W + 1;
  for (const [dx, dy] of LOSANGES_SUR_CASE) {
    const k = (y + dy) * W1 + x + dx;
    if (r.losange[k]) return r.N + k;
  }
  return -1;
}

/**
 * Les cases droites au contact du nœud `id` : celles qu'une route atteinte sert, puisqu'un
 * bâtiment droit qui en occupe une s'y raccorde.
 */
export function casesAuContact(r: Trame, id: number, f: (c: number) => void): void {
  if (id >= r.N) { noeudsAuContact(r, id, (n) => { if (n < r.N) f(n); }); return; }
  const { W, H } = r, x = id % W, y = (id / W) | 0;
  if (x > 0) f(id - 1);
  if (x < W - 1) f(id + 1);
  if (y > 0) f(id - W);
  if (y < H - 1) f(id + W);
}

/** Les 4 cases droites dont le losange (X, Y) couvre la moitié. */
export function casesSousLosange(r: Trame, X: number, Y: number, f: (c: number) => void): void {
  for (const [dx, dy] of CASES_SOUS_LOSANGE) if (caseValide(r, X + dx, Y + dy)) f((Y + dy) * r.W + X + dx);
}

/** Nombre de routes voisines. */
export function degre(r: ReseauRoutier, id: number): number {
  let n = 0;
  voisins(r, id, () => { n++; });
  return n;
}

// ─── LA PORTÉE ───────────────────────────────────────────────────────────────────────────

/** Longueur d'un losange de route : la portée est une longueur de trajet. */
export const COUT_LOSANGE = Math.SQRT2;
/** Coût d'un nœud de route dans un trajet : 1 pour une case droite, √2 pour un losange. */
export const coutDe = (r: Trame, id: number): number => (id < r.N ? 1 : COUT_LOSANGE);
/** Tolérance des comparaisons de longueurs : 5 × √2 ne doit pas dépasser une portée de 5√2. */
const EPS = 1e-9;

/**
 * Un parcours réutilisable : `dist` (−1 non atteint ; sinon la longueur du trajet, source
 * comprise : 1 pour une source droite), `parent` (−2 non atteint, −1 pour une source),
 * `atteints` dans l'ordre de découverte. Relancer un parcours ne remet à zéro que les nœuds
 * atteints la fois précédente.
 */
export interface Parcours {
  dist: Float64Array;
  parent: Int32Array;
  atteints: number[];
}

export function creerParcours(r: Trame): Parcours {
  const n = tailleReseau(r);
  return { dist: new Float64Array(n).fill(-1), parent: new Int32Array(n).fill(-2), atteints: [] };
}

/**
 * PORTÉE le long des routes : les nœuds dont le trajet depuis une source, source comprise,
 * ne dépasse pas `budget` (1 par case droite, √2 par losange). Les sources sont toujours
 * atteintes. Sur un réseau tout droit, c'est la sémantique de `streetGrid.bfsType` et de
 * `streetCoverage` (distance 1 aux sources, extension tant que distance + 1 ≤ budget), et un
 * budget fractionnaire vaut son entier inférieur. `budget` = Infinity : tout le réseau joignable.
 *
 * Sans losange, un parcours en largeur, qui visite dans l'ordre historique ; avec, un Dijkstra
 * dont la file départage les égalités par ordre d'arrivée.
 */
export function parcourir(r: ReseauRoutier, p: Parcours, sources: Iterable<number>, budget = Infinity): void {
  for (const id of p.atteints) { p.dist[id] = -1; p.parent[id] = -2; }
  p.atteints.length = 0;
  if (!r.losanges) { parcourirDroit(r, p, sources, budget); return; }
  const file = new FileDeNoeuds();
  for (const s of sources) {
    if (p.dist[s] >= 0 || !estRoute(r, s)) continue;
    p.dist[s] = coutDe(r, s); p.parent[s] = -1;
    p.atteints.push(s); file.pousser(p.dist[s], s);
  }
  while (file.taille) {
    const [d, c] = file.extraire();
    if (d > p.dist[c] + EPS) continue; // entrée périmée
    voisins(r, c, (n) => {
      const dn = d + coutDe(r, n);
      if (dn > budget + EPS) return;
      if (p.dist[n] >= 0 && dn >= p.dist[n] - EPS) return;
      if (p.dist[n] < 0) p.atteints.push(n);
      p.dist[n] = dn; p.parent[n] = c;
      file.pousser(dn, n);
    });
  }
}

function parcourirDroit(r: ReseauRoutier, p: Parcours, sources: Iterable<number>, budget: number): void {
  let front: number[] = [];
  for (const s of sources) {
    if (p.dist[s] >= 0 || !estRoute(r, s)) continue;
    p.dist[s] = 1; p.parent[s] = -1;
    p.atteints.push(s); front.push(s);
  }
  for (let d = 1; front.length && d + 1 <= budget + EPS; d++) {
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

/** File de priorité (tas binaire) sur (longueur, ordre d'arrivée). */
class FileDeNoeuds {
  private cles: number[] = [];
  private rangs: number[] = [];
  private ids: number[] = [];
  private arrivee = 0;
  get taille(): number { return this.ids.length; }
  private avant(i: number, j: number): boolean {
    const a = this.cles[i], b = this.cles[j];
    return a < b - EPS || (Math.abs(a - b) <= EPS && this.rangs[i] < this.rangs[j]);
  }
  private echanger(i: number, j: number): void {
    [this.cles[i], this.cles[j]] = [this.cles[j], this.cles[i]];
    [this.rangs[i], this.rangs[j]] = [this.rangs[j], this.rangs[i]];
    [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
  }
  pousser(cle: number, id: number): void {
    this.cles.push(cle); this.rangs.push(this.arrivee++); this.ids.push(id);
    for (let i = this.ids.length - 1; i > 0;) {
      const pere = (i - 1) >> 1;
      if (!this.avant(i, pere)) break;
      this.echanger(i, pere); i = pere;
    }
  }
  extraire(): [number, number] {
    const sortie: [number, number] = [this.cles[0], this.ids[0]];
    const fin = this.ids.length - 1;
    this.echanger(0, fin);
    this.cles.pop(); this.rangs.pop(); this.ids.pop();
    for (let i = 0; ;) {
      const g = 2 * i + 1, d = g + 1;
      let m = i;
      if (g < fin && this.avant(g, m)) m = g;
      if (d < fin && this.avant(d, m)) m = d;
      if (m === i) break;
      this.echanger(i, m); i = m;
    }
    return sortie;
  }
}
