import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { heightsOf } from "../data/terrain";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { planningRange } from "../engine/roads";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const PATRICIENS = "1498", AMPHI = "g3621", CITERNE = "g19753";

const plan = async (id: string) => planIslandImport({
  catalog, grid: downscaleGrid(buildIslandGrid(id)!), tierGuid: PATRICIENS, coverageFloor: 0.8,
  roadType: "pavee", heights: (await heightsOf(id)) ?? undefined,
});

describe("l'eau du palier des Patriciens", () => {
  // L'Amphithéâtre est unique et indispensable au palier : sec, il plafonne TOUTES les maisons
  // au palier inférieur. Sur ces deux îles il l'était — prise ouverte sur la côte, poche fermée
  // par une falaise — et aucune maison n'atteignait les Patriciens.
  for (const id of ["roman_island_small_01", "roman_island_medium_05"]) {
    it(`${id} : l'Amphithéâtre est raccordé, des maisons atteignent le palier`, async () => {
      const r = await plan(id);
      const amphi = r.buildings.find((b) => b.defId === AMPHI);
      expect(amphi).toBeDefined();
      expect(r.water?.consumers.find((c) => c.uid === amphi!.uid)?.connected).toBe(true);
      expect(r.fullyCovered).toBeGreaterThan(r.houses / 2);
    }, 300_000);
  }

  it("le rapport de couverture compte les portées du type de route du plan", async () => {
    // il les comptait en chemin de terre : Citernes « à 48 % » sur un plan en routes pavées
    const r = await plan("roman_island_medium_01");
    const citerne = r.coverage.services.find((s) => s.serviceId === CITERNE);
    expect(citerne?.range).toBe(planningRange(byId.get(CITERNE)!, "pavee"));
  }, 300_000);
});

describe("prix du bilan", () => {
  it("roman_island_medium_04 : un bilan incendie sain pour quelques habitants", async () => {
    // sans prix, −4,6 de sécurité incendie par maison ; avec, les Bains reviennent
    const id = "roman_island_medium_04";
    const req = {
      catalog, grid: downscaleGrid(buildIslandGrid(id)!), tierGuid: PATRICIENS, coverageFloor: 0.8,
      roadType: "pavee" as const, heights: (await heightsOf(id)) ?? undefined,
    };
    const brut = planIslandImport({ ...req, prixDuBilan: 0 });
    const sain = planIslandImport(req);
    const feu = (r: typeof brut) => (r.attrsTotal.FireSafety ?? 0) / r.houses;
    expect(feu(sain)).toBeGreaterThan(feu(brut) + 2);
    expect(sain.residents).toBeGreaterThan(brut.residents * 0.9);
  }, 300_000);
});
