import type { GridShape, PlacedBuilding, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import {
  casesAuContact, degre, estRoute, idDeRoute, reseauDeRoutes, retirerLosange, routeDe, tailleReseau, voisins,
} from "../engine/reseauRoutier";

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
 * Grille TUILE, sur le réseau en graphe de `rootedRoadSet` à l'échelle 1 (`engine/reseauRoutier`) :
 * « toucher un bâtiment » et « voisin route » y comptent les contacts par un côté, et par un
 * coin entre une case droite et un losange. Fonction pure.
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
  const reseau = reseauDeRoutes(W, H, roads);

  const toucheBatiment = (c: number) => {
    let touche = false;
    casesAuContact(reseau, c, (n) => { if (occ[n] === 1) touche = true; });
    return touche;
  };
  const elagable = (c: number) => estRoute(reseau, c) && !toucheBatiment(c) && degre(reseau, c) <= 1;

  const file: number[] = [];
  for (let c = 0, T = tailleReseau(reseau); c < T; c++) if (elagable(c)) file.push(c);
  let removed = 0;
  while (file.length) {
    const c = file.pop()!;
    if (!elagable(c)) continue; // déjà retirée, ou devenue nécessaire entre-temps
    if (c < N) reseau.droite[c] = 0;
    else { const t = routeDe(reseau, c); retirerLosange(reseau, t.x, t.y); }
    removed++;
    voisins(reseau, c, (n) => { if (elagable(n)) file.push(n); });
  }

  if (!removed) return { roads: [...roads], removed: 0 };
  // ordre et doublons du tracé d'entrée conservés, moins les cases retirées
  return {
    roads: roads.filter((r) => { const id = idDeRoute(reseau, r); return id < 0 || estRoute(reseau, id); }),
    removed,
  };
}
