import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup } from "../engine/rules";
import { hasHeights, heightsOf } from "../data/terrain";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import type { Commande } from "./nomenclature";
import { planifierMaximum, tenue } from "./maximum";

/**
 * PRODUIRE LE MAXIMUM (exigence E6) : les débits sont des proportions, l'île est remplie. Les
 * hauteurs sont passées, comme dans l'application. Les planchers sont un CLIQUET : valeurs
 * mesurées le 12/11/2026, à resserrer quand elles montent.
 */

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const PAIN = "2137", TUNIQUES = "2141", COLLIERS = "2146";

async function maximum(ileId: string, objectif: Commande["objectif"]) {
  const grid = downscaleGrid(buildIslandGrid(ileId)!);
  const h = hasHeights(ileId) ? await heightsOf(ileId) : null;
  const heights = h && h.length === grid.w * grid.h ? h : undefined;
  return planifierMaximum(grid, { region: "Roman", maisons: [], objectif, routes: "pavee" }, catalog, lookup, { heights });
}
const pose = (p: { objectif: { good: string; pose: number }[] }, good: string) => p.objectif.find((o) => o.good === good)!.pose;

describe("produire le maximum", () => {
  it.each([
    { ile: "roman_island_small_06", pain: 14.9 },
    { ile: "roman_island_medium_01", pain: 33.7 },
  ])("$ile : pain et tuniques à 3 pour 2, tout est posé, l'île est remplie", async ({ ile, pain }) => {
    const p = await maximum(ile, [{ good: PAIN, parMinute: 3 }, { good: TUNIQUES, parMinute: 2 }]);
    // rien de promis qui ne soit posé
    expect(tenue(p)).toBeGreaterThanOrEqual(0.98);
    // les proportions saisies sont gardées
    expect(pose(p, PAIN) / pose(p, TUNIQUES)).toBeCloseTo(1.5, 1);
    expect(pose(p, PAIN), "pain posé par minute").toBeGreaterThanOrEqual(pain);
    console.log(`${ile} | maximum | ${p.objectif.map((o) => `${o.nom} ${o.pose}/min`).join(", ")} | ${p.qualite.pct.free.toFixed(1)} % de terre vide`);
  });

  it("un bien borné par les emplacements plafonne l'île, et le plan dit pourquoi", async () => {
    // les colliers demandent de l'or : quelques mines, pas plus, quelle que soit la terre libre
    const p = await maximum("roman_island_medium_01", [{ good: PAIN, parMinute: 4 }, { good: COLLIERS, parMinute: 3 }]);
    expect(tenue(p)).toBeGreaterThanOrEqual(0.98);
    expect(pose(p, COLLIERS)).toBeGreaterThan(0);
    expect(p.avertissements.some((a) => a.startsWith("Au-delà, la pose ne tient plus") && a.includes("Mine d'or"))).toBe(true);
  });
});
