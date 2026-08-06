import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { planIslandImport } from "./islandPlan";
import { planLattice } from "./planLattice";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
// tier le plus riche (Patriciens, services à eau : Bains/Forum/Colisée/Citerne)
const t4 = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) =>
  new Set(b.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).map((s) => s.building)).size -
  new Set(a.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).map((s) => s.building)).size)[0]!;

const COLOSSEUM = "g3621";

describe("contraintes de fidélité (unique + eau)", () => {
  it("BuildingUnique : le Colisée n'est jamais posé plus d'une fois", () => {
    const grid = makeGrid(160, 160); // grand → la densification serait tentée
    const r = planLattice(grid, t4.guid, lookup, { coverageFloor: 0.8 });
    expect((r.servicesPlaced[COLOSSEUM] ?? 0)).toBeLessThanOrEqual(1);
  });

  it("île SANS slot montagne en T4 : services à eau morts → tier-cible inatteignable, maisons DÉMOTÉES", () => {
    const grid = makeGrid(120, 120); // aucun slot → aucune source d'aqueduc possible
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, needMode: "all" });
    expect(r.fullyCovered).toBe(0); // aucune maison au tier-cible (Bains/Forum/Colisée sans eau)
    // eau morte : les maisons retombent aux PALIERS INFÉRIEURS (sans besoin d'eau), pas 0
    expect(r.residents).toBeGreaterThan(0);
    expect(r.tierCounts[t4.guid] ?? 0).toBe(0); // rien au palier cible
    expect(r.feasible).toBe(false); // fraction au tier-cible < seuil
    expect(r.gaps.some((g) => /eau/i.test(g))).toBe(true);
  });

  it("île AVEC assez de slots montagne en T4 : l'eau passe → des maisons au tier", () => {
    const grid = makeGrid(200, 200);
    // T4 = Colisée 50 + Bains 25 + Forum 15 + citernes 10 > 100u/source → plusieurs sources
    grid.slots = [
      { type: "mountain", x: 40, y: 40 }, { type: "mountain", x: 160, y: 40 },
      { type: "mountain", x: 40, y: 160 }, { type: "mountain", x: 160, y: 160 },
      { type: "mountain", x: 100, y: 100 },
    ];
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, needMode: "all" });
    expect(r.fullyCovered).toBeGreaterThan(0);
  });
});
