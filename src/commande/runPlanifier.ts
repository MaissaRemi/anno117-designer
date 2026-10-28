import type { CommandeMsg, CommandeRequete } from "./planifierWorker";
import type { ResultatCommande } from "./planifier";

/** Lance la planification d'une commande dans un Web Worker (interface non bloquée). */
export function runPlanifier(req: CommandeRequete): { promise: Promise<ResultatCommande>; cancel: () => void } {
  const worker = new Worker(new URL("./planifierWorker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<ResultatCommande>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<CommandeMsg>) => {
      if (e.data.type === "error") reject(new Error(e.data.message));
      else resolve(e.data.result);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || "Erreur de planification"));
      worker.terminate();
    };
    worker.postMessage(req);
  });
  return { promise, cancel: () => worker.terminate() };
}
