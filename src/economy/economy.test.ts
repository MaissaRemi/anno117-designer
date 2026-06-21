import { describe, expect, it } from "vitest";
import {
  chainFertilities,
  economy,
  goodName,
  pickProducer,
  priceOf,
  tierByGuid,
  upkeepOf,
} from "./economy";

describe("economy — helpers purs", () => {
  it("accessors : fallbacks corrects pour entrées inconnues", () => {
    expect(upkeepOf("g_inexistant")).toBe(0);
    expect(tierByGuid("g_inexistant")).toBeUndefined();
    expect(goodName(null)).toBe("?");
    expect(priceOf(null)).toBe(0);
    expect(priceOf("g_inexistant")).toBe(0);
  });

  it("chainFertilities : Set qui termine ; ≥1 bien exige une fertilité", () => {
    // au moins un bien produisible a une fertilité dans sa chaîne (NeededFertility extrait)
    const withFert = Object.keys(economy.producers).find((g) => chainFertilities(g).size > 0);
    expect(withFert).toBeDefined();
    const set = chainFertilities(withFert!);
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBeGreaterThan(0);
    for (const f of set) expect(economy.fertilities[f]).toBeDefined(); // GUID → nom FR connu
    // un bien sans producteur (matière brute) → chaîne vide, pas d'erreur
    expect(chainFertilities("g_matiere_brute_inexistante")).toEqual(new Set());
  });

  it("pickProducer : producteur de la liste, undefined si bien inconnu", () => {
    const good = Object.keys(economy.producers).find((g) => economy.producers[g].length > 0)!;
    expect(economy.producers[good]).toContain(pickProducer(good, "Roman"));
    expect(economy.producers[good]).toContain(pickProducer(good)); // sans région
    expect(pickProducer("g_inexistant")).toBeUndefined();
  });
});
