import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { makeLookup } from "../engine/rules";
import { economy, worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import { planIslandImport, type IslandPlanRequest } from "./islandPlan";
import { planQuality } from "./planQuality";

/**
 * ═══ LE BILAN D'ATTRIBUTS EST UN INDICATEUR PAR DÉFAUT ═══════════════════════════════
 *
 * Étape 2 de la refonte (`docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`).
 *
 * Avant : le garde-fou démolissait 91 % des maisons posées sur `celtic_island_large_07` pour
 * tenir un bilan d'île jamais vérifié en jeu, gardait services et routes, et livrait 45 % de
 * terre vide — avec des invariants tous au vert. Ces tests verrouillent le contraire : en
 * indicatif rien n'est démoli, le sol sert, et le bilan est DIT ; en strict, l'historique.
 */
const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const topTier = (id: string) => [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === worldOf(regionOfIsland(id)))
  .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

const ILE = "celtic_island_large_07";
const grid = downscaleGrid(buildIslandGrid(ILE)!);
const plan = (opts: Partial<IslandPlanRequest> = {}) => planIslandImport({
  catalog, grid, tierGuid: topTier(ILE).guid, coverageFloor: 0.8, needMode: "auto", ...opts,
});

describe("bilan d'attributs : indicatif par défaut, strict sur demande", () => {
  const indicatif = plan();
  const strict = plan({ viability: "strict" });

  it("en indicatif, le sol sert : moins d'un service par maison, moins d'un tiers de terre vide", () => {
    const q = planQuality(indicatif, grid, lookup);
    expect(q.servicesPerHouse).toBeLessThan(1);
    // Mesuré 29 % depuis le masque des pentes (29/10/2026), 25 % avant : il retire la roche mais
    // laisse entre deux pentes des franges trop étroites pour une maison 3 × 3.
    expect(q.pct.free).toBeLessThan(33);
  });

  it("en strict, l'historique : le garde-fou démolit, et le plan loge bien moins", () => {
    // Mesuré (29/10/2026, terre constructible du jeu, comptoir à cheval sur l'eau) : 329 maisons
    // en strict contre 903 en indicatif — 245 contre 1 932 auparavant, sur une terre qui
    // comptait la montagne. Le facteur 2 laisse passer les variations de placement, pas un
    // garde-fou désarmé.
    expect(strict.viable).toBe(true);
    expect(indicatif.houses).toBeGreaterThan(2 * strict.houses);
    expect(indicatif.residents).toBeGreaterThan(strict.residents);
  });

  it("un bilan négatif est DIT, par maison, et signale qu'aucune maison n'a été démolie", () => {
    expect(indicatif.viable).toBe(false); // si cela change, le modèle d'attributs a bougé
    const dit = indicatif.gaps.find((g) => g.startsWith("Bilan négatif"));
    expect(dit).toBeDefined();
    expect(dit).toMatch(/\/maison/);
    expect(dit).toMatch(/aucune maison n'a été démolie/);
  });

  it("la tolérance n'a d'effet qu'en strict", () => {
    // En indicatif, rien n'est démoli : il n'y a rien à tolérer. Un curseur qui changerait
    // quelque chose ici voudrait dire qu'une passe juge encore sur le bilan.
    const tolere = plan({ tolerance: 3 });
    expect(tolere.houses).toBe(indicatif.houses);
    expect(tolere.residents).toBe(indicatif.residents);
  });
});
