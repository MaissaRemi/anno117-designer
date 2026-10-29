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
const CASES: { id: string; pourquoi: string; opts?: Record<string, unknown> }[] = [
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
  {
    id: "roman_island_medium_05",
    pourquoi: "l'île du plancher de bruit : son plan livré porte un déficit vital diffus"
      + " (FireSafety −21 sur 625 maisons) et reste légitimement viable. L'invariant"
      + " `viable-coherent` comparait le drapeau à un ZÉRO STRICT et criait faute sur le plan"
      + " le plus sain du moteur — aucune des trois îles précédentes ne l'exposait."
      + " LES OPTIONS COMPTENT : au seuil 1 sans palier auto, la même île sort à FireSafety"
      + " +0,6 et le défaut disparaît. Ce sont celles du balayage qui l'exposent",
    opts: { coverageFloor: 0.7, autoTier: true, exploitSlots: true },
  },
];

describe("invariants de plan d'île", () => {
  for (const c of CASES) {
    it(`${c.id} : aucun défaut de gravité « faute »`, () => {
      const grid = downscaleGrid(buildIslandGrid(c.id)!);
      const tier = topTier(c.id);
      const r = planIslandImport({
        catalog, grid, tierGuid: tier.guid, coverageFloor: 1, ...(c.opts ?? {}),
      });
      const v = checkPlan(r, { islandId: c.id, grid, lookup, askedTier: tier.guid });
      const fautes = v.filter((x) => x.severity === "faute");
      // message lisible : la règle et son détail, pas un simple compte
      expect(fautes.map((x) => `${x.rule} — ${x.detail}`)).toEqual([]);
      expect(r.residents).toBeGreaterThan(0);
    }, 300_000);
  }
});

// ═══ EXPLOITATIONS SANS DÉBOUCHÉ ═══════════════════════════════════════════════════════
//
// Une mine sans entrepôt à portée de charrette n'expédie RIEN en jeu, et coûte pourtant son
// entretien, sa main-d'œuvre et ses malus de zone. Mesuré avant correctif sur les 55 îles :
// 78 exploitations sur 452 dans ce cas, réparties sur 34 îles.
//
// Les CASES ci-dessus n'activent pas `exploitSlots`, donc aucune n'en pose : ce chemin
// n'était couvert par aucun test.
describe("exploitations : aucune stérile ne survit au plan", () => {
  // UN TEST QUI NE PEUT PAS ÉCHOUER NE VERROUILLE RIEN. `planSlots` purgeant `exploited` sur
  // `served`, la seule assertion « aucune non desservie ne subsiste » passe désormais par
  // construction, sur n'importe quelle île, même si le retrait était supprimé. C'est
  // `droppedSlots` qui rend le retrait observable — et donc testable.
  //
  // Le NOMBRE retiré dépend du dessin du plan (il bouge dès qu'un service change de place) : on
  // verrouille la nature du retrait — total ou partiel —, pas son compte. celtic_island_small_07
  // n'y figure plus : avec la terre constructible du jeu, ses exploitations expédient toutes.
  const CAS: { id: string; retrait: "total" | "partiel"; pourquoi: string }[] = [
    {
      id: "celtic_island_large_03",
      retrait: "partiel",
      pourquoi: "cinq stériles sur dix-sept à la mesure — le cas d'un retrait PARTIEL, qui doit"
        + " laisser debout celles qui expédient",
    },
  ];
  for (const c of CAS) {
    it(`${c.id} : retrait ${c.retrait} des stériles, le reste expédie`, () => {
      const grid = downscaleGrid(buildIslandGrid(c.id)!);
      const tier = topTier(c.id);
      const r = planIslandImport({
        catalog, grid, tierGuid: tier.guid, coverageFloor: 0.7, exploitSlots: true,
      });
      // le retrait a EU LIEU — sans quoi les deux assertions suivantes sont vides de sens
      expect(r.droppedSlots).toBeGreaterThan(0);
      if (c.retrait === "total") expect(r.exploited).toEqual([]);
      else expect(r.exploited.length).toBeGreaterThan(0);
      expect(r.exploited.filter((e) => !e.served)).toEqual([]);
      const v = checkPlan(r, { islandId: c.id, grid, lookup, askedTier: tier.guid });
      expect(v.filter((x) => x.severity === "faute").map((x) => `${x.rule} — ${x.detail}`))
        .toEqual([]);
    }, 300_000);
  }
});
