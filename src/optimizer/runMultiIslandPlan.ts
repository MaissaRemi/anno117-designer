import type { MultiIslandRequest, MultiIslandResult } from "./multiIslandPlan";
import type { MultiMsg } from "./multiIslandPlanWorker";

/** Lance le méta-optimiseur multi-îles dans un Web Worker (UI non bloquée). */
export function runMultiIslandPlan(
  req: MultiIslandRequest,
): { promise: Promise<MultiIslandResult>; cancel: () => void } {
  const worker = new Worker(new URL("./multiIslandPlanWorker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<MultiIslandResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<MultiMsg>) => {
      const m = e.data;
      if (m.type === "error") reject(new Error(m.message));
      else resolve(m.result);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || "Erreur du planificateur multi-îles"));
      worker.terminate();
    };
    worker.postMessage(req);
  });
  return { promise, cancel: () => worker.terminate() };
}
