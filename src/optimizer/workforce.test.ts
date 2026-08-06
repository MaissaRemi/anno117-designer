import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { economy, worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import { workforceGrant, workforceDemand, workforcePrice } from "../economy/workforce";
import { WorkforceLedger } from "./workforceLedger";
import type { HousePlot } from "./planLattice";

const catalog = rawCatalog as unknown as BuildingDef[];
const tierNamed = (n: string) => economy.tiers.find((t) => t.name === n)!;
const topTierOf = (world: string) =>
  [...economy.tiers].filter((t) => t.residenceId && worldOf(t.region) === world)
    .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

describe("main-d'œuvre — données du jeu", () => {
  it("le comptoir offre de la main-d'œuvre, dans les deux mondes", () => {
    // C'est la seule main-d'œuvre disponible avant la première maison.
    const latium = workforceGrant("g3402");
    const albion = workforceGrant("g7037");
    expect(latium[tierNamed("Liberti").guid]).toBe(25);
    expect(albion[tierNamed("Tourbiers").guid]).toBe(25);
    // Le net n'est PAS monotone en niveau : le comptoir amélioré offre 35 mais en prélève 8.
    expect(workforceGrant("g3403")[tierNamed("Liberti").guid]).toBe(27);
    expect(workforceGrant("g3406")[tierNamed("Liberti").guid]).toBe(38);
  });

  it("aucun bâtiment ne réclame deux types de main-d'œuvre", () => {
    // Ce qui réduit la contrainte à un système d'inégalités, une par palier.
    for (const wf of Object.values(economy.buildingWorkforce)) expect(wf.length).toBeLessThanOrEqual(1);
  });

  it("viser un palier intermédiaire coûte moins cher que descendre au plus bas", () => {
    // Contre-intuitif et décisif pour le tri : la cascade est LATÉRALE, pas descendante.
    const pat = tierNamed("Patriciens");
    const eq = workforcePrice(pat, tierNamed("Equites"));
    const lib = workforcePrice(pat, tierNamed("Liberti"));
    expect(eq).toBeLessThan(lib);
    expect(eq).toBeCloseTo(2.29, 1);
    expect(lib).toBeCloseTo(9.67, 1);
  });
});

describe("grand-livre de main-d'œuvre", () => {
  /** Deux parcelles pouvant accueillir Patriciens ou Plébéiens. */
  const plots = (n: number): HousePlot[] => {
    const pat = tierNamed("Patriciens"), ple = tierNamed("Plébéiens");
    return Array.from({ length: n }, (_, i) => ({
      uid: `h${i}`,
      guid: pat.guid,
      opts: [
        { guid: ple.guid, defId: ple.residenceId!, cap: 13, money: 12, attrs: { Happiness: 6, Money: 12, Health: 3, FireSafety: 1 } },
        { guid: pat.guid, defId: pat.residenceId!, cap: 35, money: 76, attrs: { Happiness: 17, Money: 76, Health: 13, FireSafety: 4 } },
      ],
    }));
  };

  it("sans demande, aucune maison n'est rétrogradée", () => {
    const l = new WorkforceLedger(plots(10), {}, "Roman");
    const r = l.settle();
    expect(r.conversions).toEqual([]);
    expect(r.residents).toBe(350);
  });

  it("une demande d'un palier absent force la conversion, et elle seule", () => {
    // 8 unités de main-d'œuvre plébéienne : une maison en fournit 13 × 0,3 = 3,9.
    const ple = tierNamed("Plébéiens").guid;
    const direct = new WorkforceLedger(plots(10), {}, "Roman");
    (direct as unknown as { demand: Record<string, number> }).demand = { [ple]: 8 };
    const r = direct.settle();
    expect(r.conversions).toHaveLength(1);
    expect(r.conversions[0].to).toBe(ple);
    expect(r.conversions[0].houses).toBe(3); // ⌈8 / 3,9⌉
    expect(r.deficit).toEqual({});
    // la population baisse d'exactement (35 − 13) × 3
    expect(r.residents).toBe(350 - 66);
  });

  it("la main-d'œuvre du comptoir évite des conversions", () => {
    const ple = tierNamed("Plébéiens").guid;
    const l = new WorkforceLedger(plots(10), { [ple]: 8 }, "Roman");
    (l as unknown as { demand: Record<string, number> }).demand = { [ple]: 8 };
    const r = l.settle();
    expect(r.conversions).toEqual([]);
    expect(r.residents).toBe(350);
  });

  it("une demande hors du monde de l'île est signalée, jamais poursuivie", () => {
    const l = new WorkforceLedger(plots(10), {}, "Celtic");
    const ple = tierNamed("Plébéiens").guid;
    (l as unknown as { demand: Record<string, number> }).demand = { [ple]: 40 };
    const r = l.settle();
    expect(r.alien[ple]).toBe(40);
    expect(r.conversions).toEqual([]); // aucune maison d'Albion ne peut fournir un Plébéien
  });
});

describe("cascade dans le plan d'île", () => {
  for (const islandId of ["roman_island_medium_01", "celtic_island_large_07"]) {
    it(`${islandId} : la production locale est ARMÉE, et l'île reste viable`, () => {
      const world = regionOfIsland(islandId);
      const tier = topTierOf(world);
      const grid = downscaleGrid(buildIslandGrid(islandId)!);
      const r = planIslandImport({
        catalog, grid, tierGuid: tier.guid, coverageFloor: 0.8,
        exploitSlots: true, localProduction: true,
      });

      // 1. Tout bâtiment posé trouve ses ouvriers. Un déficit signifierait, en jeu, des
      //    ateliers tournant au ralenti — exactement ce que la cascade doit empêcher.
      expect(r.workforce.deficit).toEqual({});
      expect(r.workforce.alien).toEqual({});

      // 2. La demande est réelle : le plan pose bien des bâtiments qui consomment.
      expect(Object.keys(r.workforce.demand).length).toBeGreaterThan(0);

      // 3. L'offre couvre la demande, palier par palier.
      for (const [guid, d] of Object.entries(r.workforce.demand)) {
        expect(r.workforce.offer[guid] ?? 0).toBeGreaterThanOrEqual(d - 1e-6);
      }

      // 4. Le bilan de l'île reste positif sur les quatre attributs vitaux — la cascade se
      //    paie sur le budget d'attributs, elle ne le crève pas.
      expect(r.viable).toBe(true);
      for (const k of ["Happiness", "Money", "Health", "FireSafety"]) {
        expect(r.attrsTotal[k]).toBeGreaterThanOrEqual(0);
      }

      // 5. Les maisons converties sont réellement posées avec le bon `defId`.
      const byDef = new Map(catalog.map((d) => [d.id, d]));
      for (const c of r.workforce.conversions) {
        const def = economy.tiers.find((t) => t.guid === c.to)?.residenceId;
        expect(byDef.has(def!)).toBe(true);
        expect(r.buildings.filter((b) => b.defId === def).length).toBeGreaterThanOrEqual(c.houses);
      }
    }, 300_000);
  }

  it("sans production locale ni exploitation, la cascade ne change rien", () => {
    // Garde-fou de non-régression : le plan d'import pur ne consomme presque pas de
    // main-d'œuvre, il ne doit donc perdre aucun habitant à la cascade.
    const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
    const tier = topTierOf("Roman");
    const r = planIslandImport({ catalog, grid, tierGuid: tier.guid, coverageFloor: 0.8 });
    expect(r.workforce.conversions).toEqual([]);
    expect(r.residents).toBeGreaterThan(20_000);
  }, 300_000);

  it("la demande de main-d'œuvre d'un bâtiment est lue depuis les données du jeu", () => {
    const anyWorkshop = Object.keys(economy.buildingWorkforce)[0];
    const d = workforceDemand([anyWorkshop]);
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
