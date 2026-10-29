import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const PATRICIENS = "1498";

describe("objectif du plan d'île", () => {
  // Mesuré sur roman_island_medium_01, routes pavées : 1 203 maisons et 38 301 habitants en
  // « habitants », 1 606 maisons et 27 722 habitants en « maisons ».
  it("« maisons » pose plus de maisons, « habitants » loge plus de monde", () => {
    const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
    const req = { catalog, grid, tierGuid: PATRICIENS, coverageFloor: 0.8, needMode: "auto", roadType: "pavee" } as const;
    const hab = planIslandImport({ ...req, objectif: "habitants" });
    const mai = planIslandImport({ ...req, objectif: "maisons" });
    expect(mai.houses).toBeGreaterThan(hab.houses);
    expect(hab.residents).toBeGreaterThan(mai.residents);
  }, 120_000);
});
