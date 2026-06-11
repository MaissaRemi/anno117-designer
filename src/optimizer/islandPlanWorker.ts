import { heightsOf } from "../data/terrain";
import { planIslandImport, type IslandPlanRequest, type IslandPlanResult } from "./islandPlan";

export type IslandPlanMsg =
  | { type: "progress"; step: number; total: number }
  | { type: "done"; result: IslandPlanResult }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<IslandPlanRequest>) => {
  const post = (m: IslandPlanMsg) => (self as unknown as Worker).postMessage(m);
  try {
    // hauteurs de l'île (pente des aqueducs) — décodées ici, hors thread UI
    const heights = e.data.grid.islandId ? await heightsOf(e.data.grid.islandId) : null;
    const result = planIslandImport(
      { ...e.data, heights: heights ?? undefined },
      (step, total) => post({ type: "progress", step, total }),
    );
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
