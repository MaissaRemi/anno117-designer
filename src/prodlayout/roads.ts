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
 * Les branches partent de 0 et suivent le pas, sans plus JAMAIS forcer la dernière ligne
 * de l'axe transverse. C'est cette ligne forcée qui gaspillait, et elle seule.
 *
 * TENTATIVE RÉFUTÉE, gardée avec ses chiffres. La première version interdisait AUSSI la
 * première ligne, au motif qu'une route de bord ne dessert que d'un côté. Mesure sur le
 * pain ×2, à objectif identique : branches intérieures → 551 cases et 77 routes ; branches
 * depuis 0 → 529 cases et 73 routes. La branche de bord n'est pas du gaspillage, elle donne
 * la façade-route des bâtiments collés au bord, sans laquelle il faut une plus grande
 * boîte — et donc plus de routes au total. Seule la dernière colonne forcée coûtait pour
 * rien : 83 → 73 cases de route à surface égale.
 *
 * La ligne forcée existait pour garantir l'accès de la bande de droite. Ce n'est plus
 * nécessaire : le verdict `served` est strict, donc une bande inaccessible fait échouer la
 * boîte et la recherche en essaie une autre. La garantie est passée du squelette au
 * verdict.
 *
 * Ne peint que les cases LIBRES. L'entrepôt est déjà posé quand cette fonction s'exécute,
 * et une branche qui le rencontre s'arrête contre lui — l'accès route dont il a besoin.
 * Les cases hors forme (BLOCKED) sont épargnées par la même garde.
 */
export function paintSkeleton(o: Occ, spinePos: number, pitch: number, axis: SpineAxis = "h"): void {
  const step = Math.max(2, pitch);
  if (axis === "h") {
    for (let x = 0; x < o.w; x++) if (at(o, x, spinePos) === FREE) setAt(o, x, spinePos, ROAD);
    for (let x = 0; x < o.w; x += step) {
      for (let y = 0; y < o.h; y++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
    }
  } else {
    for (let y = 0; y < o.h; y++) if (at(o, spinePos, y) === FREE) setAt(o, spinePos, y, ROAD);
    for (let y = 0; y < o.h; y += step) {
      for (let x = 0; x < o.w; x++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
    }
  }
}

/**
 * Étiquette les composantes de la voirie. -1 pour ce qui n'est pas une route.
 *
 * Deux tronçons de route qui se touchent tous deux à un ENTREPÔT ne sont pas reliés pour
 * autant : en jeu, la voirie passe par des routes, pas à travers un bâtiment.
 */
export function roadComponents(o: Occ): Int32Array {
  const comp = new Int32Array(o.w * o.h).fill(-1);
  let next = 0;
  for (let s = 0; s < comp.length; s++) {
    if (o.cell[s] !== ROAD || comp[s] !== -1) continue;
    const id = next++;
    const pile = [s];
    comp[s] = id;
    while (pile.length) {
      const c = pile.pop()!;
      const x = c % o.w;
      const y = (c / o.w) | 0;
      const nbs = [
        x > 0 ? c - 1 : -1,
        x < o.w - 1 ? c + 1 : -1,
        y > 0 ? c - o.w : -1,
        y < o.h - 1 ? c + o.w : -1,
      ];
      for (const nb of nbs) {
        if (nb < 0 || o.cell[nb] !== ROAD || comp[nb] !== -1) continue;
        comp[nb] = id;
        pile.push(nb);
      }
    }
  }
  return comp;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Raccorde les îlots de voirie à la composante principale, par le couloir LIBRE le plus
 * court, en ligne droite.
 *
 * Une branche verticale que l'entrepôt interrompt laisse un tronçon au-delà de lui. Ce
 * tronçon touche l'entrepôt, donc il paraît desservi — `outOfRange` le voit à un pas — mais
 * il n'est relié à RIEN d'autre : le comptoir, qui arrive par la sortie, ne l'atteint
 * jamais. Le défaut est antérieur à ce module et passait inaperçu faute de contrôle de
 * connexité ; c'est l'invariant de composante unique qui l'a fait apparaître.
 *
 * Appelée juste après le squelette, quand seul l'entrepôt est posé : le couloir a alors le
 * maximum de latitude. Un îlot non raccordable est laissé tel quel — c'est `pack.ts` qui le
 * signalera, plutôt que de le taire.
 */
export function connectRoads(o: Occ): void {
  for (let garde = 0; garde < 64; garde++) {
    const comp = roadComponents(o);
    const tailles = new Map<number, number>();
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] >= 0) tailles.set(comp[i], (tailles.get(comp[i]) ?? 0) + 1);
    }
    if (tailles.size <= 1) return;

    // principale : la plus grande, à égalité la plus petite étiquette (ordre total)
    let principale = -1;
    let meilleure = -1;
    for (const [id, n] of [...tailles.entries()].sort((a, b) => a[0] - b[0])) {
      if (n > meilleure) {
        meilleure = n;
        principale = id;
      }
    }

    let couloir: { run: number[] } | null = null;
    for (let i = 0; i < comp.length; i++) {
      if (comp[i] < 0 || comp[i] === principale) continue;
      const x0 = i % o.w;
      const y0 = (i / o.w) | 0;
      for (const [dx, dy] of DIRS) {
        const run: number[] = [];
        let x = x0 + dx;
        let y = y0 + dy;
        while (x >= 0 && y >= 0 && x < o.w && y < o.h) {
          const c = y * o.w + x;
          if (o.cell[c] === ROAD) {
            if (comp[c] === principale && run.length) {
              if (!couloir || run.length < couloir.run.length) couloir = { run: [...run] };
            }
            break;
          }
          if (o.cell[c] !== FREE) break;
          run.push(c);
          x += dx;
          y += dy;
        }
      }
    }
    if (!couloir) return; // plus rien de raccordable en ligne droite
    for (const c of couloir.run) o.cell[c] = ROAD;
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
