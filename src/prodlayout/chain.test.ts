import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildChain, eco, isProducer, pickProducer } from "./chain";
import { frac } from "./frac";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("buildChain — le pain romain", () => {
  it("rend 1 boulangerie : 1/2 moulin : 1 ferme", () => {
    const c = buildChain("g3174", 1, lookup);
    expect(c.nodes.map((n) => n.defId)).toEqual(["g3174", "g3075", "g2693"]);
    expect(c.nodes[0].exact).toEqual(frac(1));
    expect(c.nodes[1].exact).toEqual(frac(1, 2));
    expect(c.nodes[2].exact).toEqual(frac(1, 1));
    expect(c.imports).toEqual([]);
    expect(c.gaps).toEqual([]);
  });

  it("met la chaîne à l'échelle linéairement", () => {
    const c = buildChain("g3174", 4, lookup);
    expect(c.nodes[1].exact).toEqual(frac(2));
    expect(c.nodes[2].exact).toEqual(frac(4));
  });

  it("une boulangerie romaine ne tire pas la ferme celtique", () => {
    const ids = buildChain("g3174", 1, lookup).nodes.map((n) => n.defId);
    expect(ids).not.toContain("g5972"); // ferme de céréales celtique
    expect(ids).not.toContain("g5967"); // moulin à âne celtique
  });

  it("un intrant marqué importé sort des comptes et entre au manifeste", () => {
    const c = buildChain("g3174", 1, lookup, new Set(["2119"])); // Farine importée
    expect(c.nodes.map((n) => n.defId)).toEqual(["g3174"]);
    expect(c.imports).toEqual([{ good: "2119", ratePerMin: 1, reason: "demandé" }]);
  });

  it("signale les producteurs qui exigent un emplacement de terrain", () => {
    const mine = catalog.find((d) => d.slotType === "mountain" && d.production);
    expect(mine).toBeDefined();
    const c = buildChain(mine!.id, 1, lookup);
    expect(c.blocked.map((b) => b.defId)).toContain(mine!.id);
    expect(c.gaps.join(" ")).toMatch(/emplacement/);
  });
});

describe("isProducer — le piège des phases de monument", () => {
  it("rejette une entrée de buildingProd qui n'a que des intrants", () => {
    // « Amphithéâtre : arène » consomme cinq biens et ne rend rien. Il ouvre la liste
    // alphabétique romaine, donc c'était la cible par défaut de l'interface.
    expect(eco.buildingProd["g36912"].outputs).toEqual([]);
    expect(isProducer("g36912")).toBe(false);
    expect(() => buildChain("g36912", 1, lookup)).toThrow(/ne produit rien/);
  });

  it("accepte un vrai producteur et refuse un bâtiment absent du graphe", () => {
    expect(isProducer("g3174")).toBe(true);
    expect(isProducer("g3310")).toBe(false); // l'entrepôt ne produit pas
  });
});

describe("pickProducer", () => {
  it("préfère la région demandée", () => {
    expect(pickProducer("2069", "Roman")).toBe("g2693");
    expect(pickProducer("2069", "Celtic")).toBe("g5972");
  });

  it("rend undefined pour un bien sans producteur", () => {
    expect(pickProducer("bien-inexistant")).toBeUndefined();
  });
});
