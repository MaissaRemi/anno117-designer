import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, GridShape, Layout } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { hasHeights, heightsOf } from "../data/terrain";
import { regionOfIsland } from "../data/islands";
import { economy, worldOf } from "../economy/economy";
import { computeRadiusCoverage, makeLookup, roadConnected, rootedRoadSet } from "../engine/rules";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport, type IslandPlanRequest, type IslandPlanResult } from "./islandPlan";
import { planLattice } from "./planLattice";
import { catalogueDiagonal, grilleDiagonale, hauteursDiagonales } from "./cadreDiagonal";
import { checkPlan } from "./invariants";
import { planifierCommande } from "../commande/planifier";
import type { Commande } from "../commande/nomenclature";

/**
 * ═══ GOLDEN DE LA TRAME DROITE ═════════════════════════════════════════════════════════
 *
 * Référence figée AVANT le passage des routes au graphe (trame mêlée, étape 2 :
 * `docs/superpowers/specs/2026-10-29-reseau-routier-graphe.md`). Un plan tout droit doit
 * rester identique case pour case : bâtiments, routes, conduites, champs, dans leur ordre,
 * plus ce que l'analyseur en dit (réseau enraciné, couvertures, invariants).
 *
 * Chaque cas a son empreinte dans `__golden__/<cas>.json` : les chiffres lisibles, et un
 * hachage de la sortie complète. Les moteurs d'île sont déterministes (aucun budget en temps).
 *
 *  - toujours : les cas RAPIDES, bloquants ;
 *  - `GOLDEN=1` : le panel entier (plusieurs minutes) ;
 *  - recapture volontaire : `pnpm vitest run src/optimizer/trameDroite.golden.test.ts -u`
 *    (avec `GOLDEN=1` pour tout le panel) — seulement quand un changement de plan est VOULU.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const PANEL_ENTIER = !!env.GOLDEN;

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const PATRICIENS = "1498", PLEBEIENS = "1496";

const sommetDe = (islandId: string): string => [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === worldOf(regionOfIsland(islandId)))
  .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!.guid;

async function ile(id: string): Promise<{ grid: GridShape; heights?: Int8Array }> {
  const grid = downscaleGrid(buildIslandGrid(id)!);
  const h = hasHeights(id) ? await heightsOf(id) : null;
  return { grid, heights: h && h.length === grid.w * grid.h ? h : undefined };
}

/** FNV-1a sur 2 × 32 bits (deux graines) : 64 bits suffisent à détecter une dérive. */
function hacher(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** Sortie spatiale complète, dans son ordre ; les `uid` (compteurs globaux) sont écartés. */
function spatial(l: Pick<Layout, "buildings" | "roads" | "fields" | "aqueducts">): string {
  const rang = new Map(l.buildings.map((b, i) => [b.uid, i]));
  return [
    l.buildings.map((b) => `${b.defId}@${b.x},${b.y},${b.rotation}`).join(";"),
    l.roads.map((r) => `${r.x},${r.y}`).join(";"),
    l.fields.map((f) => `${f.x},${f.y},${f.fieldType},${rang.get(f.ownerUid) ?? "?"}`).join(";"),
    (l.aqueducts ?? []).map((a) => `${a.x},${a.y}`).join(";"),
  ].join("|");
}

/** Ce que l'analyseur (échelle 1) dit du plan : réseau enraciné, raccordements, couvertures. */
function analyse(layout: Layout) {
  const { set, hasRoot } = rootedRoadSet(layout, lookup);
  const coupes = layout.buildings.filter((b) => !roadConnected(layout, lookup, b, set)).length;
  const cov = computeRadiusCoverage(layout, lookup);
  const ordre = new Map(layout.buildings.map((b, i) => [b.uid, i]));
  const couvertures = [...cov.entries()]
    .map(([uid, s]) => `${ordre.get(uid)}:${[...s].sort().join(" ")}`)
    .join("|");
  let casesCouvertes = 0;
  for (const s of cov.values()) casesCouvertes += s.size;
  return {
    reseauEnracine: hasRoot ? set.size : -1,
    batimentsCoupes: coupes,
    casesCouvertes,
    hachageCouvertures: hacher(couvertures),
  };
}

function empreintePlan(r: IslandPlanResult, grid: GridShape, islandId: string, askedTier: string) {
  const layout: Layout = {
    grid: r.repere?.grid ?? grid,
    buildings: r.buildings, roads: r.roads, fields: r.fields, aqueducts: r.aqueducts, roadType: r.roadType,
  };
  const violations = checkPlan(r, { islandId, grid: layout.grid, lookup, askedTier })
    .map((v) => `${v.rule}: ${v.detail}`).sort();
  const chiffres = {
    palier: r.tierGuid,
    maisons: r.houses,
    habitants: r.residents,
    maisonsAuPalier: r.fullyCovered,
    paliers: r.tierCounts,
    batiments: r.buildings.length,
    routes: r.roads.length,
    conduites: r.aqueducts.length,
    champs: r.fields.length,
    eau: r.water ? { sources: r.water.sources, utilisee: r.water.used } : null,
    repere: r.repere?.type ?? "droit",
  };
  return {
    ...chiffres,
    analyse: analyse(layout),
    violations: violations.length,
    hachage: hacher(JSON.stringify(chiffres) + "#" + spatial(r) + "#" + violations.join("\n") + "#" + r.gaps.join("\n")),
  };
}

const empreinteComplete = (r: IslandPlanResult, grid: GridShape, islandId: string, askedTier: string) => ({
  recommande: empreintePlan(r, grid, islandId, askedTier),
  alternatives: (r.alternatives ?? []).map((a) => empreintePlan(a, grid, islandId, askedTier)),
});

/** Réglages par défaut de l'écran Planifier (IslandPlanner) : 80 %, pavée, dévotion selon la Foi. */
const reglagesEcran = (o: Partial<IslandPlanRequest> = {}) => ({
  coverageFloor: 0.8, roadType: "pavee" as const, devotionSelonFoi: true, ...o,
});

interface Cas { nom: string; rapide?: boolean; calcul: () => Promise<unknown> }

const planDroit = (islandId: string, tier: string | null, o: Partial<IslandPlanRequest> = {}) => async () => {
  const { grid, heights } = await ile(islandId);
  const tierGuid = tier ?? sommetDe(islandId);
  const r = planIslandImport({ catalog, grid, heights, tierGuid, ...reglagesEcran(o) });
  return empreinteComplete(r, grid, islandId, tierGuid);
};

/** Le plan diagonal tel que `avecTrameDiagonale` le calcule : le même code, dans le repère tourné. */
const planDiagonal = (islandId: string) => async () => {
  const { grid: droite, heights } = await ile(islandId);
  const { grid, cadre } = grilleDiagonale(droite);
  const r = planIslandImport({
    catalog: catalogueDiagonal(catalog), grid, tierGuid: PATRICIENS,
    heights: heights ? hauteursDiagonales(heights, droite, cadre) : undefined,
    ...reglagesEcran(),
  });
  return empreinteComplete(r, grid, islandId, PATRICIENS);
};

const commande = (islandId: string, c: Commande) => async () => {
  const { grid, heights } = await ile(islandId);
  const p = planifierCommande(grid, c, catalog, lookup, { heights });
  const chiffres = {
    batiments: p.layout.buildings.length,
    routes: p.layout.roads.length,
    conduites: (p.layout.aqueducts ?? []).length,
    champs: p.layout.fields.length,
    servi: p.servi,
    manques: p.manques,
    lignes: p.lignes.length,
  };
  return {
    ...chiffres,
    analyse: analyse(p.layout),
    hachage: hacher(JSON.stringify(chiffres) + "#" + spatial(p.layout) + "#" + p.avertissements.join("\n")
      + "#" + JSON.stringify(p.lignes)),
  };
};

const CAS: Cas[] = [
  {
    nom: "lattice-medium_01", rapide: true,
    calcul: async () => {
      const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
      const r = planLattice(grid, PATRICIENS, lookup, { coverageFloor: 0.8, roadType: "pavee" });
      const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: r.fields, roadType: "pavee" };
      return {
        maisons: r.houses, maisonsAuPalier: r.fullyCovered, habitants: r.residents, routes: r.roads.length,
        analyse: analyse(layout),
        hachage: hacher(spatial(layout)),
      };
    },
  },
  { nom: "plan-small_06", rapide: true, calcul: planDroit("roman_island_small_06", PATRICIENS) },
  {
    nom: "commande-medium_01-pain", rapide: true,
    calcul: commande("roman_island_medium_01", {
      region: "Roman", maisons: [{ tierGuid: PLEBEIENS, maisons: 100 }],
      production: [{ defId: "g3174", count: 2 }], completerProduction: true,
    }),
  },
  { nom: "plan-medium_01", calcul: planDroit("roman_island_medium_01", PATRICIENS) },
  { nom: "plan-small_05", calcul: planDroit("roman_island_small_05", PATRICIENS) },
  { nom: "plan-medium_04", calcul: planDroit("roman_island_medium_04", PATRICIENS) },
  { nom: "plan-large_03", calcul: planDroit("roman_island_large_03", PATRICIENS) },
  { nom: "plan-large_07", calcul: planDroit("roman_island_large_07", PATRICIENS) },
  { nom: "plan-celtic_medium_04", calcul: planDroit("celtic_island_medium_04", null) },
  { nom: "plan-medium_01-terre", calcul: planDroit("roman_island_medium_01", PATRICIENS, { roadType: "terre" }) },
  { nom: "plan-small_06-maisons", calcul: planDroit("roman_island_small_06", PATRICIENS, { objectif: "maisons", needMode: "auto" }) },
  {
    nom: "plan-medium_01-ateliers",
    calcul: planDroit("roman_island_medium_01", PATRICIENS, { exploitSlots: true, localProduction: true }),
  },
  { nom: "diagonal-medium_01", calcul: planDiagonal("roman_island_medium_01") },
  { nom: "diagonal-large_07", calcul: planDiagonal("roman_island_large_07") },
  {
    nom: "commande-medium_01-patriciens",
    calcul: commande("roman_island_medium_01", { region: "Roman", maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], routes: "pavee" }),
  },
];

describe("golden de la trame droite", () => {
  for (const c of CAS) {
    it.skipIf(!c.rapide && !PANEL_ENTIER)(c.nom, async () => {
      const t0 = Date.now();
      const e = await c.calcul();
      console.log(`golden ${c.nom} : ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await expect(JSON.stringify(e, null, 2) + "\n").toMatchFileSnapshot(`./__golden__/${c.nom}.json`);
    }, 1_800_000);
  }
});
