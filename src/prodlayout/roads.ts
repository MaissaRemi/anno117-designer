import { at, FREE, ROAD, setAt, type Occ } from "./occupancy";

/**
 * SQUELETTE ET PORTÉE.
 *
 * En jeu, un producteur n'expédie rien si aucun entrepôt n'est à `transporterRange` en
 * DISTANCE-RUE — le long de la voirie, pas à vol d'oiseau. Un plan qui ignore cette
 * distinction produit un joli tas de bâtiments qui ne rapporte rien.
 */

/**
 * Épine dorsale horizontale à `spineY` + branches verticales tous les `pitch`, en
 * commençant à `x0`. Ne peint que les cases LIBRES : l'entrepôt est déjà posé quand cette
 * fonction s'exécute, et une branche qui le rencontre s'arrête contre lui — ce qui est
 * exactement l'accès route dont il a besoin.
 */
export function paintSkeleton(o: Occ, spineY: number, pitch: number, x0 = 0): void {
  const step = Math.max(2, pitch);
  for (let x = 0; x < o.w; x++) if (at(o, x, spineY) === FREE) setAt(o, x, spineY, ROAD);
  for (let x = x0; x < o.w; x += step) {
    for (let y = 0; y < o.h; y++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
  }
  // la dernière colonne, si le pas ne tombe pas dessus : sans elle, la bande de droite
  // n'a de route que d'un côté et les bâtiments profonds n'y accèdent plus.
  const last = o.w - 1;
  if ((last - x0) % step !== 0) {
    for (let y = 0; y < o.h; y++) if (at(o, last, y) === FREE) setAt(o, last, y, ROAD);
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
