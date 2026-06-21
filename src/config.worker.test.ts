import { describe, expect, it } from "vitest";
import config from "../vite.config";

// Contrat PORTEUR : le worker du plan d'île (runIslandPlan → islandPlanWorker) fait un
// import() dynamique des heightmaps (terrain.ts). Si worker.format repasse en 'iife',
// ça casse au RUNTIME navigateur sans erreur de compilation → ce test est le garde-fou.
describe("vite config — contrat worker", () => {
  it("worker.format === 'es'", () => {
    expect((config as { worker?: { format?: string } }).worker?.format).toBe("es");
  });
});
