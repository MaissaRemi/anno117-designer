import { describe, expect, it } from "vitest";

/**
 * Le module est indépendant PAR CONSTRUCTION, pas par bonne volonté. Ce test est la seule
 * chose qui empêche un import « juste pour cette fois » vers le moteur d'île, qui ferait
 * rentrer par la fenêtre la cascade services/couverture que ce module existe pour tenir
 * à part.
 *
 * Les sources sont lues par `import.meta.glob` plutôt que par `node:fs` : le projet n'a
 * pas `@types/node`, et l'ajouter pour un seul test exposerait les globales Node à tout le
 * code navigateur.
 */
const SOURCES = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const INTERDIT = /from\s+["']\.\.\/(optimizer|economy)\//;

describe("frontière du module prodlayout", () => {
  it("lit bien ses propres sources", () => {
    // sans cette garde, les deux tests suivants passeraient sur un ensemble vide
    expect(Object.keys(SOURCES).length).toBeGreaterThan(8);
  });

  it("n'importe ni src/optimizer/ ni src/economy/", () => {
    const fautifs = Object.entries(SOURCES)
      .filter(([, src]) => INTERDIT.test(src))
      .map(([f]) => f);
    expect(fautifs).toEqual([]);
  });

  it("n'utilise ni horloge ni aléa — le déterminisme est structurel", () => {
    const fautifs = Object.entries(SOURCES)
      .filter(([f]) => !f.endsWith(".test.ts"))
      .filter(([, src]) => /Math\.random|Date\.now|new Date\(/.test(src))
      .map(([f]) => f);
    expect(fautifs).toEqual([]);
  });
});
