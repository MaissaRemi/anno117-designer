import { uid } from "../model/factories";
import type { BuildingDef, FieldTile, PlacedBuilding, Rotation, RoadTile } from "../model/types";
import type { OptimizeRequest } from "./types";

const FREE = 0;
const BLOCKED = 1;
const ROAD = 2;

export interface DecodeOutput {
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  fields: FieldTile[];
  placedByDef: Record<string, number>;
}

interface Macro {
  w: number; // largeur emprise (rotée)
  h: number; // hauteur bâtiment (rotée)
  rot: Rotation;
  fieldRows: number; // rangées de champ sous le bâtiment
  fieldTiles: number;
  fieldType: string | null;
}

function rotatedSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: def.size.h, h: def.size.w } : { w: def.size.w, h: def.size.h };
}

/** Variantes macro (bâtiment + bloc champ) selon orientation. */
function macros(def: BuildingDef): Macro[] {
  const rots: Rotation[] = def.rotatable && def.size.w !== def.size.h ? [0, 90] : [0];
  return rots.map((rot) => {
    const { w, h } = rotatedSize(def, rot);
    const tiles = def.field?.tiles ?? 0;
    const fieldRows = tiles > 0 ? Math.ceil(tiles / w) : 0;
    return { w, h, rot, fieldRows, fieldTiles: tiles, fieldType: def.field?.fieldType ?? null };
  });
}

export function macroHeight(m: Macro): number {
  return m.h + m.fieldRows;
}

/** Hauteur de bande minimale pour caser tous les items (meilleure orientation). */
export function bandHeightFor(req: OptimizeRequest, defMap: Map<string, BuildingDef>): number {
  let band = 1;
  for (const it of req.items) {
    const def = defMap.get(it.defId);
    if (!def) continue;
    const best = Math.min(...macros(def).map(macroHeight));
    band = Math.max(band, best);
  }
  return band;
}

export interface Decoder {
  W: number;
  H: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  band: number;
  defMap: Map<string, BuildingDef>;
  macroCache: Map<string, Macro[]>;
}

export function makeDecoder(req: OptimizeRequest): Decoder {
  const { grid } = req;
  const defMap = new Map(req.catalog.map((d) => [d.id, d]));
  // bbox des cases utilisables
  let x0 = grid.w, y0 = grid.h, x1 = -1, y1 = -1;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.usable[y * grid.w + x]) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    x0 = y0 = 0;
    x1 = grid.w - 1;
    y1 = grid.h - 1;
  }
  const macroCache = new Map<string, Macro[]>();
  for (const d of req.catalog) macroCache.set(d.id, macros(d));
  return {
    W: grid.w,
    H: grid.h,
    x0,
    y0,
    x1,
    y1,
    band: bandHeightFor(req, defMap),
    defMap,
    macroCache,
  };
}

