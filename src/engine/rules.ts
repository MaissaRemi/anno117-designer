import type {
  BuildingDef,
  Catalog,
  Cell,
  Layout,
  PlacedBuilding,
  Rotation,
} from "../model/types";
import {
  cellKey,
  footprintCells,
  gridScale,
  isBuildable,
  isUsable,
  isWater,
  neighbors8,
  orthoNeighbors,
  partieEauPosee,
} from "./geometry";
import { planningRange } from "./roads";
import {
  casesAuContact,
  coinDe,
  creerParcours,
  estRoute,
  noeudsAuContactDeCase,
  parcourir,
  reseauDeCases,
  trameDe,
  type Parcours,
  type ReseauRoutier,
  type Trame,
} from "./reseauRoutier";

export type DefLookup = (defId: string) => BuildingDef | undefined;

/**
 * Adjacence du RÉSEAU DE ROUTES. Sur la grille vivante ½-tuile (scale 2 = 45° actif),
 * la connexion se fait AU COIN → 8-adjacence (cf. spec : runs diagonaux + jonctions de
 * coin). Sur les grilles tuile (optimiseur/tests axis), on garde la 4-adjacence
 * historique (snapshots + oracle vérité-terrain inchangés).
 */
const roadAdj = (scale: number) => (scale === 2 ? neighbors8 : orthoNeighbors);

/**
 * À l'échelle 1 — la grille des moteurs, celle que vérifient `invariants`, `ilots` et
 * `planifier` —, le réseau est celui de `reseauRoutier` : cases droites et losanges, contact
 * par un côté entre objets de même orientation, par un point entre les deux. Avec des routes
 * toutes droites, c'est exactement la 4-adjacence d'avant (golden de la trame droite).
 *
 * Clé d'un nœud dans les ensembles renvoyés : `"x,y"` pour une case droite, comme toujours ;
 * `"Lx,y"` pour un losange centré sur le coin (x, y).
 */
const cleDeNoeud = (t: Trame, id: number): string => {
  if (id < t.N) return cellKey(id % t.W, (id / t.W) | 0);
  const { X, Y } = coinDe(t, id);
  return `L${X},${Y}`;
};

export function makeLookup(catalog: Catalog): DefLookup {
  const map = new Map(catalog.map((d) => [d.id, d]));
  return (id) => map.get(id);
}

/** Ensemble des cases occupées (clé "x,y") par tous les bâtiments sauf `exceptUid`. */
function occupiedSet(layout: Layout, lookup: DefLookup, exceptUid: string | undefined, scale: number): Set<string> {
  const set = new Set<string>();
  for (const b of layout.buildings) {
    if (b.uid === exceptUid) continue;
    const def = lookup(b.defId);
    if (!def) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation, scale)) set.add(cellKey(c.x, c.y));
  }
  return set;
}

/** Toutes les cases occupées par un usage quelconque (bâtiments, champs, routes). */
function blockedSet(layout: Layout, lookup: DefLookup, exceptUid: string | undefined, scale: number): Set<string> {
  const set = occupiedSet(layout, lookup, exceptUid, scale);
  for (const f of layout.fields) {
    if (f.ownerUid === exceptUid) continue;
    set.add(cellKey(f.x, f.y));
  }
  for (const r of layout.roads) set.add(cellKey(r.x, r.y));
  return set;
}

/**
 * Peut-on poser `def` en (x,y,rot) ? (dans la grille utilisable, sans chevauchement)
 * `lookup` résout les defs des autres bâtiments pour calculer leurs emprises.
 */
export function canPlace(
  layout: Layout,
  lookup: DefLookup,
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rotation,
  exceptUid?: string,
): boolean {
  const scale = gridScale(layout.grid);
  if (!terrainConvient(layout.grid, def, x, y, rot, scale)) return false;
  const blocked = blockedSet(layout, lookup, exceptUid, scale);
  for (const c of footprintCells(def, x, y, rot, scale)) {
    if (blocked.has(cellKey(c.x, c.y))) return false;
  }
  return true;
}

