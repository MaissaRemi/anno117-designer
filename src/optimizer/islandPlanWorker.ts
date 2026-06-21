import { hasHeights, heightsOf } from "../data/terrain";
import { planIsland, type IslandPlanRequest, type IslandPlanResult } from "./islandPlan";
import type { ProdPlanResult } from "./prodPlan";

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
    const result = planIsland(
      { ...e.data, heights: heights ?? undefined },
      (step, total) => post({ type: "progress", step, total }),
    );
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
