import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { hasHeights, heightsOf } from "../data/terrain";
import { makeLookup } from "../engine/rules";
import { planifierCommande } from "../commande/planifier";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { regroupement, type Regroupement } from "./planQuality";

/**
 * ═══ PANNEAU DE QUALITÉ : LES EXIGENCES DE RÉMI, EN TESTS ═════════════════════════════
 *
 * Les autres tests vérifient qu'un plan est VALIDE. Celui-ci vérifie qu'il ne devient pas PIRE
 * sur ce que Rémi exige (`.claude/exigences.md`) : peu de copies d'un même service, espacées
 * selon leur portée, pas de pâtés, et rien qui manque. Audit : `docs/AUDIT-2026-11-10.md`.
 *
 * Les seuils sont les valeurs MESURÉES le 2026-11-10, pas des cibles : c'est un cliquet. Une
 * correction qui améliore une valeur resserre son seuil dans le même commit ; un seuil ne se
 * relâche qu'avec l'accord de Rémi, jamais pour faire passer un gain d'habitants.
 *
 * Trois îles, les deux moteurs de quartiers, route pavée (le défaut de l'interface) ; un cas en
 * chemin de terre pour « Remplir l'île », où les portées courtes changent la donne.
 *
 * 2026-11-10, étapes 1 et 2 de l'audit — « Ma commande » : îlots partiels, petits services
 * collés à la colonne de route, gain minimal d'une copie de plus, recouvrement une fois la ville
 * faite. Avant → après : medium_01 61 % en pâté / 0,2 / 333 logées → 35 % / 0,27 / 450 ;
 * small_06 74 % / 0,4 / 91 → 32 % / 0,46 / 158 ; celtic_large_07 39 % / 0,29 / 700 → 22 % /
 * 0,36 / 700. « Remplir l'île » : une grappe par tranche de portée, sans effet en pavée ; en
 * terre medium_01 passe de 336 à 375 maisons au palier (86 → 90 % en pâté, 0,52 → 0,38).
 */
const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

interface Seuils {
  /** part des services dans un pâté, en % : ne doit pas monter */
  enPate: number;
  /** pire rapport espacement / espacement permis : ne doit pas baisser */
  espacement: number;
  /** maisons au palier demandé : ne doit pas baisser */
  auPalier: number;
}

/** Palier sommet de chaque monde : Patriciens (1498) au Latium, Nobles (1504) en Albion. */
const ILES: { ile: string; region: string; palier: string; commandees: number; remplir: Seuils; terre?: Seuils; commande: Seuils }[] = [
  {
    ile: "roman_island_medium_01", region: "Roman", palier: "1498", commandees: 450,
    remplir: { enPate: 75, espacement: 0.59, auPalier: 563 },
    terre: { enPate: 90, espacement: 0.38, auPalier: 375 },
    commande: { enPate: 35, espacement: 0.27, auPalier: 450 },
  },
  {
    ile: "roman_island_small_06", region: "Roman", palier: "1498", commandees: 200,
    remplir: { enPate: 81, espacement: 0.49, auPalier: 217 },
    commande: { enPate: 32, espacement: 0.46, auPalier: 158 },
  },
  {
    ile: "celtic_island_large_07", region: "Celtic", palier: "1504", commandees: 700,
    remplir: { enPate: 83, espacement: 0.55, auPalier: 888 },
    commande: { enPate: 22, espacement: 0.36, auPalier: 700 },
  },
];

const ligne = (ile: string, moteur: string, r: Regroupement, auPalier: string, extra = "") => console.log([
  ile, moteur, `${r.services} services`, `${r.enPate} % en pâté (max ${r.plusGros})`,
  `espacement ${r.espacement}${r.parService[0] ? ` (${r.parService[0].nom} : ${r.parService[0].voisin} pour ${r.parService[0].permis})` : ""}`,
  `au palier ${auPalier}`, extra,
].filter(Boolean).join(" | "));

const tenir = (r: Regroupement, auPalier: number, s: Seuils) => {
  expect(r.enPate, "part des services dans un pâté").toBeLessThanOrEqual(s.enPate);
  expect(r.espacement, "pire espacement d'un même service, rapporté à sa portée").toBeGreaterThanOrEqual(s.espacement);
  expect(auPalier, "maisons au palier demandé").toBeGreaterThanOrEqual(s.auPalier);
};

describe("panneau de qualité : pâtés, espacement, maisons au palier", () => {
  for (const c of ILES) {
    const grid = downscaleGrid(buildIslandGrid(c.ile)!);

    for (const [roadType, seuils] of [["pavee", c.remplir], ["terre", c.terre]] as const) {
      if (!seuils) continue;
      it(`${c.ile} — Remplir l'île, ${roadType}`, async () => {
        const h = hasHeights(c.ile) ? await heightsOf(c.ile) : null;
        const heights = h && h.length === grid.w * grid.h ? h : undefined;
        const p = planIslandImport({
          catalog, grid, tierGuid: c.palier, coverageFloor: 0.8, needMode: "auto", roadType, heights,
        });
        const r = regroupement(p, lookup, roadType);
        ligne(c.ile, `remplir ${roadType}`, r, `${p.fullyCovered} / ${p.houses}`);
        tenir(r, p.fullyCovered, seuils);
      }, 300_000);
    }

    it(`${c.ile} — Ma commande, ${c.commandees} maisons`, () => {
      const p = planifierCommande(grid, {
        region: c.region, maisons: [{ tierGuid: c.palier, maisons: c.commandees }], routes: "pavee",
      }, catalog, lookup);
      const r = regroupement(p.layout, lookup, "pavee");
      const logees = p.lignes.find((l) => l.role === "residence")?.pose ?? 0;
      const svc = p.lignes.filter((l) => l.role === "service" || l.role === "institution");
      const somme = (k: "pose" | "demande") => svc.reduce((s, l) => s + l[k], 0);
      ligne(c.ile, "commande", r, `${logees} / ${c.commandees}`, `services posés ${somme("pose")} pour ${somme("demande")} au devis`);
      tenir(r, logees, c.commande);
    }, 300_000);
  }
});
