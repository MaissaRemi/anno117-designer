import { at, FREE, ROAD, setAt, type Occ } from "./occupancy";

/**
 * SQUELETTE ET PORTÉE.
 *
 * En jeu, un producteur n'expédie rien si aucun entrepôt n'est à `transporterRange` en
 * DISTANCE-RUE — le long de la voirie, pas à vol d'oiseau. Un plan qui ignore cette
 * distinction produit un joli tas de bâtiments qui ne rapporte rien.
 */

export type SpineAxis = "h" | "v";

/**
 * Épine dorsale à `spinePos` et branches perpendiculaires tous les `pitch`.
 *
 * Les branches sont INTÉRIEURES : jamais la première ni la dernière ligne de l'axe
 * transverse. Une route de bord ne dessert que d'un côté, et la mesure était sévère — sur
 * le pain ×2 en 23×23, les deux colonnes de bord faisaient 46 des 83 cases de route du
 * plan. Le prix à payer est que le squelette n'atteint plus le bord tout seul : c'est
 * désormais `exit.ts` qui garantit le débouché, par contrat plutôt que par accident.
 *
 * Ne peint que les cases LIBRES. L'entrepôt est déjà posé quand cette fonction s'exécute,
 * et une branche qui le rencontre s'arrête contre lui — l'accès route dont il a besoin.
 * Les cases hors forme (BLOCKED) sont épargnées par la même garde.
 */
export function paintSkeleton(o: Occ, spinePos: number, pitch: number, axis: SpineAxis = "h"): void {
  const step = Math.max(2, pitch);
  if (axis === "h") {
    for (let x = 0; x < o.w; x++) if (at(o, x, spinePos) === FREE) setAt(o, x, spinePos, ROAD);
    for (let x = 1; x <= o.w - 2; x += step) {
      for (let y = 0; y < o.h; y++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
    }
  } else {
    for (let y = 0; y < o.h; y++) if (at(o, spinePos, y) === FREE) setAt(o, spinePos, y, ROAD);
    for (let y = 1; y <= o.h - 2; y += step) {
      for (let x = 0; x < o.w; x++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
    }
  }
}

/** Indices des cases ROUTE contiguës aux quatre côtés d'un rectangle. */
export function adjacentRoads(o: Occ, x: number, y: number, w: number, h: number): number[] {
  const out = new Set<number>();
  const test = (cx: number, cy: number) => {
    if (at(o, cx, cy) === ROAD) out.add(cy * o.w + cx);
  };
  for (let i = 0; i < w; i++) {
    test(x + i, y - 1);
    test(x + i, y + h);
  }
  for (let j = 0; j < h; j++) {
    test(x - 1, y + j);
    test(x + w, y + j);
  }
  return [...out];
}

export const touchesRoad = (o: Occ, x: number, y: number, w: number, h: number): boolean =>
  adjacentRoads(o, x, y, w, h).length > 0;

/**
 * Distance-rue depuis un ensemble de graines. Les graines sont à **1**, comme la
 * convention du reste du projet (une case de route contiguë à l'entrepôt est à un pas).
 * Les cases non-route et les inatteignables restent à -1.
 */
export function roadDistances(o: Occ, seeds: number[]): Int32Array {
  const dist = new Int32Array(o.w * o.h).fill(-1);
  let frontier: number[] = [];
  for (const s of seeds) {
    if (o.cell[s] !== ROAD || dist[s] !== -1) continue;
    dist[s] = 1;
    frontier.push(s);
  }
  let d = 1;
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) {
      const x = c % o.w;
      const y = (c / o.w) | 0;
      const nbs = [
        x > 0 ? c - 1 : -1,
        x < o.w - 1 ? c + 1 : -1,
        y > 0 ? c - o.w : -1,
        y < o.h - 1 ? c + o.w : -1,
      ];
      for (const nb of nbs) {
        if (nb < 0 || o.cell[nb] !== ROAD || dist[nb] !== -1) continue;
        dist[nb] = d + 1;
        next.push(nb);
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}
