import { heightsOf } from "../data/terrain";
import { makeLookup } from "../engine/rules";
import { planIslandImport, type IslandPlanRequest, type IslandPlanResult } from "./islandPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";

export type IslandPlanMsg =
  | { type: "progress"; step: number; total: number }
  | { type: "done"; result: IslandPlanResult | ProdPlanResult }
  | { type: "error"; message: string };

self.onmessage = async (e: MessageEvent<IslandPlanRequest>) => {
  const post = (m: IslandPlanMsg) => (self as unknown as Worker).postMessage(m);
  const progress = (step: number, total: number) => post({ type: "progress", step, total });
  try {
    const req = e.data;
    if (req.mode === "production") {
      if (!req.productionGood || !req.productionRate) throw new Error("Bien et débit cibles requis.");
      const result = planIslandProduction(
        req.catalog, req.grid, makeLookup(req.catalog),
        req.productionGood, req.productionRate, {}, progress,
      );
      post({ type: "done", result });
      return;
    }
    // hauteurs de l'île (pente des aqueducs) — décodées ici, hors thread UI
    const heights = req.grid.islandId ? await heightsOf(req.grid.islandId) : null;
    const result = planIslandImport({ ...req, heights: heights ?? undefined }, progress);
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
