import { anneal } from "./anneal";
import type { OptimizeRequest, OptimizeResult, WorkerMessage } from "./types";

self.onmessage = (e: MessageEvent<OptimizeRequest>) => {
  const req = e.data;
  const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

  const { out, scored } = anneal(req, (iter, best, placed, requested) =>
    post({ type: "progress", iter, best, placed, requested }),
  );

  const result: OptimizeResult = {
    buildings: out.buildings,
    roads: out.roads,
    fields: out.fields,
    placed: scored.placed,
    requested: req.items.reduce((s, it) => s + it.qty, 0),
    placedByDef: out.placedByDef,
    score: scored.score,
    breakdown: scored.breakdown,
  };
  post({ type: "done", result });
};

export {};
