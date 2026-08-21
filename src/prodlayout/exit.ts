import { FREE, ROAD, setAt, type Occ } from "./occupancy";
import { roadDistances } from "./roads";

/**
 * LA SORTIE DE ROUTE — la seule règle qui ne vienne pas du catalogue.
 *
 * Un blueprint recopié sur une île se branche au comptoir général par UNE case de route
 * qui sort du plan. Sans elle, l'entrepôt n'expédie rien et tout le plan est décoratif.
 * Le squelette ne peignant plus les colonnes de bord, ce débouché ne peut plus arriver
 * par accident : il est garanti ici, ou il n'existe pas et le plan est refusé.
 */

export type ExitSide = "nord" | "sud" | "est" | "ouest";

export interface ExitPoint {
  x: number;
  y: number;
  side: ExitSide;
}

export const EXIT_SIDES: readonly ExitSide[] = ["nord", "sud", "est", "ouest"];

/** Cases du bord demandé, dans un ordre total — donc un résultat reproductible. */
function borderCells(o: Occ, side: ExitSide): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (side === "nord") for (let x = 0; x < o.w; x++) out.push({ x, y: 0 });
  else if (side === "sud") for (let x = 0; x < o.w; x++) out.push({ x, y: o.h - 1 });
  else if (side === "ouest") for (let y = 0; y < o.h; y++) out.push({ x: 0, y });
  else for (let y = 0; y < o.h; y++) out.push({ x: o.w - 1, y });
  return out;
}

/** Pas vers l'intérieur, depuis le bord demandé. */
const inward = (side: ExitSide): [number, number] =>
  side === "nord" ? [0, 1] : side === "sud" ? [0, -1] : side === "ouest" ? [1, 0] : [-1, 0];

/**
 * Garantit une case de route sur le bord `side`, reliée aux `seeds` en distance-rue.
 * Peint le couloir le plus court si aucun débouché n'existe. Rend `null` si le bord est
 * inatteignable — bord entièrement hors forme, ou couloir barré par du bâti.
 */
export function ensureExit(o: Occ, side: ExitSide, seeds: number[]): ExitPoint | null {
  const dist = roadDistances(o, seeds);
  const cells = borderCells(o, side);

  // 1. un débouché existe déjà : le plus proche des graines, à égalité le premier de l'ordre
  let best: { x: number; y: number; d: number } | null = null;
  for (const c of cells) {
    const i = c.y * o.w + c.x;
    if (o.cell[i] !== ROAD || dist[i] < 0) continue;
    if (!best || dist[i] < best.d) best = { x: c.x, y: c.y, d: dist[i] };
  }
  if (best) return { x: best.x, y: best.y, side };

  // 2. creuser : le couloir libre le plus court jusqu'à une route reliée
  const [dx, dy] = inward(side);
  let bestRun: { x: number; y: number; run: { x: number; y: number }[] } | null = null;
  for (const c of cells) {
    const run: { x: number; y: number }[] = [];
    let x = c.x;
    let y = c.y;
    let touche = false;
    while (x >= 0 && y >= 0 && x < o.w && y < o.h) {
      const i = y * o.w + x;
      if (o.cell[i] === ROAD) {
        touche = dist[i] >= 0;
        break;
      }
      if (o.cell[i] !== FREE) break; // bâti, champ, réservé ou hors forme : couloir barré
      run.push({ x, y });
      x += dx;
      y += dy;
    }
    if (!touche || !run.length) continue;
    if (!bestRun || run.length < bestRun.run.length) bestRun = { x: c.x, y: c.y, run };
  }
  if (!bestRun) return null;

  for (const r of bestRun.run) setAt(o, r.x, r.y, ROAD);
  return { x: bestRun.x, y: bestRun.y, side };
}