/**
 * Le terrain convient-il à `def` posé en (x, y) ? Un bâtiment côtier (`partieEau`) a sa partie
 * dans l'eau sur l'eau constructible — y compris là où elle déborde de l'emprise — et le reste
 * à terre, côté quai ; tout autre bâtiment a chaque case selon son terrain de pose. Exiger toute
 * l'emprise dans l'eau, comme avant, rendait la Cabane de pêcheur (7 colonnes dans l'eau sur 8)
 * impossible à poser contre une côte.
 */
export function terrainConvient(
  grid: Layout["grid"], def: BuildingDef, x: number, y: number, rot: Rotation, scale: number,
): boolean {
  const eau = partieEauPosee(def, rot, scale);
  if (!eau) {
    for (const c of footprintCells(def, x, y, rot, scale)) if (!isBuildable(grid, c.x, c.y, def.placement)) return false;
    return true;
  }
  const ex = x + eau.x, ey = y + eau.y;
  const dansEau = (cx: number, cy: number) => cx >= ex && cx < ex + eau.w && cy >= ey && cy < ey + eau.h;
  for (const c of footprintCells(def, x, y, rot, scale)) {
    if (dansEau(c.x, c.y) ? !isWater(grid, c.x, c.y) : !isUsable(grid, c.x, c.y)) return false;
  }
  for (let j = 0; j < eau.h; j++) for (let i = 0; i < eau.w; i++) if (!isWater(grid, ex + i, ey + j)) return false;
  return true;
}

/**
 * Ensemble des cases de route reliées à un comptoir (roadRoot), via BFS sur le
 * réseau (4-connexité). Si aucun comptoir n'est posé, renvoie toutes les routes
 * (impossible de déterminer la racine) avec hasRoot=false.
 */
export function rootedRoadSet(
  layout: Layout,
  lookup: DefLookup,
): { set: Set<string>; hasRoot: boolean } {
  const scale = gridScale(layout.grid);
  if (scale === 1) return rootedRoadSetEnNoeuds(layout, lookup);
  const adj = roadAdj(scale);
  const roads = new Set(layout.roads.map((r) => cellKey(r.x, r.y)));
  // graines : routes adjacentes à un bâtiment racine
  const seeds: string[] = [];
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def?.roadRoot) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation, scale)) {
      for (const n of adj(c.x, c.y)) {
        const k = cellKey(n.x, n.y);
        if (roads.has(k)) seeds.push(k);
      }
    }
  }
  if (seeds.length === 0) return { set: roads, hasRoot: false };
  // BFS sur le réseau de routes
  const reachable = new Set<string>();
  const queue = [...seeds];
  for (const s of seeds) reachable.add(s);
  while (queue.length) {
    const k = queue.pop()!;
    const [x, y] = k.split(",").map(Number);
    for (const n of adj(x, y)) {
      const nk = cellKey(n.x, n.y);
      if (roads.has(nk) && !reachable.has(nk)) {
        reachable.add(nk);
        queue.push(nk);
      }
    }
  }
  return { set: reachable, hasRoot: true };
}

function rootedRoadSetEnNoeuds(layout: Layout, lookup: DefLookup): { set: Set<string>; hasRoot: boolean } {
  const r = reseauDeCases(layout.grid.w, layout.grid.h, layout.roads);
  const seeds: number[] = [];
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def?.roadRoot) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation, 1)) {
      noeudsAuContactDeCase(r, c.x, c.y, (n) => { if (estRoute(r, n)) seeds.push(n); });
    }
  }
  if (seeds.length === 0) return { set: new Set(layout.roads.map((c) => cellKey(c.x, c.y))), hasRoot: false };
  const p = creerParcours(r);
  parcourir(r, p, seeds);
  return { set: new Set(p.atteints.map((id) => cleDeNoeud(r, id))), hasRoot: true };
}

/**
 * Le bâtiment touche-t-il une route reliée au comptoir ?
 * - needsRoad === false ou roadRoot === true => toujours vrai.
 * - `rootSet` fourni : exige une route de ce réseau ; sinon toute route.
 */
