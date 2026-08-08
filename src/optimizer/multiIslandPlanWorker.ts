import { hasHeights, heightsOf } from "../data/terrain";
import { downscaleGrid } from "./halfTileAdapter";
import { multiIslandPlan, type MultiIslandRequest, type MultiIslandResult } from "./multiIslandPlan";

export type MultiMsg = { type: "done"; result: MultiIslandResult } | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<MultiIslandRequest>) => {
  const post = (m: MultiMsg) => (self as unknown as Worker).postMessage(m);
  try {
    // HAUTEURS DE TERRAIN, décodées ici comme dans le worker mono-île : sans elles, la pente
    // des aqueducs n'est pas vérifiée et le réseau d'eau de chaque île est optimiste. Le
    // planificateur multi-îles les ignorait purement et simplement.
    const islands = await Promise.all(e.data.islands.map(async (isl) => {
      if (isl.heights || !hasHeights(isl.islandId)) return isl;
      const h = await heightsOf(isl.islandId);
      // Les moteurs travaillent en TUILES : les hauteurs ne valent que si leurs dimensions
      // correspondent à la grille descendue, sinon l'indexation glisse (cf. worker mono-île).
      const tile = downscaleGrid(isl.grid);
      return h && h.length === tile.w * tile.h ? { ...isl, heights: h } : isl;
    }));
    post({ type: "done", result: multiIslandPlan({ ...e.data, islands }) });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
