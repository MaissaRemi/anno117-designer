import { hasHeights, heightsOf } from "../data/terrain";
import { planIsland, type IslandPlanRequest, type IslandPlanResult } from "./islandPlan";
import type { ProdPlanResult } from "./prodPlan";
import { downscaleGrid, scaleResultToHalfTile } from "./halfTileAdapter";

export type IslandPlanMsg =
  | { type: "progress"; step: number; total: number }
  | { type: "done"; result: IslandPlanResult | ProdPlanResult }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<IslandPlanRequest>) => {
  const post = (m: IslandPlanMsg) => (self as unknown as Worker).postMessage(m);
  try {
    // hauteurs de l'île (pente des aqueducs) — décodées ici, hors thread UI (async)
    const id = e.data.grid.islandId;
    const wantHeights = !!(id && hasHeights(id));
    const heights = wantHeights ? await heightsOf(id!) : null;
    // ADAPTATEUR ½-tuile : la grille vivante est en ½-tuiles ; on résout en TUILES
    // (moteurs inchangés, routes 1 tuile = constructibles) puis on reprojette ×2.
    const halfTile = (e.data.grid.cellsPerTile ?? 1) === 2;
    const tileGrid = downscaleGrid(e.data.grid);
    const planned = planIsland(
      { ...e.data, grid: tileGrid, heights: heights ?? undefined },
      (step, total) => post({ type: "progress", step, total }),
    );
    const result = scaleResultToHalfTile(planned, halfTile);
    // hauteurs attendues mais non décodables (navigateur sans DecompressionStream) :
    // la pente d'aqueduc n'a pas pu être vérifiée → on le signale honnêtement.
    if (wantHeights && !heights && "gaps" in result && Array.isArray(result.gaps)) {
      result.gaps.push(
        "⚠ Hauteurs de terrain indisponibles dans ce navigateur — pente des aqueducs non vérifiée (réseau d'eau possiblement optimiste).",
      );
    }
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