export function roadConnected(
  layout: Layout,
  lookup: DefLookup,
  b: PlacedBuilding,
  rootSet?: Set<string>,
): boolean {
  const def = lookup(b.defId);
  if (!def) return false;
  if (!def.needsRoad || def.roadRoot) return true;
  const roads = rootSet ?? new Set(layout.roads.map((r) => cellKey(r.x, r.y)));
  if (roads.size === 0) return false;
  const scale = gridScale(layout.grid);
  if (scale === 1) {
    const t = trameDe(layout.grid.w, layout.grid.h);
    for (const c of footprintCells(def, b.x, b.y, b.rotation, 1)) {
      let touche = false;
      noeudsAuContactDeCase(t, c.x, c.y, (n) => { if (!touche && roads.has(cleDeNoeud(t, n))) touche = true; });
      if (touche) return true;
    }
    return false;
  }
  const adj = roadAdj(scale);
  for (const c of footprintCells(def, b.x, b.y, b.rotation, scale)) {
    for (const n of adj(c.x, c.y)) {
      if (roads.has(cellKey(n.x, n.y))) return true;
    }
  }
  return false;
}

export interface FieldResult {
  required: number;
  count: number;
  connected: boolean; // toutes les cases du champ forment un seul groupe
  touchesBuilding: boolean; // au moins une case adjacente au bâtiment
  ok: boolean;
}

/** Valide le champ d'un bâtiment : assez de cases, connectées, touchant le bâtiment. */
export function validateFields(layout: Layout, lookup: DefLookup, b: PlacedBuilding): FieldResult | null {
  const def = lookup(b.defId);
  if (!def || !def.field) return null;
  const owned = layout.fields.filter(
    (f) => f.ownerUid === b.uid && f.fieldType === def.field!.fieldType,
  );
  return fieldResult(layout, def, b, owned);
}

/** Cœur de `validateFields`, sur des cases de champ DÉJÀ filtrées (index partagé). */
function fieldResult(layout: Layout, def: BuildingDef, b: PlacedBuilding, owned: Cell[]): FieldResult {
  const scale = gridScale(layout.grid);
  const required = def.field!.tiles * scale * scale; // tuiles → cellules (aire : ×scale²)
  const count = owned.length;

  // Connexité (BFS orthogonal sur les cases du champ).
  const connected = isConnected(owned);

  // Adjacence au bâtiment.
  const footprint = new Set(
    footprintCells(def, b.x, b.y, b.rotation, scale).map((c) => cellKey(c.x, c.y)),
  );
  let touchesBuilding = false;
  for (const f of owned) {
    for (const n of orthoNeighbors(f.x, f.y)) {
      if (footprint.has(cellKey(n.x, n.y))) {
        touchesBuilding = true;
        break;
      }
    }
    if (touchesBuilding) break;
  }

  const ok = count >= required && connected && touchesBuilding;
  return { required, count, connected, touchesBuilding, ok };
}

function isConnected(cells: Cell[]): boolean {
  if (cells.length <= 1) return true;
  const set = new Set(cells.map((c) => cellKey(c.x, c.y)));
  const seen = new Set<string>();
  const start = cells[0];
  const queue: Cell[] = [start];
  seen.add(cellKey(start.x, start.y));
  while (queue.length) {
    const c = queue.pop()!;
    for (const n of orthoNeighbors(c.x, c.y)) {
      const k = cellKey(n.x, n.y);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return seen.size === set.size;
}

/** Couverture euclidienne (disque centré sur le bâtiment) — utilisée si pas de rues. */
function euclideanCoverage(layout: Layout, def: BuildingDef, b: PlacedBuilding, scale: number): Set<string> {
  const cells = footprintCells(def, b.x, b.y, b.rotation, scale);
  const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length + 0.5;
  const cy = cells.reduce((s, c) => s + c.y, 0) / cells.length + 0.5;
  const r = def.radius!.range * scale; // portée en TUILES → cellules
  const covered = new Set<string>();
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!isUsable(layout.grid, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) covered.add(cellKey(x, y));
    }
  }
  return covered;
}

