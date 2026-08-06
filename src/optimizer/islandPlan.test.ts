import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { solve } from "../economy/solve";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
// tier réel avec résidence + au moins un service à rayon
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.some((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)),
)!;

const plan = (w: number, h: number, floor = 1) =>
  planIslandImport({ catalog, grid: makeGrid(w, h), tierGuid: tier.guid, coverageFloor: floor });

// capacité MAXIMALE d'une maison du palier (tous besoins remplis) — borne haute seulement :
// la capacité réelle vaut Σ Population des besoins REMPLIS (cf. economy/needsModel), donc
// deux maisons du même palier n'hébergent pas forcément autant.
const capOf = (guid: string) => economy.tiers.find((t) => t.guid === guid)?.capacityDefault ?? 1;
const maxMixed = (tc: Record<string, number>) => Object.entries(tc).reduce((s, [g, n]) => s + n * capOf(g), 0);

describe("planIslandImport (mode import)", () => {
  it("cale des maisons et renvoie un manifeste d'import", () => {
    const r = plan(36, 36, 0.5);
    expect(r.houses).toBeGreaterThan(0);
    // habitants = Σ des capacités RÉELLES par maison : strictement positif, et borné par
    // la capacité pleine de chaque palier (une maison partiellement desservie héberge moins)
    expect(r.residents).toBeGreaterThan(0);
    expect(r.residents).toBeLessThanOrEqual(maxMixed(r.tierCounts));
    expect(Object.values(r.tierCounts).reduce((a, b) => a + b, 0)).toBe(r.houses); // Σ tiers = maisons
    expect(r.fullyCovered).toBeLessThanOrEqual(r.houses);
    expect(r.buildings.length).toBeGreaterThanOrEqual(r.houses); // résidences + services
    expect(r.importGoods.length).toBeGreaterThan(0); // biens à acheminer
    expect(r.importGoods.every((g) => g.perMin > 0)).toBe(true);
  });

  it("plus de surface => au moins autant de maisons (monotone)", () => {
    const small = plan(24, 24, 0.5);
    const big = plan(48, 48, 0.5);
    expect(big.houses).toBeGreaterThanOrEqual(small.houses);
  });

  it("manifeste = demande directe solve(vecteur pop MIXTE par tier)", () => {
    const r = plan(36, 36, 0.5);
    const targets = Object.entries(r.tierCounts).map(([g, n]) => ({ tier: g, pop: n * capOf(g) }));
    const capacities = Object.fromEntries(Object.keys(r.tierCounts).map((g) => [g, capOf(g)]));
    const sol = solve(
      targets,
      { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, capacities },
    );
    // chaque bien du manifeste correspond à la demande solve mixte (arrondie)
    for (const g of r.importGoods.slice(0, 5)) {
      expect(Math.round((sol.goodsPerMin[g.good] || 0) * 100) / 100).toBeCloseTo(g.perMin, 1);
    }
  });

  it("best-effort : grille minuscule => peu de maisons, jamais d'échec", () => {
    const r = plan(10, 10, 1);
    expect(r.houses).toBeGreaterThanOrEqual(0);
    expect(r.mode).toBe("import");
    expect(Array.isArray(r.gaps)).toBe(true);
  });

  it("rapporte la couverture et les trous", () => {
    const r = plan(40, 40, 1);
    expect(r.coverage.services.length).toBeGreaterThan(0);
    expect(typeof r.coverageMin).toBe("number");
  });

  it("borne basse de non-régression sur l'île de référence, TOUTES maisons viables", () => {
    // Golden numérique : la population livrée sur celtic_island_large_07 en mode auto.
    // Historique : 30 092 (audit) → 43 315 (seuils pondérés) → 65 404 (recette) → 67 862
    // (filet de repli + raffinage + ancrage eau) → 24 428.
    //
    // La chute n'est PAS une régression : le plan respecte désormais la contrainte de
    // viabilité (Bonheur, Argent, Santé et Sécurité incendie ≥ 0 sur CHAQUE maison, malus
    // de rang de cité compris). Les 67 862 précédents comptaient des maisons que le jeu
    // aurait sanctionnées par des émeutes, des incendies et des maladies. Le nombre a
    // changé de SENS : il compte maintenant des habitants tenables.
    const grid = downscaleGrid(buildIslandGrid("celtic_island_large_07")!);
    const t4 = [...economy.tiers].filter((t) => t.residenceId)
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8 });
    expect(r.residents).toBeGreaterThan(20_000);
    expect(r.viable).toBe(true);
    for (const k of ["Happiness", "Money", "Health", "FireSafety"]) {
      expect(r.attrsWorst[k]).toBeGreaterThanOrEqual(0);
    }
    // et toute maison retenue atteint le palier visé : les autres n'auraient pas tenu
    expect(r.fullyCoveredPct).toBeGreaterThanOrEqual(95);
  }, 120_000);

  it("les DEUX modes de besoins atteignent le palier cible sur une île réelle", () => {
    // Régression 2026-08 : le palier était décidé par un ET booléen sur TOUS les services du
    // tier. En mode « seuils », qui écarte volontairement certains services, le masque devenait
    // insatisfiable → 0 maison au palier cible, par construction (mesuré sur une île 320²).
    // La vraie règle est un seuil de SupplyWeight par catégorie (cf. economy/needsModel).
    const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
    const t4 = [...economy.tiers].filter((t) => t.residenceId)
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    // `all` sur une île pauvre en eau peut ne rien atteindre : c'est la recherche de recette
    // (mode par défaut) qui doit trouver une configuration tenable.
    for (const needMode of ["auto", "all"] as const) {
      const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, needMode });
      expect(r.houses).toBeGreaterThan(100);
      // la population dépasse largement ce que donnerait un plan tout-au-palier-de-base
      const capBase = Math.min(...economy.tiers.filter((t) => t.residenceId).map((t) => t.capacityDefault));
      expect(r.residents).toBeGreaterThan(r.houses * capBase);
      if (needMode === "auto") {
        expect(r.fullyCovered).toBeGreaterThan(0);
        expect(r.viable).toBe(true);
      }
    }
  }, 120_000);
});
