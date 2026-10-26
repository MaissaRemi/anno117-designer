import type { GridShape, PlacedBuilding, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { footprintSize } from "../engine/geometry";

/**
 * ═══ ÉLAGAGE DES CULS-DE-SAC ═════════════════════════════════════════════════════════
 *
 * Mesuré le 2026-10-26 sur trois plans livrés : 10 à 14 % des cases de route ne touchent
 * AUCUN bâtiment. Une partie relie des morceaux du réseau et doit rester ; l'autre est faite
 * de culs-de-sac — bouts de peigne qui ne mènent nulle part, restes d'un tracé dont les
 * maisons ont disparu.
 *
 * Une case qui ne touche aucun bâtiment et n'a qu'un voisin route ou aucun ne peut se trouver
 * À L'INTÉRIEUR d'aucun chemin : la retirer ne coupe rien, n'allonge aucune distance-rue, et
 * ne change la couverture d'aucun service. On l'enlève, puis on recommence sur ses voisines,
 * jusqu'à ce qu'il n'en reste plus. Le résultat ne dépend pas de l'ordre de retrait.
 *
 * Grille TUILE, adjacence ORTHOGONALE — celle de `rootedRoadSet` à l'échelle 1. Fonction pure.
 */
export function pruneDeadEnds(
  grid: GridShape,
  buildings: readonly PlacedBuilding[],
  roads: readonly RoadTile[],
  lookup: DefLookup,
): { roads: RoadTile[]; removed: number } {
  const W = grid.w, H = grid.h, N = W * H;
  const occ = new Uint8Array(N);
  for (const b of buildings) {
    const d = lookup(b.defId);
    if (!d) continue;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1;
    }
  }
  const roadAt = new Uint8Array(N);
  for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;

  const voisins = (c: number): number[] => {
    const x = c % W, out: number[] = [];
    if (x > 0) out.push(c - 1);
    if (x < W - 1) out.push(c + 1);
    if (c >= W) out.push(c - W);
    if (c < N - W) out.push(c + W);
    return out;
  };
  const toucheBatiment = (c: number) => voisins(c).some((n) => occ[n] === 1);
  const degre = (c: number) => voisins(c).reduce((s, n) => s + roadAt[n], 0);
  const elagable = (c: number) => roadAt[c] === 1 && !toucheBatiment(c) && degre(c) <= 1;

  const file: number[] = [];
  for (let c = 0; c < N; c++) if (elagable(c)) file.push(c);
  let removed = 0;
  while (file.length) {
    const c = file.pop()!;
    if (!elagable(c)) continue; // déjà retirée, ou devenue nécessaire entre-temps
    roadAt[c] = 0;
    removed++;
    for (const n of voisins(c)) if (elagable(n)) file.push(n);
  }

  if (!removed) return { roads: [...roads], removed: 0 };
  // ordre et doublons du tracé d'entrée conservés, moins les cases retirées
  return { roads: roads.filter((r) => roadAt[r.y * W + r.x] === 1), removed };
}