/**
 * Couverture par distance le long des rues (mécanique réelle Anno pour les
 * services) : BFS sur le réseau de routes depuis les routes adjacentes au
 * bâtiment, jusqu'à `streetRange` cases, allongé par le type de route (cf. engine/roads).
 * Les cases servies = celles adjacentes à une route atteinte (là où une maison peut se
 * brancher).
 */
function streetCoverage(
  layout: Layout,
  def: BuildingDef,
  b: PlacedBuilding,
  roads: Set<string>,
  scale: number,
): Set<string> {
  // portée en TUILES de la route du plan → cellules (½-tuile : ×2)
  const limit = planningRange(def, layout.roadType) * scale;
  const adj = roadAdj(scale); // 8-adjacence sur la grille ½-tuile (routes diagonales)
  const footprint = new Set(
    footprintCells(def, b.x, b.y, b.rotation, scale).map((c) => cellKey(c.x, c.y)),
  );
  // graines : routes adjacentes à l'emprise (distance 1)
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const c of footprintCells(def, b.x, b.y, b.rotation, scale)) {
    for (const n of adj(c.x, c.y)) {
      const k = cellKey(n.x, n.y);
      if (footprint.has(k) || !roads.has(k) || dist.has(k)) continue;
      dist.set(k, 1);
      queue.push(k);
    }
  }
  while (queue.length) {
    const k = queue.shift()!;
    const d = dist.get(k)!;
    if (d >= limit) continue;
    const [x, y] = k.split(",").map(Number);
    for (const n of adj(x, y)) {
      const nk = cellKey(n.x, n.y);
      if (roads.has(nk) && !dist.has(nk)) {
        dist.set(nk, d + 1);
        queue.push(nk);
      }
    }
  }
  // cases servies : cellules utilisables adjacentes à une route atteinte
  const covered = new Set<string>();
  for (const k of dist.keys()) {
    const [x, y] = k.split(",").map(Number);
    for (const n of adj(x, y)) {
      if (isUsable(layout.grid, n.x, n.y)) covered.add(cellKey(n.x, n.y));
    }
  }
  return covered;
}

/**
 * `streetCoverage` à l'échelle 1, sur le réseau en graphe : même sémantique (départ des routes
 * au contact de l'emprise, portée en nœuds, cases servies au contact des routes atteintes).
 * Réseau et parcours sont partagés par tous les bâtiments du plan.
 */
function couvertureEnNoeuds(
  layout: Layout,
  def: BuildingDef,
  b: PlacedBuilding,
  ctx: { r: ReseauRoutier; p: Parcours },
): Set<string> {
  const { r, p } = ctx;
  const { w: W, usable } = layout.grid;
  const emprise = footprintCells(def, b.x, b.y, b.rotation, 1);
  const dansEmprise = new Set(emprise.map((c) => cellKey(c.x, c.y)));
  const depart: number[] = [];
  for (const c of emprise) {
    noeudsAuContactDeCase(r, c.x, c.y, (n) => {
      if (estRoute(r, n) && !dansEmprise.has(cleDeNoeud(r, n))) depart.push(n);
    });
  }
  parcourir(r, p, depart, planningRange(def, layout.roadType));
  const covered = new Set<string>();
  for (const id of p.atteints) casesAuContact(r, id, (c) => { if (usable[c]) covered.add(cellKey(c % W, (c / W) | 0)); });
  return covered;
}

/**
 * Cases couvertes par le rayon de chaque bâtiment d'influence. Utilise la
 * distance le long des rues (`streetRange`) quand le bâtiment en a une et que
 * des routes existent ; sinon repli sur le disque euclidien (`radius.range`).
 */
