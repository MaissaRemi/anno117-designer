import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const PATRICIENS = "1498";

describe("objectif du plan d'île", () => {
  // « maisons » compte les maisons AU PALIER CIBLE, pas toutes les maisons : compter tout
  // faisait retomber le tiers de l'île en Liberti. Sur roman_island_small_06, surtout rocheuse
  // depuis que la montagne n'est plus constructible, les deux objectifs retiennent le même plan
  // (208 Patriciens) : on verrouille donc le sens, jamais moins au palier cible.
  it("« maisons » ne loge jamais moins de maisons au palier cible que « habitants »", () => {
    const grid = downscaleGrid(buildIslandGrid("roman_island_small_06")!);
    const req = { catalog, grid, tierGuid: PATRICIENS, coverageFloor: 0.8, needMode: "auto", roadType: "pavee" } as const;
    const hab = planIslandImport({ ...req, objectif: "habitants" });
    const mai = planIslandImport({ ...req, objectif: "maisons" });
    expect(mai.fullyCovered).toBeGreaterThanOrEqual(hab.fullyCovered);
  }, 120_000);
});