/** Décode (ordre, décalage de bande) → disposition concrète. */
export function decode(
  req: OptimizeRequest,
  dec: Decoder,
  order: string[],
  bandOffset: number,
): DecodeOutput {
  const { W, H } = dec;
  const occ = new Uint8Array(W * H);
  // init : cases non utilisables = bloquées
  for (let i = 0; i < W * H; i++) if (!req.grid.usable[i]) occ[i] = BLOCKED;
  // bâtiments verrouillés + leurs champs
  for (const b of req.lockedBuildings) {
    const def = dec.defMap.get(b.defId);
    if (!def) continue;
    const { w, h } = rotatedSize(def, b.rotation);
    fill(occ, W, b.x, b.y, w, h, BLOCKED);
  }
  for (const f of req.existingFields) setCell(occ, W, H, f.x, f.y, BLOCKED);
  for (const r of req.existingRoads) setCell(occ, W, H, r.x, r.y, ROAD);

  const roads: RoadTile[] = [];
  const fields: FieldTile[] = [];
  const buildings: PlacedBuilding[] = [];
  const placedByDef: Record<string, number> = {};

  const { x0, y0, x1, y1, band } = dec;

  // épine verticale (connecte les routes horizontales)
  for (let y = y0; y <= y1; y++) addRoad(occ, W, H, x0, y, roads);

  // routes horizontales tous les (band+1) rangs
  const roadRows: number[] = [];
  for (let ry = y0 + (bandOffset % (band + 1)); ry <= y1; ry += band + 1) {
    roadRows.push(ry);
    for (let x = x0; x <= x1; x++) addRoad(occ, W, H, x, ry, roads);
  }

  // packing bande par bande
  const queue = order.slice();
  for (const ry of roadRows) {
    const bandTop = ry + 1;
    if (bandTop > y1) break;
    let x = x0 + 1;
    while (x <= x1 && queue.length) {
      let placedHere = false;
      for (let qi = 0; qi < queue.length; qi++) {
        const defId = queue[qi];
        const def = dec.defMap.get(defId);
        if (!def) {
          queue.splice(qi, 1);
          qi--;
          continue;
        }
        const variants = dec.macroCache.get(defId)!;
        const v = variants.find(
          (m) => macroHeight(m) <= band && fits(occ, W, H, x, bandTop, m.w, macroHeight(m), x1, y1),
        );
        if (!v) continue;
        // place bâtiment
        placeBuilding(occ, W, buildings, placedByDef, defId, x, bandTop, v);
        // champs
        if (v.fieldTiles > 0 && v.fieldType) {
          placeFields(occ, W, fields, buildings[buildings.length - 1].uid, x, bandTop + v.h, v);
        }
        x += v.w;
        queue.splice(qi, 1);
        placedHere = true;
        break;
      }
      if (!placedHere) x += 1; // obstacle / rien ne rentre ici → avance
    }
    if (!queue.length) break;
  }

  return { buildings, roads, fields, placedByDef };
}

function placeBuilding(
  occ: Uint8Array,
  W: number,
  out: PlacedBuilding[],
  counts: Record<string, number>,
  defId: string,
  x: number,
  y: number,
  m: Macro,
): void {
  fill(occ, W, x, y, m.w, m.h, BLOCKED);
  out.push({ uid: uid("opt"), defId, x, y, rotation: m.rot, locked: false });
  counts[defId] = (counts[defId] ?? 0) + 1;
}

function placeFields(
  occ: Uint8Array,
  W: number,
  out: FieldTile[],
  ownerUid: string,
  x: number,
  yStart: number,
  m: Macro,
): void {
  let remaining = m.fieldTiles;
  let y = yStart;
  while (remaining > 0) {
    for (let i = 0; i < m.w && remaining > 0; i++) {
      const cx = x + i;
      occ[y * W + cx] = BLOCKED;
      out.push({ x: cx, y, ownerUid, fieldType: m.fieldType! });
      remaining--;
    }
    y++;
  }
}

function fits(
  occ: Uint8Array,
  W: number,
  H: number,
  x: number,
  y: number,
  w: number,
  h: number,
  x1: number,
  y1: number,
): boolean {
  if (x + w - 1 > x1 || y + h - 1 > y1) return false;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const cx = x + i;
      const cy = y + j;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
      if (occ[cy * W + cx] !== FREE) return false;
    }
  }
  return true;
}

function fill(occ: Uint8Array, W: number, x: number, y: number, w: number, h: number, v: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) occ[(y + j) * W + (x + i)] = v;
}

function setCell(occ: Uint8Array, W: number, H: number, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  occ[y * W + x] = v;
}

function addRoad(occ: Uint8Array, W: number, H: number, x: number, y: number, roads: RoadTile[]): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const idx = y * W + x;
  if (occ[idx] === BLOCKED) return; // ne pas écraser un verrouillé/non-usable
  if (occ[idx] !== ROAD) {
    occ[idx] = ROAD;
    roads.push({ x, y });
  }
}
