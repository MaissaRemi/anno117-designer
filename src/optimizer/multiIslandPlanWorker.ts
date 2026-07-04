import { multiIslandPlan, type MultiIslandRequest, type MultiIslandResult } from "./multiIslandPlan";

export type MultiMsg = { type: "done"; result: MultiIslandResult } | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<MultiIslandRequest>) => {
  const post = (m: MultiMsg) => (self as unknown as Worker).postMessage(m);
  try {
    post({ type: "done", result: multiIslandPlan(e.data) });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
