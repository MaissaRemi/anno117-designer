import { heightsOf } from "../data/terrain";
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
    const heights = e.data.grid.islandId ? await heightsOf(e.data.grid.islandId) : null;
    const result = planIsland(
      { ...e.data, heights: heights ?? undefined },
      (step, total) => post({ type: "progress", step, total }),
    );
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
