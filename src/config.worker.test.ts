import { describe, expect, it } from "vitest";
import config from "../vite.config";

// Contrat PORTEUR : le worker du plan d'île (runIslandPlan → islandPlanWorker) fait un
// import() dynamique des heightmaps (terrain.ts). Si worker.format repasse en 'iife',
// ça casse au RUNTIME navigateur sans erreur de compilation → ce test est le garde-fou.
//
// `vite.config.ts` exporte une FONCTION depuis qu'elle lit le `mode` (tests rapides vs
// balayages du moteur). On la résout ici plutôt que d'affaiblir l'assertion : c'est ce
// test qui a signalé le changement de forme, il doit continuer à voir la config réelle.
const resolve = (m: string) => (typeof config === "function" ? config({ mode: m, command: "serve" }) : config);

describe("vite config — contrat worker", () => {
  it("worker.format === 'es'", () => {
    expect((resolve("test") as { worker?: { format?: string } }).worker?.format).toBe("es");
  });

  it("le mode « fast » écarte les balayages lourds, le mode normal les garde", () => {
    const excl = (m: string) => ((resolve(m) as { test?: { exclude?: string[] } }).test?.exclude ?? []);
    expect(excl("fast")).toContain("src/optimizer/invariants.test.ts");
    expect(excl("test")).not.toContain("src/optimizer/invariants.test.ts");
  });

  it("les worktrees d'agent sont écartés dans TOUS les modes", () => {
    for (const m of ["test", "fast"]) {
      expect((resolve(m) as { test?: { exclude?: string[] } }).test?.exclude).toContain(".claude/**");
    }
  });
});
