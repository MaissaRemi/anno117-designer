import type { GridShape } from "../model/types";
import { decodeMask, islandById, upscale2x } from "./islands";
import { pentesOf, riversOf, slotsOf } from "./terrain";

/** Construit la grille VIVANTE ½-tuile (cellsPerTile=2) d'une île à partir de son id.
 *  Pur, réutilisable (éditeur mono-île ET mode multi-îles). undefined si île inconnue. */
export function buildIslandGrid(id: string): GridShape | undefined {
  const isl = islandById(id);
  if (!isl) return undefined;
  const tw = isl.size.w, th = isl.size.h;
  const usableT = decodeMask(isl.mask, tw, th);
  const riversT = riversOf(id, tw, th);
  if (riversT) for (let i = 0; i < riversT.length; i++) if (riversT[i]) usableT[i] = false; // rivière non constructible
  // pentes : montagnes et falaises, terre pour l'image mais pas pour le jeu
  const pentesT = pentesOf(id, tw, th);
  if (pentesT) for (let i = 0; i < pentesT.length; i++) if (pentesT[i]) usableT[i] = false;
  const usable = upscale2x(usableT, tw, th);
  // mer = ni terre ni pente : une montagne n'est pas constructible, mais ce n'est pas de l'eau
  const penteH = pentesT ? upscale2x(pentesT, tw, th) : undefined;
  const water = usable.map((land, i) => !land && !penteH?.[i]);
  const rivers = riversT ? upscale2x(riversT, tw, th) : undefined;
  const slots = slotsOf(id).map((s) => ({ type: s.type, x: Math.round(s.x) * 2, y: Math.round(s.y) * 2 }));
  return {
    w: tw * 2, h: th * 2, usable, water, rivers,
    slots: slots.length ? slots : undefined, islandId: id, cellsPerTile: 2,
  };
}
