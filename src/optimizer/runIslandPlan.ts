import type { IslandPlanRequest, IslandPlanResult } from "./islandPlan";
import type { ProdPlanResult } from "./prodPlan";
import type { IslandPlanMsg } from "./islandPlanWorker";

export type AnyIslandPlanResult = IslandPlanResult | ProdPlanResult;

/** Lance le planificateur d'île dans un Web Worker (UI non bloquée). */
export function runIslandPlan(
  req: IslandPlanRequest,
  onProgress?: (step: number, total: number) => void,
): { promise: Promise<AnyIslandPlanResult>; cancel: () => void } {
  const worker = new Worker(new URL("./islandPlanWorker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<AnyIslandPlanResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<IslandPlanMsg>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m.step, m.total);
      else if (m.type === "error") {
        reject(new Error(m.message));
        worker.terminate();
      } else {
        resolve(m.result);
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || "Erreur du planificateur d'île"));
      worker.terminate();
    };
    worker.postMessage(req);
  });
  return { promise, cancel: () => worker.terminate() };
}
