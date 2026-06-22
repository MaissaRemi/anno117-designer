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
  neighbors8,
  orthoNeighbors,
} from "./geometry";

export type DefLookup = (defId: string) => BuildingDef | undefined;

/**
 * Adjacence du RÉSEAU DE ROUTES. Sur la grille vivante ½-tuile (scale 2 = 45° actif),
 * la connexion se fait AU COIN → 8-adjacence (cf. spec : runs diagonaux + jonctions de
 * coin). Sur les grilles tuile (optimiseur/tests axis), on garde la 4-adjacence
 * historique (snapshots + oracle vérité-terrain inchangés).
 */
const roadAdj = (scale: number) => (scale === 2 ? neighbors8 : orthoNeighbors);

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
  const blocked = blockedSet(layout, lookup, exceptUid, scale);
  for (const c of footprintCells(def, x, y, rot, scale)) {
    // terre vs eau selon le terrain de pose du bâtiment
    if (!isBuildable(layout.grid, c.x, c.y, def.placement)) return false;
    if (blocked.has(cellKey(c.x, c.y))) return false;
  }
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
  const scale = gridScale(layout.grid);
  const required = def.field.tiles * scale * scale; // tuiles → cellules (aire : ×scale²)
  const owned = layout.fields.filter(
    (f) => f.ownerUid === b.uid && f.fieldType === def.field!.fieldType,
  );
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
 * bâtiment, jusqu'à `streetRange` cases. Les cases servies = celles adjacentes
 * à une route atteinte (là où une maison peut se brancher).
 */
function streetCoverage(
  layout: Layout,
  def: BuildingDef,
  b: PlacedBuilding,
  roads: Set<string>,
  scale: number,
): Set<string> {
  const limit = def.streetRange! * scale; // portée en TUILES → cellules (½-tuile : ×2)
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
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def || !def.radius) continue;
    // forcer l'euclidien (borne de planification, indépendante des rues) si demandé
    const useStreet = !opts.euclidean && def.streetRange && def.streetRange > 0 && roads.size > 0;
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

/** Valide toute la disposition, renvoie les problèmes par bâtiment. */
export function validateLayout(layout: Layout, lookup: DefLookup): Map<string, BuildingIssues> {
  const issues = new Map<string, BuildingIssues>();
  const scale = gridScale(layout.grid);
  const { set: rootSet } = rootedRoadSet(layout, lookup);
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    // terrain : chaque case de l'emprise doit correspondre au terrain de pose
    const terrain = footprintCells(def, b.x, b.y, b.rotation, scale).some(
      (c) => !isBuildable(layout.grid, c.x, c.y, def.placement),
    );
    const overlap = !canPlace(layout, lookup, def, b.x, b.y, b.rotation, b.uid);
    const road = def.needsRoad && !def.roadRoot && !roadConnected(layout, lookup, b, rootSet);
    const field = validateFields(layout, lookup, b);
    const ok = !overlap && !road && !terrain && (!field || field.ok);
    issues.set(b.uid, { uid: b.uid, road, field, overlap, terrain, ok });
  }
  return issues;
}
