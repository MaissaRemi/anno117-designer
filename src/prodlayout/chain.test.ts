import { describe, expect, it } from "vitest";
import { eco, isProducer, pickProducer } from "./chain";

describe("isProducer — le piège des phases de monument", () => {
  it("rejette une entrée de buildingProd qui n'a que des intrants", () => {
    // « Amphithéâtre : arène » consomme cinq biens et ne rend rien. Il ouvre la liste
    // alphabétique romaine, donc c'était la cible par défaut de l'interface.
    expect(eco.buildingProd["g36912"].outputs).toEqual([]);
    expect(isProducer("g36912")).toBe(false);
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
