import { at, FIELD, FREE, RESERVED, setAt, type Occ } from "./occupancy";

/**
 * CHAMPS ET AIRES LIBRES — les deux exigences de surface que le catalogue déclare.
 *
 * `field.tiles` : une ferme de céréales veut 140 cases de champ dans son rayon, sans quoi
 * elle tourne à rendement partiel. `freeArea` : un bûcheron produit en proportion des cases
 * LIBRES autour de lui, donc le serrer l'étrangle. Ni l'un ni l'autre n'exige de route.
 *
 * La distance est L∞ depuis l'emprise (« à N cases du bâtiment »), et le remplissage se
 * fait en anneaux croissants pour que les cases proches partent en premier — deux fermes
 * voisines se partagent alors le terrain au lieu que la première rafle tout au loin.
 */

export interface FarmClaim {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  tiles: number;
  fieldType: string;
  ownerUid: string;
}

export interface FieldCell {
  x: number;
  y: number;
  ownerUid: string;
  fieldType: string;
}

/** Distance L∞ d'une case au rectangle. 0 si elle est dedans. */
const distToRect = (cx: number, cy: number, x: number, y: number, w: number, h: number): number =>
  Math.max(Math.max(x - cx, 0, cx - (x + w - 1)), Math.max(y - cy, 0, cy - (y + h - 1)));

export function fillFields(o: Occ, c: FarmClaim): FieldCell[] {
  const out: FieldCell[] = [];
  for (let ring = 1; ring <= c.radius && out.length < c.tiles; ring++) {
    const x0 = c.x - ring;
    const y0 = c.y - ring;
    const x1 = c.x + c.w - 1 + ring;
    const y1 = c.y + c.h - 1 + ring;
    for (let cy = y0; cy <= y1 && out.length < c.tiles; cy++) {
      for (let cx = x0; cx <= x1 && out.length < c.tiles; cx++) {
        if (distToRect(cx, cy, c.x, c.y, c.w, c.h) !== ring) continue;
        if (at(o, cx, cy) !== FREE) continue;
        setAt(o, cx, cy, FIELD);
        out.push({ x: cx, y: cy, ownerUid: c.ownerUid, fieldType: c.fieldType });
      }
    }
  }
  return out;
}

/**
 * Réserve les cases libres à `radius` du bâtiment : plus rien ne s'y bâtira. Rend le
 * nombre de cases réservées, pour que l'appelant sache si l'aire exigée est atteinte.
 */
export function reserveFreeArea(
  o: Occ, x: number, y: number, w: number, h: number, radius: number,
  opts: {
    /** Cases à réserver au plus, les plus proches d'abord. Absent : toutes celles du rayon. */
    max?: number;
    /** Reçoit les cases réservées par cet appel, pour qui veut les montrer. */
    cases?: { x: number; y: number }[];
  } = {},
): number {
  const libres: { x: number; y: number; d: number }[] = [];
  for (let cy = y - radius; cy <= y + h - 1 + radius; cy++) {
    for (let cx = x - radius; cx <= x + w - 1 + radius; cx++) {
      const d = distToRect(cx, cy, x, y, w, h);
      if (d > radius || at(o, cx, cy) !== FREE) continue;
      libres.push({ x: cx, y: cy, d });
    }
  }
  // tri stable : à distance égale, l'ordre de balayage (haut-gauche d'abord) est gardé
  libres.sort((a, b) => a.d - b.d);
  const gardees = libres.slice(0, opts.max ?? libres.length);
  for (const c of gardees) {
    setAt(o, c.x, c.y, RESERVED);
    opts.cases?.push({ x: c.x, y: c.y });
  }
  return gardees.length;
}

/** Cases libres disponibles à `radius` du rectangle — sonde avant réservation. */
export function freeAround(
  o: Occ, x: number, y: number, w: number, h: number, radius: number,
): number {
  let n = 0;
  for (let cy = y - radius; cy <= y + h - 1 + radius; cy++) {
    for (let cx = x - radius; cx <= x + w - 1 + radius; cx++) {
      if (distToRect(cx, cy, x, y, w, h) > radius) continue;
      if (at(o, cx, cy) === FREE) n++;
    }
  }
  return n;
}

/**
 * Cases DÉJÀ réservées à `radius` du rectangle. Elles comptent dans l'aire libre : une
 * case réservée est libre par construction, c'est la réservation qui la garde telle.
 * Sans cette sonde, un bâtiment à `freeArea` échouerait son propre contrôle dès que sa
 * réservation aurait été posée.
 */
export function reservedAround(
  o: Occ, x: number, y: number, w: number, h: number, radius: number,
): number {
  let n = 0;
  for (let cy = y - radius; cy <= y + h - 1 + radius; cy++) {
    for (let cx = x - radius; cx <= x + w - 1 + radius; cx++) {
      if (distToRect(cx, cy, x, y, w, h) > radius) continue;
      if (at(o, cx, cy) === RESERVED) n++;
    }
  }
  return n;
}
