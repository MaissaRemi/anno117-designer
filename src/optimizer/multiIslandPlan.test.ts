import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { chainFertilities, economy, worldOf } from "../economy/economy";
import { multiIslandPlan } from "./multiIslandPlan";
import { regionOfIsland } from "../data/islands";
import { emptyProfile } from "../economy/resources";

const catalog = rawCatalog as unknown as BuildingDef[];
const tier = economy.tiers.filter((t) => t.residenceId).slice(-1)[0].guid;
const grid = () => makeGrid(60, 60); // grille tuile pleine (multiIslandPlan reçoit des grilles quelconques)

describe("multiIslandPlan", () => {
  it("chaque île reçoit un palier de SON monde", () => {
    // Régression : la requête ne porte qu'un `tierGuid`, pour toutes les îles à la fois, et il
    // était appliqué tel quel. Mêler une île du Latium et une île d'Albion produisait donc une
    // ville ROMAINE sur Albion — résidences et services non constructibles en jeu, et une
    // main-d'œuvre que l'autre monde ne peut pas fournir.
    const roman = [...economy.tiers].filter((t) => t.residenceId && worldOf(t.region) === "Roman")
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    const r = multiIslandPlan({
      catalog,
      tierGuid: roman.guid,
      mode: "dimension",
      islands: [
        { islandId: "roman_island_small_01", grid: grid(), profile: emptyProfile() },
        { islandId: "celtic_island_small_01", grid: grid(), profile: emptyProfile() },
      ],
    });
    for (const a of r.assignments) {
      const plan = a.plan;
      if (a.role !== "population" || !plan || plan.mode !== "import") continue;
      const t = economy.tiers.find((x) => x.guid === plan.tierGuid)!;
      expect(worldOf(t.region)).toBe(worldOf(regionOfIsland(a.islandId)));
    }
  }, 120_000);

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
