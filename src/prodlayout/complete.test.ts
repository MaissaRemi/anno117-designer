import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { balanceBasket, normalizeBasket } from "./basket";
import { completeBasket } from "./complete";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("completeBasket", () => {
  it("une boulangerie seule fait remonter le moulin ET la ferme", () => {
    const done = completeBasket(normalizeBasket([{ defId: "g3174", count: 1 }]), lookup);
    const ids = done.lines.map((l) => l.defId);
    expect(ids).toContain("g3075");
    expect(ids).toContain("g2693");
    expect(balanceBasket(done, lookup).deficits).toEqual([]);
  });

  it("le point fixe est idempotent", () => {
    const once = completeBasket(normalizeBasket([{ defId: "g3174", count: 1 }]), lookup);
    expect(completeBasket(once, lookup)).toEqual(once);
  });

  it("un panier déjà complet n'est pas touché", () => {
    const parfait = normalizeBasket([
      { defId: "g3174", count: 3 },
      { defId: "g3075", count: 1 },
      { defId: "g2693", count: 3 },
    ]);
    expect(completeBasket(parfait, lookup)).toEqual(parfait);
  });

  it("un bien déclaré importé n'appelle aucun producteur", () => {
    const done = completeBasket(
      normalizeBasket([{ defId: "g3174", count: 1 }]),
      lookup,
      new Set(["2119"]),
    );
    expect(done.lines.map((l) => l.defId)).toEqual(["g3174"]);
  });

  it("un panier vide reste vide", () => {
    expect(completeBasket(normalizeBasket([]), lookup).lines).toEqual([]);
  });
});
