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
  isUsable,
  orthoNeighbors,
} from "./geometry";

export type DefLookup = (defId: string) => BuildingDef | undefined;

export function makeLookup(catalog: Catalog): DefLookup {
  const map = new Map(catalog.map((d) => [d.id, d]));
  return (id) => map.get(id);
}

/** Ensemble des cases occupées (clé "x,y") par tous les bâtiments sauf `exceptUid`. */
function occupiedSet(layout: Layout, lookup: DefLookup, exceptUid?: string): Set<string> {
  const set = new Set<string>();
  for (const b of layout.buildings) {
    if (b.uid === exceptUid) continue;
    const def = lookup(b.defId);
    if (!def) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation)) set.add(cellKey(c.x, c.y));
  }
  return set;
}

/** Toutes les cases occupées par un usage quelconque (bâtiments, champs, routes). */
function blockedSet(layout: Layout, lookup: DefLookup, exceptUid?: string): Set<string> {
  const set = occupiedSet(layout, lookup, exceptUid);
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
  const blocked = blockedSet(layout, lookup, exceptUid);
  for (const c of footprintCells(def, x, y, rot)) {
    if (!isUsable(layout.grid, c.x, c.y)) return false;
    if (blocked.has(cellKey(c.x, c.y))) return false;
  }
  return true;
}

/** Le bâtiment touche-t-il une route ? (toujours vrai si needsRoad === false) */
export function roadConnected(layout: Layout, lookup: DefLookup, b: PlacedBuilding): boolean {
  const def = lookup(b.defId);
  if (!def) return false;
  if (!def.needsRoad) return true;
  const roads = new Set(layout.roads.map((r) => cellKey(r.x, r.y)));
  if (roads.size === 0) return false;
  for (const c of footprintCells(def, b.x, b.y, b.rotation)) {
    for (const n of orthoNeighbors(c.x, c.y)) {
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
  const required = def.field.tiles;
  const owned = layout.fields.filter(
    (f) => f.ownerUid === b.uid && f.fieldType === def.field!.fieldType,
  );
  const count = owned.length;

  // Connexité (BFS orthogonal sur les cases du champ).
  const connected = isConnected(owned);

  // Adjacence au bâtiment.
  const footprint = new Set(
    footprintCells(def, b.x, b.y, b.rotation).map((c) => cellKey(c.x, c.y)),
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

/** Cases couvertes par le rayon de chaque bâtiment (distance euclidienne au centre). */
export function computeRadiusCoverage(
  layout: Layout,
  lookup: DefLookup,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def || !def.radius) continue;
    const cells = footprintCells(def, b.x, b.y, b.rotation);
    const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length + 0.5;
    const cy = cells.reduce((s, c) => s + c.y, 0) / cells.length + 0.5;
    const r = def.radius.range;
    const covered = new Set<string>();
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!isUsable(layout.grid, x, y)) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) covered.add(cellKey(x, y));
      }
    }
    result.set(b.uid, covered);
  }
  return result;
}

export interface BuildingIssues {
  uid: string;
  road: boolean; // true => problème de route
  field: FieldResult | null; // null si pas de champ requis
  overlap: boolean; // hors grille ou chevauchement
  ok: boolean;
}

/** Valide toute la disposition, renvoie les problèmes par bâtiment. */
export function validateLayout(layout: Layout, lookup: DefLookup): Map<string, BuildingIssues> {
  const issues = new Map<string, BuildingIssues>();
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    const overlap = !canPlace(layout, lookup, def, b.x, b.y, b.rotation, b.uid);
    const road = def.needsRoad && !roadConnected(layout, lookup, b);
    const field = validateFields(layout, lookup, b);
    const ok = !overlap && !road && (!field || field.ok);
    issues.set(b.uid, { uid: b.uid, road, field, overlap, ok });
  }
  return issues;
}
