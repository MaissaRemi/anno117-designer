import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { buildIslandGrid } from "../data/islandGrid";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup, rootedRoadSet, terrainConvient } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { keepMainLandmass, pickKontorDef, reserveKontor } from "./kontor";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const svcTypes = (t: (typeof economy.tiers)[number]) =>
  new Set(t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).map((s) => s.building)).size;
const tierRich = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => svcTypes(b) - svcTypes(a))[0]!;

/**
 * Île réelle telle que la voit le planificateur en production : le worker descend la grille
 * vivante ½-tuile en tuiles. Elle porte donc la mer (comptoir côtier), les rivières et les
 * slots montagne (sources d'aqueduc) — trois choses qu'un simple masque terre n'a pas.
 */
function realIsland(id: string): GridShape {
  return downscaleGrid(buildIslandGrid(id)!);
}

describe("une seule masse continentale", () => {
  it("ne garde que le tenant du comptoir", () => {
    // Les « îles » du jeu ne sont pas des blocs pleins : bancs et lobes détachés. Les moteurs y
    // bâtissaient, aucune route ne franchissant la mer — 31 bâtiments INACTIFS en jeu sur une
    // île de 67 maisons. Depuis que la terre constructible vient du jeu (AreaIDs), les îles
    // réelles mesurées sont d'un seul tenant : le cas est donc construit.
    //   terre x 0..9 | mer x 10..19 | terre x 20..29, comptoir à gauche
    const w = 30, h = 10;
    const usable = Array.from({ length: w * h }, (_, c) => c % w < 10 || c % w >= 20);
    const kept = keepMainLandmass({ w, h, usable }, { x: 2, y: 5 });
    expect(kept.usable.filter(Boolean).length).toBe(100);
    expect(kept.usable[5 * w + 25]).toBe(false);
  });

  it("une rivière relie ses deux rives : un pont la franchit", () => {
    const w = 30, h = 10;
    const usable = Array.from({ length: w * h }, (_, c) => c % w < 10 || c % w >= 20);
    const rivers = Array.from({ length: w * h }, (_, c) => c % w >= 10 && c % w < 20 && ((c / w) | 0) === 5);
    const kept = keepMainLandmass({ w, h, usable, rivers }, { x: 2, y: 5 });
    expect(kept.usable.filter(Boolean).length).toBe(200);
    expect(kept.usable[5 * w + 10]).toBe(false); // la rivière reste non constructible
  });

  it("une grille d'un seul tenant est rendue telle quelle", () => {
    const g = makeGrid(24, 24);
    expect(keepMainLandmass(g)).toBe(g);
  });
});

describe("comptoir (racine du réseau routier)", () => {
  it("pickKontorDef choisit un comptoir JOUEUR, pas un comptoir PNJ", () => {
    const def = pickKontorDef(catalog, "Roman");
    expect(def).toBeDefined();
    expect(def!.roadRoot).toBe(true);
    // les « Harbor … Trader … » sont des comptoirs de PNJ, non constructibles
    expect(def!.nameInternal ?? "").toMatch(/^Harbor Warehouse/i);
  });

  it("reserveKontor pose le comptoir À CHEVAL : sa partie dans l'eau sur l'eau, le reste à terre", () => {
    // Le `.ifo` du comptoir romain déclare 6 colonnes dans l'eau sur 8 : posé tout à terre,
    // il restait à l'intérieur des terres et l'éditeur le marquait sur un mauvais terrain.
    const grid = realIsland("roman_island_medium_01");
    const def = pickKontorDef(catalog, "Roman")!;
    expect(def.partieEau).toBeDefined();
    const res = reserveKontor(grid, def)!;
    expect(res).not.toBeNull();
    expect(terrainConvient(grid, def, res.x, res.y, res.rotation, 1)).toBe(true);
    const { w, h } = footprintSize(res.def, res.rotation);
    let eau = 0, terre = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (res.y + j) * grid.w + res.x + i;
      if (grid.water![c]) eau++; else if (grid.usable[c]) terre++;
      expect(res.grid.usable[c]).toBe(false); // retiré du masque donné aux moteurs
      expect(res.grid.water![c]).toBe(false); // et de l'eau : aucun pêcheur dessus
    }
    expect(eau).toBeGreaterThan(0);
    expect(terre).toBeGreaterThan(0);
  });

  it("sans carte d'eau (grille libre), aucun comptoir n'est réservé", () => {
    const def = pickKontorDef(catalog, "Roman")!;
    expect(reserveKontor(makeGrid(60, 60), def)).toBeNull();
  });

  it("le plan d'île produit un réseau ENRACINÉ (le port existe et la voirie y mène)", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planIslandImport({ catalog, grid, tierGuid: tierRich.guid, coverageFloor: 0.8 });
    const roots = r.buildings.filter((b) => lookup(b.defId)?.roadRoot);
    expect(roots.length).toBe(1); // exactement un comptoir

    const rooted = rootedRoadSet({ grid, buildings: r.buildings, roads: r.roads, fields: r.fields }, lookup);
    expect(rooted.hasRoot).toBe(true);
    // l'écrasante majorité de la voirie doit être reliée au comptoir : une route coupée de
    // la racine rend inactifs les bâtiments qu'elle dessert (régression 2026-08 : 6,6 % d'îlots)
    expect(rooted.set.size / Math.max(1, r.roads.length)).toBeGreaterThan(0.95);
  });

  it("île sans littoral : plan quand même produit, manque signalé", () => {
    // grille pleine sans carte d'eau → aucun littoral → pas de comptoir
    const r = planIslandImport({ catalog, grid: makeGrid(60, 60), tierGuid: tierRich.guid, coverageFloor: 0.8 });
    expect(r.buildings.length).toBeGreaterThan(0);
    expect(r.gaps.some((g) => /comptoir/i.test(g))).toBe(true);
  });
});

describe("portfolio de moteurs : l'eau est évaluée AVANT de trancher", () => {
  // Régression 2026-08 : packPlan (non eau-aware) gagnait de 0,1 % d'habitants sur un score
  // optimiste, puis l'eau routée après coup ne raccordait que 2/40 consommateurs (contre
  // 30/30 pour le lattice écarté), ce qui démotait toute la population.
  it("le plan retenu raccorde l'essentiel de ses consommateurs d'eau", () => {
    const grid = realIsland("roman_island_medium_01");
    for (const needMode of ["all", "thresholds"] as const) {
      const r = planIslandImport({ catalog, grid, tierGuid: tierRich.guid, coverageFloor: 0.8, needMode });
      if (!r.water || !r.water.consumers.length) continue;
      const ok = r.water.consumers.filter((c) => c.connected).length;
      // Seuil délibérément bas : sur une île pauvre en slots montagne, un raccordement
      // partiel est le VRAI comportement du jeu (budget 100u/source). Ce qu'on garde, c'est
      // l'effondrement : avant le correctif, le mode « seuils » livrait 5 % (2/40).
      //
      // Recalé à 0,5 après le quota d'unicité partagé : le taux dépend de la disposition, et
      // il bouge dans les DEUX sens quand on retire les autels surnuméraires. A/B mesuré sur
      // roman_island_medium_01 — mode « all » 61 % → 54 %, mode « seuils » 68 % → 89 %. Le
      // 0,6 précédent était calé sur un plan qui frôlait 61 %.
      expect(ok / r.water.consumers.length).toBeGreaterThan(0.5);
    }
  });
});
