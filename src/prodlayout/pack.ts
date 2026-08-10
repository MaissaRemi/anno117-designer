import type { BuildingDef } from "../model/types";
import type { Lookup } from "./chain";
import { fillFields, freeAround, reserveFreeArea, type FieldCell } from "./fields";
import { BUILDING, count, FIELD, fill, fits, FREE, makeOcc, ROAD, type Occ } from "./occupancy";
import { adjacentRoads, paintSkeleton, roadDistances } from "./roads";

/**
 * LE PLACEUR — glouton, à ordre total, sans une once d'aléa.
 *
 * On essaie une douzaine de boîtes et on rejoue chacune entièrement. Le déterminisme n'est
 * pas une coquetterie : c'est ce qui rend le module MESURABLE. Sans lui, « la version B
 * fait mieux que A » ne serait que du bruit de placement, et le projet a déjà payé pour
 * apprendre à ne pas confondre les deux.
 *
 * Le recuit simulé est écarté : la géométrie plafonne à +3 % sur ce projet quand le choix
 * de la recette vaut ×1,48. Payer l'indéterminisme pour ce gain-là serait un mauvais
 * échange.
 */

export type Rot0or90 = 0 | 90;

export interface Placement {
  uid: string;
  defId: string;
  x: number;
  y: number;
  rot: Rot0or90;
}

export interface PackInput {
  /** Bâtiments à poser, hors entrepôt. */
  items: { defId: string; count: number }[];
  warehouseDefId: string;
  lookup: Lookup;
}

export interface PackResult {
  w: number;
  h: number;
  placements: Placement[];
  roads: { x: number; y: number }[];
  fields: FieldCell[];
  tiles: { buildings: number; fields: number; roads: number };
  efficiency: number;
  gaps: string[];
}

/** Rapports largeur/hauteur essayés, puis gonflements de la surface utile. */
const RATIOS: [number, number][] = [[1, 1], [4, 3], [3, 2], [2, 1]];
const INFLATIONS = [1.15, 1.3, 1.5, 1.8, 2.2];
const DEFAULT_RANGE = 30;

const sizeOf = (d: BuildingDef, rot: Rot0or90) =>
  rot === 90 ? { w: d.size.h, h: d.size.w } : { w: d.size.w, h: d.size.h };

/** Groupe de pose : plus le nombre est petit, plus le bâtiment est contraint. */
const groupOf = (d: BuildingDef): number => (d.freeArea ? 0 : d.field ? 1 : 2);

/** Une copie à poser, dans l'ordre total de pose. */
interface Copy {
  defId: string;
  def: BuildingDef;
  group: number;
}

function expandCopies(input: PackInput): Copy[] {
  const copies: Copy[] = [];
  for (const it of input.items) {
    const def = input.lookup(it.defId);
    if (!def) continue;
    for (let i = 0; i < it.count; i++) copies.push({ defId: it.defId, def, group: groupOf(def) });
  }
  // ordre TOTAL : groupe, puis emprise décroissante, puis defId — aucune ambiguïté.
  copies.sort((a, b) =>
    a.group - b.group
    || b.def.size.w * b.def.size.h - a.def.size.w * a.def.size.h
    || a.defId.localeCompare(b.defId));
  return copies;
}

/** Surface utile estimée : emprises + champs + aires libres exigées. */
function usefulArea(copies: Copy[], wh: BuildingDef): number {
  let s = wh.size.w * wh.size.h;
  for (const c of copies) {
    s += c.def.size.w * c.def.size.h;
    s += c.def.field?.tiles ?? 0;
    s += c.def.freeArea?.area ?? 0;
  }
  return s;
}

interface Attempt {
  occ: Occ;
  placements: Placement[];
  fields: FieldCell[];
  gaps: string[];
}

/** Première position valide, en balayage haut-gauche → bas-droite, rotations 0 puis 90. */
function findSpot(
  occ: Occ, def: BuildingDef, needRoad: boolean,
): { x: number; y: number; rot: Rot0or90 } | null {
  const rots: Rot0or90[] = def.rotatable && def.size.w !== def.size.h ? [0, 90] : [0];
  for (let y = 0; y < occ.h; y++) {
    for (let x = 0; x < occ.w; x++) {
      for (const rot of rots) {
        const { w, h } = sizeOf(def, rot);
        if (!fits(occ, x, y, w, h)) continue;
        if (needRoad && adjacentRoads(occ, x, y, w, h).length === 0) continue;
        if (def.freeArea && freeAround(occ, x, y, w, h, def.freeArea.radius) < def.freeArea.area) continue;
        return { x, y, rot };
      }
    }
  }
  return null;
}