export function computeRadiusCoverage(
  layout: Layout,
  lookup: DefLookup,
  opts: { euclidean?: boolean } = {},
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const scale = gridScale(layout.grid);
  const roads = new Set(layout.roads.map((r) => cellKey(r.x, r.y)));
  let enNoeuds: { r: ReseauRoutier; p: Parcours } | null = null;
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def || !def.radius) continue;
    // forcer l'euclidien (borne de planification, indépendante des rues) si demandé
    const useStreet = !opts.euclidean && def.streetRange && def.streetRange > 0 && roads.size > 0;
    if (useStreet && scale === 1) {
      if (!enNoeuds) {
        const r = reseauDeCases(layout.grid.w, layout.grid.h, layout.roads);
        enNoeuds = { r, p: creerParcours(r) };
      }
      result.set(b.uid, couvertureEnNoeuds(layout, def, b, enNoeuds));
      continue;
    }
    result.set(b.uid, useStreet ? streetCoverage(layout, def, b, roads, scale) : euclideanCoverage(layout, def, b, scale));
  }
  return result;
}

export interface BuildingIssues {
  uid: string;
  road: boolean; // true => problème de route
  field: FieldResult | null; // null si pas de champ requis
  overlap: boolean; // hors grille ou chevauchement
  terrain: boolean; // true => mauvais terrain (eau attendue/terre, ou inverse)
  ok: boolean;
}

/**
 * Valide toute la disposition, renvoie les problèmes par bâtiment.
 *
 * ⚠ Cette fonction tourne à CHAQUE rendu de la grille. Elle était quadratique : `canPlace`
 * reconstruisait l'ensemble des cases bloquées (tous les bâtiments + tous les champs +
 * toutes les routes) pour CHAQUE bâtiment, et `validateFields` refiltrait la liste
 * complète des champs de la même façon. Mesuré sur un plan d'île appliqué — 1 517
 * bâtiments, 22 348 routes, grille 640×640 — : **21,5 secondes**. L'interface paraissait
 * plantée dès qu'on posait un plan.
 *
 * On indexe donc une seule fois (occupation, routes, champs par propriétaire), puis chaque
 * bâtiment se valide en temps proportionnel à sa seule emprise.
 */
export function validateLayout(layout: Layout, lookup: DefLookup): Map<string, BuildingIssues> {
  const issues = new Map<string, BuildingIssues>();
  const scale = gridScale(layout.grid);
  const { set: rootSet } = rootedRoadSet(layout, lookup);

  // nombre de bâtiments couvrant chaque case : > 1 ⇔ chevauchement (le bâtiment testé
  // comptant pour 1, un second occupant fait passer le compteur à 2)
  const cover = new Map<string, number>();
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation, scale)) {
      const k = cellKey(c.x, c.y);
      cover.set(k, (cover.get(k) ?? 0) + 1);
    }
  }
  const roadCells = new Set(layout.roads.map((r) => cellKey(r.x, r.y)));
  const fieldOwner = new Map<string, string>();
  const fieldsByOwner = new Map<string, typeof layout.fields>();
  for (const f of layout.fields) {
    fieldOwner.set(cellKey(f.x, f.y), f.ownerUid);
    const arr = fieldsByOwner.get(f.ownerUid);
    if (arr) arr.push(f);
    else fieldsByOwner.set(f.ownerUid, [f]);
  }

  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    const cells = footprintCells(def, b.x, b.y, b.rotation, scale);
    // terrain de pose (cf. `terrainConvient`) ; un mauvais terrain compte aussi en recouvrement
    const terrain = !terrainConvient(layout.grid, def, b.x, b.y, b.rotation, scale);
    let overlap = terrain;
    for (const c of cells) {
      const k = cellKey(c.x, c.y);
      // même sémantique que `canPlace` : un autre bâtiment, une route, ou le champ d'AUTRUI
      if ((cover.get(k) ?? 0) > 1 || roadCells.has(k)) { overlap = true; continue; }
      const fo = fieldOwner.get(k);
      if (fo !== undefined && fo !== b.uid) overlap = true;
    }
    const road = def.needsRoad && !def.roadRoot && !roadConnected(layout, lookup, b, rootSet);
    const owned = def.field
      ? (fieldsByOwner.get(b.uid) ?? []).filter((f) => f.fieldType === def.field!.fieldType)
      : null;
    const field = owned ? fieldResult(layout, def, b, owned) : null;
    const ok = !overlap && !road && !terrain && (!field || field.ok);
    issues.set(b.uid, { uid: b.uid, road, field, overlap, terrain, ok });
  }
  return issues;
}
