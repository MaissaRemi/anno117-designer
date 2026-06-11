import { planIslandImport, type IslandPlanRequest, type IslandPlanResult } from "./islandPlan";

export type IslandPlanMsg =
  | { type: "progress"; step: number; total: number }
  | { type: "done"; result: IslandPlanResult }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<IslandPlanRequest>) => {
  const post = (m: IslandPlanMsg) => (self as unknown as Worker).postMessage(m);
  try {
    const result = planIslandImport(e.data, (step, total) => post({ type: "progress", step, total }));
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
