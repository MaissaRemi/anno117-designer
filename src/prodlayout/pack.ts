import type { BuildingDef } from "../model/types";
import type { Advisory } from "./basket";
import type { Lookup } from "./chain";
import { ensureExit, type ExitPoint, type ExitSide } from "./exit";
import { fillFields, freeAround, reserveFreeArea, reservedAround, type FieldCell } from "./fields";
import {
  BLOCKED, BUILDING, count, FIELD, fill, fits, FREE, makeOcc, ROAD, type Occ,
} from "./occupancy";
import { adjacentRoads, connectRoads, paintSkeleton, roadDistances } from "./roads";
import type { Unmet } from "./unmet";

/**
 * LE PLACEUR — glouton, à ordre total, sans une once d'aléa.
 *
 * `tryBox` pose une commande dans UNE boîte donnée et rend le compte exact de ce qui
 * manque. Le choix de la boîte, lui, est le travail de `search.ts` : ce fichier ne décide
 * plus des dimensions, il constate ce qu'une dimension permet.
 *
 * Le déterminisme n'est pas une coquetterie : c'est ce qui rend le module MESURABLE. Sans
 * lui, « la version B fait mieux que A » ne serait que du bruit de placement, et le projet
 * a déjà payé pour apprendre à ne pas confondre les deux.
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
  /** Masque de la boîte finale, après rognage. `false` = hors forme. */
  usable: boolean[];
  tiles: { buildings: number; fields: number; roads: number };
  /** Mesure AFFICHÉE, dénominateur = surface utilisable. Ne décide plus de rien. */
  efficiency: number;
  exit: ExitPoint | null;
  unmet: Unmet[];
  advisories: Advisory[];
  served: boolean;
}

const DEFAULT_RANGE = 30;

const sizeOf = (d: BuildingDef, rot: Rot0or90) =>
  rot === 90 ? { w: d.size.h, h: d.size.w } : { w: d.size.w, h: d.size.h };

/** Groupe de pose : plus le nombre est petit, plus le bâtiment est contraint. */
const groupOf = (d: BuildingDef): number => (d.freeArea ? 0 : d.field ? 1 : 2);

/** Une copie à poser, dans l'ordre total de pose. */
export interface Copy {
  defId: string;
  def: BuildingDef;
  group: number;
}

