import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildChain } from "./chain";
import { buildOrder } from "./lot";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("buildOrder — arrondis et lot parfait", () => {
  it("arrondit au supérieur et chiffre la sous-utilisation", () => {
    const o = buildOrder(buildChain("g3174", 1, lookup));
    const mill = o.items.find((i) => i.defId === "g3075")!;
    expect(mill.placed).toBe(1);
    expect(mill.utilisation).toBe(0.5);
  });

  it("le lot parfait du pain vaut 2", () => {
    expect(buildOrder(buildChain("g3174", 1, lookup)).perfectMultiplier).toBe(2);
  });

  it("un lot déjà parfait rend un multiplicateur de 1 et aucun gaspillage", () => {
    const o = buildOrder(buildChain("g3174", 2, lookup));
    expect(o.perfectMultiplier).toBe(1);
    for (const i of o.items) expect(i.utilisation).toBe(1);
  });

  it("le total de copies posées est celui de la commande", () => {
    const o = buildOrder(buildChain("g3174", 2, lookup));
    expect(o.items.map((i) => [i.defId, i.placed])).toEqual([
      ["g3174", 2], ["g3075", 1], ["g2693", 2],
    ]);
  });
});
