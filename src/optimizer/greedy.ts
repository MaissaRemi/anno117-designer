import { uid } from "../model/factories";
import { orthoNeighbors } from "../engine/geometry";
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

  // Y a-t-il au moins un bâtiment à placer qui exige une route ? Sinon (champs/
  // production sans accès route) on ne génère AUCUNE route : gros gain de densité.
  const anyRoad = order.some((id) => {
    const d = dec.defMap.get(id);
    return !!d && d.needsRoad && !d.roadRoot;
  });

  // épine verticale (connecte les rangées de routes des étagères)
  if (anyRoad) for (let y = y0; y <= y1; y++) addRoad(occ, W, H, x0, y, roads);

  // raccordement au comptoir / aux routes existantes (réseau relié à la racine)
  const bridge = (tx: number, ty: number) => {
    if (ty < 0 || ty >= H) return;
    const a = Math.min(x0, tx);
    const bx = Math.max(x0, tx);
    for (let x = a; x <= bx; x++) {
      if (occ[ty * W + x] === BLOCKED) continue; // ne traverse pas un verrouillé/non-usable
      addRoad(occ, W, H, x, ty, roads);
    }
  };
  // comptoir(s) verrouillé(s) -> route adjacente + pont vers l'épine
  for (const b of anyRoad ? req.lockedBuildings : []) {
    const def = dec.defMap.get(b.defId);
    if (!def?.roadRoot) continue;
    const { w, h } = rotatedSize(def, b.rotation);
    let done = false;
    for (let j = 0; j < h && !done; j++) {
      for (let i = 0; i < w && !done; i++) {
        for (const n of orthoNeighbors(b.x + i, b.y + j)) {
          if (n.x >= 0 && n.y >= 0 && n.x < W && n.y < H && occ[n.y * W + n.x] === FREE) {
            addRoad(occ, W, H, n.x, n.y, roads);
            bridge(n.x, n.y);
            done = true;
            break;
          }
        }
      }
    }
  }
  // routes existantes -> 1 pont depuis la plus proche
  if (anyRoad && req.existingRoads.length) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const r of req.existingRoads) {
      const d = Math.abs(r.x - x0) + Math.abs(r.y - y0);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best) bridge(best.x, best.y);
  }

  // Packing par ÉTAGÈRES de hauteur variable : chaque étagère prend la hauteur
  // du 1er bâtiment qui s'y pose (l'ordre étant trié décroissant => peu de perte),
  // au lieu d'une bande globale figée sur le plus grand bâtiment. Évite le gâchis
  // quand on mélange petites maisons et grandes fermes.
  const queue = order.slice();
  // décalage de départ vertical (perturbé par le recuit) borné à la plus grande hauteur
  let y = y0 + (bandOffset % (band + 1));
  while (queue.length && y <= y1) {
    // si route requise : la rangée de route occupe `y`, le bâtiment commence à y+1.
    // sinon : les étagères s'empilent directement (pas de gâchis de route).
    const roadY = anyRoad ? y : -1;
    const shelfTop = anyRoad ? y + 1 : y;
    if (shelfTop > y1) break;

    let shelfH = 0; // 0 = pas encore fixée
    let maxX = x0 - 1; // bord droit du dernier bâtiment posé (pour rogner la route)
    let x = anyRoad ? x0 + 1 : x0;
    while (x <= x1 && queue.length) {
      let placedHere = false;
      for (let qi = 0; qi < queue.length; qi++) {
        const defId = queue[qi];
        const def = dec.defMap.get(defId);
        if (!def || def.placement === "water") {
          // bâtiments côtiers : non plaçables par le packing terrestre → à poser à la main
          queue.splice(qi, 1);
          qi--;
          continue;
        }
        const variants = dec.macroCache.get(defId)!;
        const v = variants.find((m) => {
          const mh = macroHeight(m);
          if (shelfH > 0 && mh > shelfH) return false; // dépasse l'étagère en cours
          return fits(occ, W, H, x, shelfTop, m.w, mh, x1, y1);
        });
        if (!v) continue;
        if (shelfH === 0) shelfH = macroHeight(v); // 1er posé fixe la hauteur d'étagère
        placeBuilding(occ, W, buildings, placedByDef, defId, x, shelfTop, v);
        if (v.fieldTiles > 0 && v.fieldType) {
          placeFields(occ, W, fields, buildings[buildings.length - 1].uid, x, shelfTop + v.h, v);
        }
        x += v.w;
        maxX = x - 1;
        queue.splice(qi, 1);
        placedHere = true;
        break;
      }
      if (!placedHere) x += 1; // obstacle / rien ne rentre ici → avance
    }

    // rangée de route rognée à l'étendue réelle de l'étagère (au-dessus des bâtiments)
    if (roadY >= 0 && maxX >= x0) {
      for (let rx = x0; rx <= maxX; rx++) addRoad(occ, W, H, rx, roadY, roads);
    }

    if (shelfH === 0) {
      // rien n'a pu être posé sur cette étagère (espace résiduel trop court) → stop
      break;
    }
    y = shelfTop + shelfH; // étagère suivante (sa route sera posée au prochain tour)
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