export function expandCopies(input: PackInput): Copy[] {
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
export function usefulArea(copies: Copy[], wh: BuildingDef): number {
  let s = wh.size.w * wh.size.h;
  for (const c of copies) {
    s += c.def.size.w * c.def.size.h;
    s += c.def.field?.tiles ?? 0;
    s += c.def.freeArea?.area ?? 0;
  }
  return s;
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

/** Producteurs hors de portée d'un entrepôt, en distance-rue, avec leur écart chiffré. */
function outOfRange(
  occ: Occ, placements: Placement[], lookup: Lookup,
): { p: Placement; distance: number; portee: number }[] {
  const dist = roadDistances(occ, warehouseSeeds(occ, placements, lookup));
  const bad: { p: Placement; distance: number; portee: number }[] = [];
  for (const p of placements) {
    const d = lookup(p.defId);
    if (!d?.production) continue;
    const { w, h } = sizeOf(d, p.rot);
    const reach = adjacentRoads(occ, p.x, p.y, w, h).map((c) => dist[c]).filter((v) => v >= 0);
    const best = reach.length ? Math.min(...reach) : Infinity;
    const portee = d.transporterRange ?? DEFAULT_RANGE;
    if (best > portee) bad.push({ p, distance: Number.isFinite(best) ? best : -1, portee });
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

interface Attempt {
  occ: Occ;
  placements: Placement[];
  fields: FieldCell[];
  exit: ExitPoint | null;
  unmet: Unmet[];
  advisories: Advisory[];
}

/** Résultat vide, pour une boîte qui ne peut même pas accueillir l'entrepôt. */
function riens(input: PackInput, w: number, h: number, exitSide: ExitSide): PackResult {
  const unmet: Unmet[] = [{ kind: "non-pose", defId: input.warehouseDefId, manque: 1 }];
  for (const it of [...input.items].sort((a, b) => a.defId.localeCompare(b.defId))) {
    unmet.push({ kind: "non-pose", defId: it.defId, manque: it.count });
  }
  unmet.push({ kind: "sortie", side: exitSide });
  return {
    w, h, placements: [], roads: [], fields: [], usable: new Array(w * h).fill(true),
    tiles: { buildings: 0, fields: 0, roads: 0 }, efficiency: 0,
    exit: null, unmet, advisories: [], served: false,
  };
}

/**
 * Pose la commande dans une boîte de dimensions données, et rend ce qui manque.
 *
 * Ne rend jamais `null` : une boîte trop petite produit un résultat NON SERVI, chiffré.
 * C'est ce qui permet au mode « boîte imposée » de dire quoi ajouter, là où un échec muet
 * ne laisserait à l'utilisateur qu'un message vague.
 */
export function tryBox(
  input: PackInput,
  w: number,
  h: number,
  exitSide: ExitSide,
  usable?: readonly boolean[],
): PackResult {
  const wh = input.lookup(input.warehouseDefId);
  if (!wh) throw new Error(`Entrepôt introuvable : ${input.warehouseDefId}`);
  const copies = expandCopies(input);

  const occ = makeOcc(w, h, usable);
  const placements: Placement[] = [];
  const fields: FieldCell[] = [];
  const unmet: Unmet[] = [];
  let nextUid = 0;

  // 1. l'entrepôt, ancre de la portée de charrette
  const wx = Math.floor((w - wh.size.w) / 2);
  const wy = Math.floor((h - wh.size.h) / 2);
  if (wx < 0 || wy < 0 || wy + wh.size.h >= h || !fits(occ, wx, wy, wh.size.w, wh.size.h)) {
    return riens(input, w, h, exitSide);
  }
  fill(occ, wx, wy, wh.size.w, wh.size.h, BUILDING);
  placements.push({ uid: `b${nextUid++}`, defId: wh.id, x: wx, y: wy, rot: 0 });

  // 2. le squelette. L'épine longe l'entrepôt sans le couper, et suit le grand axe de la
  //    boîte : une bande haute et étroite veut une épine verticale, pas horizontale.
  const deepest = copies.reduce((m, c) => Math.max(m, c.def.size.w, c.def.size.h), 1);
  const axis = w >= h ? "h" : "v";
  paintSkeleton(occ, axis === "h" ? wy + wh.size.h : wx + wh.size.w, 2 * deepest + 1, axis);
  // une branche coupée par l'entrepôt laisse un tronçon orphelin de l'autre côté : on le
  // raccorde tant que rien d'autre n'est encore posé et que le couloir a de la place.
  connectRoads(occ);

  // 3. les copies, du plus contraint au plus libre
  const nonPoses = new Map<string, number>();
  for (const c of copies) {
    const spot = findSpot(occ, c.def, c.def.needsRoad);
    if (!spot) {
      nonPoses.set(c.defId, (nonPoses.get(c.defId) ?? 0) + 1);
      continue;
    }
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
        unmet.push({ kind: "champ", defId: c.defId, uid, obtenu: got.length, requis: c.def.field.tiles });
      }
    }
  }
  for (const [defId, manque] of [...nonPoses.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    unmet.push({ kind: "non-pose", defId, manque });
  }

  // 4. la sortie de route, AVANT le bilan de portée : le couloir creusé compte
  const exit = ensureExit(occ, exitSide, warehouseSeeds(occ, placements, input.lookup));
  if (!exit) unmet.push({ kind: "sortie", side: exitSide });

  // 5. portée d'entrepôt ; un second entrepôt si des producteurs sont trop loin
  let bad = outOfRange(occ, placements, input.lookup);
  if (bad.length) {
    const cx = Math.round(bad.reduce((s, b) => s + b.p.x, 0) / bad.length);
    const cy = Math.round(bad.reduce((s, b) => s + b.p.y, 0) / bad.length);
    const spot = findNear(occ, wh, cx, cy);
    if (spot) {
      fill(occ, spot.x, spot.y, wh.size.w, wh.size.h, BUILDING);
      placements.push({ uid: `b${nextUid++}`, defId: wh.id, x: spot.x, y: spot.y, rot: 0 });
      bad = outOfRange(occ, placements, input.lookup);
    }
  }
  for (const b of bad) {
    unmet.push({ kind: "portee", defId: b.p.defId, uid: b.p.uid, distance: b.distance, portee: b.portee });
  }

  // 6. accès route ET connexité. Être sur UNE route ne suffit pas : il faut être sur la
  //    MÊME que la sortie. Sans ce test, deux îlots de voirie séparés passeraient tous les
  //    autres contrôles en étant injouables — le comptoir ne verrait que le premier.
  const depuisSortie = exit ? roadDistances(occ, [exit.y * occ.w + exit.x]) : null;
  for (const p of placements) {
    const d = input.lookup(p.defId)!;
    if (!d.needsRoad) continue;
    const { w: pw, h: ph } = sizeOf(d, p.rot);
    const voisines = adjacentRoads(occ, p.x, p.y, pw, ph);
    const relie = depuisSortie ? voisines.some((c) => depuisSortie[c] >= 0) : false;
    if (!relie) unmet.push({ kind: "route", defId: p.defId, uid: p.uid });
  }

  // 7. les aires libres, à l'état FINAL. Une case réservée compte : elle est libre par
  //    construction, c'est la réservation qui la garde telle.
  for (const p of placements) {
    const d = input.lookup(p.defId)!;
    if (!d.freeArea) continue;
    const { w: pw, h: ph } = sizeOf(d, p.rot);
    const libre = freeAround(occ, p.x, p.y, pw, ph, d.freeArea.radius)
      + reservedAround(occ, p.x, p.y, pw, ph, d.freeArea.radius);
    if (libre < d.freeArea.area) {
      unmet.push({ kind: "aire-libre", defId: p.defId, uid: p.uid, obtenu: libre, requis: d.freeArea.area });
    }
  }

  // 8. les avis se relèvent sur ce qui est RÉELLEMENT posé — une copie restée sans place
  //    ne mérite pas d'avis.
  const advisories: Advisory[] = [];
  const vus = new Set<string>();
  for (const p of placements) {
    const slotType = input.lookup(p.defId)?.slotType;
    if (!slotType || vus.has(p.defId)) continue;
    vus.add(p.defId);
    advisories.push({ defId: p.defId, slotType });
  }
  advisories.sort((a, b) => a.defId.localeCompare(b.defId));

  return trim({ occ, placements, fields, exit, unmet, advisories });
}

/** Rogne les bandes vides en bordure et décale tout le contenu. */
function trim(a: Attempt): PackResult {
  const used: number[] = [];
  for (let i = 0; i < a.occ.cell.length; i++) {
    // BLOCKED n'est pas du contenu : une bande hors forme en bordure ne doit pas gonfler
    // la boîte rendue, sans quoi la surface mesurée mentirait sur le plan réel.
    if (a.occ.cell[i] !== FREE && a.occ.cell[i] !== BLOCKED) used.push(i);
  }
  if (!used.length) {
    return {
      w: a.occ.w, h: a.occ.h, placements: [], roads: [], fields: [],
      usable: new Array(a.occ.w * a.occ.h).fill(true),
      tiles: { buildings: 0, fields: 0, roads: 0 }, efficiency: 0,
      exit: a.exit, unmet: a.unmet, advisories: a.advisories, served: false,
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

  const usable: boolean[] = new Array(w * h);
  let dispo = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ok = a.occ.cell[(y + y0) * a.occ.w + (x + x0)] !== BLOCKED;
      usable[y * w + x] = ok;
      if (ok) dispo++;
    }
  }

  return {
    w, h,
    placements: a.placements.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 })),
    roads,
    fields: a.fields.map((f) => ({ ...f, x: f.x - x0, y: f.y - y0 })),
    usable,
    tiles,
    efficiency: dispo > 0 ? (tiles.buildings + tiles.fields + tiles.roads) / dispo : 0,
    exit: a.exit ? { ...a.exit, x: a.exit.x - x0, y: a.exit.y - y0 } : null,
    unmet: a.unmet,
    advisories: a.advisories,
    served: a.unmet.length === 0 && a.exit !== null,
  };
}

/**
 * ORDRE TOTAL : servi, puis petit, puis carré.
 *
 * L'efficacité a été RETIRÉE du classement, et c'est délibéré. Elle vaut
 * (bâtiments + champs + routes) / surface, donc elle compte les routes au NUMÉRATEUR :
 * mesuré sur le pain ×2, retirer les 46 cases de route de bord — inutiles, elles ne
 * desservaient qu'un côté — faisait BAISSER le score. Un critère qui récompense le
 * gaspillage ne peut pas arbitrer une recherche de compacité.
 *
 * Entre deux plans NON servis, c'est le nombre de manques qui départage : un refus doit
 * être le plus instructif possible, pas le plus petit.
 */
export function better(a: PackResult, b: PackResult): boolean {
  if (a.served !== b.served) return a.served;
  if (!a.served && a.unmet.length !== b.unmet.length) return a.unmet.length < b.unmet.length;
  if (a.w * a.h !== b.w * b.h) return a.w * a.h < b.w * b.h;
  return Math.abs(a.w - a.h) < Math.abs(b.w - b.h);
}
