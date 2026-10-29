import type { GridShape } from "../model/types";
import { decodeMask, islandById, upscale2x } from "./islands";
import { riversOf, slotsOf, zonesOf } from "./terrain";

/** Construit la grille VIVANTE ½-tuile (cellsPerTile=2) d'une île à partir de son id.
 *  Pur, réutilisable (éditeur mono-île ET mode multi-îles). undefined si île inconnue. */
export function buildIslandGrid(id: string): GridShape | undefined {
  const isl = islandById(id);
  if (!isl) return undefined;
  const tw = isl.size.w, th = isl.size.h;
  // Zones du JEU (cf. terrain.zonesOf) : terre constructible, eau côtière constructible,
  // relief. À défaut, le masque de l'image — qui ne connaît ni le relief ni l'eau constructible.
  const zones = zonesOf(id, tw, th);
  const usableT = zones ? zones.terre.slice() : decodeMask(isl.mask, tw, th);
  const riversT = riversOf(id, tw, th);
  if (riversT) for (let i = 0; i < riversT.length; i++) if (riversT[i]) usableT[i] = false; // rivière non constructible
  const usable = upscale2x(usableT, tw, th);
  // eau : seulement la bande côtière où l'on bâtit (ports, pêcheurs, salines), pas toute la mer
  const water = zones ? upscale2x(zones.eau, tw, th) : usable.map((land) => !land);
  const relief = zones ? upscale2x(zones.relief, tw, th) : undefined;
  const rivers = riversT ? upscale2x(riversT, tw, th) : undefined;
  const slots = slotsOf(id).map((s) => ({ type: s.type, x: Math.round(s.x) * 2, y: Math.round(s.y) * 2 }));
  return {
    w: tw * 2, h: th * 2, usable, water, relief, rivers,
    slots: slots.length ? slots : undefined, islandId: id, cellsPerTile: 2,
  };
}