/** Cases de route contiguës à tous les entrepôts posés. */
function warehouseSeeds(occ: Occ, placements: Placement[], lookup: Lookup): number[] {
  const seeds: number[] = [];
  for (const p of placements) {
    const d = lookup(p.defId);
    if (!d?.roadRoot) continue;
    const { w, h } = sizeOf(d, p.rot);
    seeds.push(...adjacentRoads(occ, p.x, p.y, w, h));
  }
  return seeds;
}

/** Producteurs hors de portée d'un entrepôt, en distance-rue. */
function outOfRange(occ: Occ, placements: Placement[], lookup: Lookup): Placement[] {
  const dist = roadDistances(occ, warehouseSeeds(occ, placements, lookup));
  const bad: Placement[] = [];
  for (const p of placements) {
    const d = lookup(p.defId);
    if (!d?.production) continue;
    const { w, h } = sizeOf(d, p.rot);
    const reach = adjacentRoads(occ, p.x, p.y, w, h).map((c) => dist[c]).filter((v) => v >= 0);
    const best = reach.length ? Math.min(...reach) : Infinity;
    if (best > (d.transporterRange ?? DEFAULT_RANGE)) bad.push(p);
  }
  return bad;
}

/** Emplacement libre le plus proche d'un point, avec accès route. Balayage par anneaux. */
function findNear(
  occ: Occ, def: BuildingDef, cx: number, cy: number,
): { x: number; y: number } | null {
  const max = Math.max(occ.w, occ.h);
  for (let ring = 0; ring <= max; ring++) {
    for (let y = cy - ring; y <= cy + ring; y++) {
      for (let x = cx - ring; x <= cx + ring; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
        if (!fits(occ, x, y, def.size.w, def.size.h)) continue;
        if (adjacentRoads(occ, x, y, def.size.w, def.size.h).length === 0) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function tryBox(input: PackInput, copies: Copy[], w: number, h: number): Attempt | null {
  const wh = input.lookup(input.warehouseDefId);
  if (!wh) return null;
  const occ = makeOcc(w, h);
  const placements: Placement[] = [];
  const fields: FieldCell[] = [];
  const gaps: string[] = [];
  let nextUid = 0;

  // 1. l'entrepôt, ancre de la portée de charrette
  const wx = Math.floor((w - wh.size.w) / 2);
  const wy = Math.floor((h - wh.size.h) / 2);
  if (wx < 0 || wy < 0 || wy + wh.size.h >= h) return null;
  fill(occ, wx, wy, wh.size.w, wh.size.h, BUILDING);
  placements.push({ uid: `b${nextUid++}`, defId: wh.id, x: wx, y: wy, rot: 0 });

  // 2. le squelette : épine juste sous l'entrepôt, qui le longe donc sans le couper
  const deepest = copies.reduce((m, c) => Math.max(m, c.def.size.w, c.def.size.h), 1);
  paintSkeleton(occ, wy + wh.size.h, 2 * deepest + 1);

  // 3..5. les copies, du plus contraint au plus libre
  for (const c of copies) {
    const spot = findSpot(occ, c.def, c.def.needsRoad);
    if (!spot) return null; // cette boîte ne convient pas — on essaie la suivante
    const { w: cw, h: ch } = sizeOf(c.def, spot.rot);
    fill(occ, spot.x, spot.y, cw, ch, BUILDING);
    const uid = `b${nextUid++}`;
    placements.push({ uid, defId: c.defId, x: spot.x, y: spot.y, rot: spot.rot });
    if (c.def.freeArea) reserveFreeArea(occ, spot.x, spot.y, cw, ch, c.def.freeArea.radius);
    if (c.def.field) {
      const got = fillFields(occ, {
        x: spot.x, y: spot.y, w: cw, h: ch,
        radius: c.def.radius?.range ?? 22,
        tiles: c.def.field.tiles,
        fieldType: c.def.field.fieldType,
        ownerUid: uid,
      });
      fields.push(...got);
      if (got.length < c.def.field.tiles) {
        gaps.push(`${c.def.name} : ${got.length} cases de champ sur ${c.def.field.tiles} — rendement partiel`);
      }
    }
  }

  // 6. portée d'entrepôt ; un second entrepôt si des producteurs sont trop loin
  let bad = outOfRange(occ, placements, input.lookup);
  if (bad.length) {
    const cx = Math.round(bad.reduce((s, p) => s + p.x, 0) / bad.length);
    const cy = Math.round(bad.reduce((s, p) => s + p.y, 0) / bad.length);
    const spot = findNear(occ, wh, cx, cy);
    if (spot) {
      fill(occ, spot.x, spot.y, wh.size.w, wh.size.h, BUILDING);
      placements.push({ uid: `b${nextUid++}`, defId: wh.id, x: spot.x, y: spot.y, rot: 0 });
      bad = outOfRange(occ, placements, input.lookup);
    }
    for (const p of bad) {
      const d = input.lookup(p.defId)!;
      gaps.push(`${d.name} en (${p.x},${p.y}) : aucun entrepôt sous ${d.transporterRange ?? DEFAULT_RANGE} en distance-rue`);
    }
  }
  return { occ, placements, fields, gaps };
}

/** Rogne les bandes vides en bordure et décale tout le contenu. */
function trim(a: Attempt): PackResult {
  const used: number[] = [];
  for (let i = 0; i < a.occ.cell.length; i++) if (a.occ.cell[i] !== FREE) used.push(i);
  if (!used.length) {
    return {
      w: a.occ.w, h: a.occ.h, placements: [], roads: [], fields: [],
      tiles: { buildings: 0, fields: 0, roads: 0 }, efficiency: 0, gaps: a.gaps,
    };
  }
  let x0 = a.occ.w, y0 = a.occ.h, x1 = 0, y1 = 0;
  for (const i of used) {
    const x = i % a.occ.w;
    const y = (i / a.occ.w) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const roads: { x: number; y: number }[] = [];
  for (const i of used) {
    if (a.occ.cell[i] !== ROAD) continue;
    roads.push({ x: (i % a.occ.w) - x0, y: ((i / a.occ.w) | 0) - y0 });
  }
  const tiles = {
    buildings: count(a.occ, BUILDING),
    fields: count(a.occ, FIELD),
    roads: roads.length,
  };
  return {
    w, h,
    placements: a.placements.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 })),
    roads,
    fields: a.fields.map((f) => ({ ...f, x: f.x - x0, y: f.y - y0 })),
    tiles,
    efficiency: (tiles.buildings + tiles.fields + tiles.roads) / (w * h),
    gaps: a.gaps,
  };
}

/** Ordre total de comparaison : moins de manques, puis efficacité, puis petitesse, puis carré. */
function better(a: PackResult, b: PackResult): boolean {
  if (a.gaps.length !== b.gaps.length) return a.gaps.length < b.gaps.length;
  if (a.efficiency !== b.efficiency) return a.efficiency > b.efficiency;
  if (a.w * a.h !== b.w * b.h) return a.w * a.h < b.w * b.h;
  return Math.abs(a.w - a.h) < Math.abs(b.w - b.h);
}

export function packBlueprint(input: PackInput): PackResult {
  const wh = input.lookup(input.warehouseDefId);
  if (!wh) throw new Error(`Entrepôt introuvable : ${input.warehouseDefId}`);
  const copies = expandCopies(input);
  const area = usefulArea(copies, wh);

  let best: PackResult | null = null;
  for (const inflation of INFLATIONS) {
    for (const [rw, rh] of RATIOS) {
      const target = area * inflation;
      const unit = Math.sqrt(target / (rw * rh));
      const w = Math.max(wh.size.w + 2, Math.ceil(unit * rw));
      const h = Math.max(wh.size.h + 3, Math.ceil(unit * rh));
      const attempt = tryBox(input, copies, w, h);
      if (!attempt) continue;
      const r = trim(attempt);
      if (!best || better(r, best)) best = r;
    }
  }
  if (!best) throw new Error("Aucune boîte candidate n'a pu accueillir la chaîne.");
  return best;
}
