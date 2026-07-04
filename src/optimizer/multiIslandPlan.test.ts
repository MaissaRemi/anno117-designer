import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { chainFertilities, economy } from "../economy/economy";
import { multiIslandPlan } from "./multiIslandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const tier = economy.tiers.filter((t) => t.residenceId).slice(-1)[0].guid;
const grid = () => makeGrid(60, 60); // grille tuile pleine (multiIslandPlan reçoit des grilles quelconques)

describe("multiIslandPlan", () => {
  it("assigne des rôles, respecte les épinglages, renvoie une population totale", () => {
    const r = multiIslandPlan({
      catalog, tierGuid: tier, mode: "dimension",
      islands: [
        { islandId: "roman_a", grid: grid(), profile: { fertilities: [], mountainSlots: 0 } },
        { islandId: "roman_b", grid: grid(), profile: { fertilities: Object.keys(economy.fertilities), mountainSlots: 5 }, pinnedRole: "production" },
      ],
    });
    expect(r.assignments.length).toBe(2);
    expect(r.assignments.find((a) => a.islandId === "roman_b")!.role).toBe("production");
    expect(r.totalPopulation).toBeGreaterThanOrEqual(0);
  });

  it("contrainte ressource : un bien à fertilité n'est jamais assigné à une île sans cette fertilité", () => {
    const r = multiIslandPlan({
      catalog, tierGuid: tier, mode: "dimension",
      islands: [
        { islandId: "pop", grid: grid(), profile: { fertilities: [], mountainSlots: 0 }, pinnedRole: "population" },
        { islandId: "poor", grid: grid(), profile: { fertilities: [], mountainSlots: 0 } }, // aucune fertilité
      ],
    });
    const poor = r.assignments.find((a) => a.islandId === "poor")!;
    for (const g of poor.producedGoods ?? []) expect(chainFertilities(g).size).toBe(0);
  });

  it("île épinglée unused → rôle unused, aucune production", () => {
    const r = multiIslandPlan({
      catalog, tierGuid: tier, mode: "dimension",
      islands: [
        { islandId: "pop", grid: grid(), profile: { fertilities: Object.keys(economy.fertilities), mountainSlots: 0 } },
        { islandId: "off", grid: grid(), profile: { fertilities: Object.keys(economy.fertilities), mountainSlots: 0 }, pinnedRole: "unused" },
      ],
    });
    const off = r.assignments.find((a) => a.islandId === "off")!;
    expect(off.role).toBe("unused");
    expect(off.producedGoods).toBeUndefined();
  });
});
