import { describe, expect, it } from "vitest";
import { chainFertilities, economy } from "./economy";
import { canProduce, emptyProfile, missingFertilities, producibleGoods } from "./resources";

// choisit dynamiquement un bien dont la chaîne EXIGE une fertilité (données réelles)
const gatedGood = Object.keys(economy.producers).find((g) => chainFertilities(g).size > 0)!;
const gatedFert = [...chainFertilities(gatedGood)][0];
// et un bien SANS fertilité requise
const freeGood = Object.keys(economy.producers).find((g) => chainFertilities(g).size === 0)!;

describe("resources — producibilité", () => {
  it("emptyProfile = aucune fertilité, 0 slot", () => {
    expect(emptyProfile()).toEqual({ fertilities: [], mountainSlots: 0 });
  });
  it("bien à fertilité : refusé si absente, accepté si présente", () => {
    expect(canProduce(gatedGood, emptyProfile())).toBe(false);
    expect(missingFertilities(gatedGood, emptyProfile())).toContain(gatedFert);
    const p = { fertilities: [...chainFertilities(gatedGood)], mountainSlots: 0 };
    expect(canProduce(gatedGood, p)).toBe(true);
    expect(missingFertilities(gatedGood, p)).toEqual([]);
  });
  it("bien sans fertilité : produisible même profil vide", () => {
    expect(canProduce(freeGood, emptyProfile())).toBe(true);
  });
  it("producibleGoods : profil vide exclut les biens à fertilité ; profil complet ⊇ profil vide", () => {
    const empty = producibleGoods(emptyProfile());
    expect(empty.has(freeGood)).toBe(true);
    expect(empty.has(gatedGood)).toBe(false);
    const full = producibleGoods({ fertilities: Object.keys(economy.fertilities), mountainSlots: 0 });
    expect(full.has(gatedGood)).toBe(true);
    expect(full.size).toBeGreaterThanOrEqual(empty.size);
  });
});
