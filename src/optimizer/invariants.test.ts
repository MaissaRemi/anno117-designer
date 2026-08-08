import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { makeLookup } from "../engine/rules";
import { economy, worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import { planIslandImport } from "./islandPlan";
import { checkPlan } from "./invariants";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const topTier = (id: string) => [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === worldOf(regionOfIsland(id)))
  .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

/**
 * FILET PERMANENT des invariants de plan.
 *
 * Le balayage large (`audit.sweep.test.ts`, `AUDIT=1`) passe les 55 îles et imprime son
 * inventaire sans faire échouer personne — il coûte dix minutes. Ce test-ci est son pendant
 * bloquant : trois îles, choisies parce que CHACUNE a révélé un défaut distinct, et la suite
 * échoue sur toute violation de gravité `faute`.
 *
 * État de référence : le balayage complet rend 55 plans / 55 violations et 36 plans / 33
 * violations, TOUTES de gravité `suspect` — le reliquat de services isolés par l'élagage des
 * routes, déjà signalé à l'utilisateur dans les trous du plan et exclu de la couverture
 * affichée. Aucune `faute`.
 */
const CASES: { id: string; pourquoi: string }[] = [
  {
    id: "celtic_island_large_05",
    pourquoi: "le comptoir se déclarait raccordé par un COIN — diagonal, donc sans accès"
      + " orthogonal : aucune racine de réseau, 147 services inactifs en jeu",
  },
  {
    id: "roman_island_small_02",
    pourquoi: "la source d'aqueduc se posait SUR le comptoir — elle vise les cases hors masque"
      + " de terre, que la réservation ne protège pas",
  },
  {
    id: "celtic_island_large_07",
    pourquoi: "les paliers d'Albion référençaient des bâtiments ROMAINS, et les deux variantes"
      + " du même service étaient posées : le besoin comptait deux fois",
  },
];

describe("invariants de plan d'île", () => {
  for (const c of CASES) {
    it(`${c.id} : aucun défaut de gravité « faute »`, () => {
      const grid = downscaleGrid(buildIslandGrid(c.id)!);
      const tier = topTier(c.id);
      const r = planIslandImport({ catalog, grid, tierGuid: tier.guid, coverageFloor: 1 });
      const v = checkPlan(r, { islandId: c.id, grid, lookup, askedTier: tier.guid });
      const fautes = v.filter((x) => x.severity === "faute");
      // message lisible : la règle et son détail, pas un simple compte
      expect(fautes.map((x) => `${x.rule} — ${x.detail}`)).toEqual([]);
      expect(r.residents).toBeGreaterThan(0);
    }, 300_000);
  }
});
