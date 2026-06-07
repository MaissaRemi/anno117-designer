import type { OptimizeRequest, OptimizeResult, Progress, WorkerMessage } from "./types";

/** Lance l'optimiseur dans un Web Worker, renvoie le résultat (UI non bloquée). */
export function runOptimizer(
  req: OptimizeRequest,
  onProgress?: (p: Progress) => void,
): { promise: Promise<OptimizeResult>; cancel: () => void } {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<OptimizeResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m);
      else {
        resolve(m.result);
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || "Erreur de l'optimiseur"));
      worker.terminate();
    };
    worker.postMessage(req);
  });
  return { promise, cancel: () => worker.terminate() };
}
