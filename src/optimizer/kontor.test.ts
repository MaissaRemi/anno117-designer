import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { buildIslandGrid } from "../data/islandGrid";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup, rootedRoadSet } from "../engine/rules";
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
    // Les « îles » du jeu ne sont pas des blocs pleins : 85 composantes de terre sur
    // celtic_island_small_06, 112 sur celtic_island_small_01 dont une de 1 193 cases. Les
    // moteurs y bâtissaient, aucune route ne franchissant la mer — 31 bâtiments INACTIFS en
    // jeu sur une île de 67 maisons, marchés et puits compris, donc des maisons comptées
    // comme desservies par des services qui ne tournent pas.
    //
    // Ni un détour plus long (essayé à 96 cases) ni le droit de raser des maisons pour ouvrir
    // un passage (essayé aussi) n'y changeaient rien : on ne traverse pas la mer.
    const grid = realIsland("celtic_island_small_01");
    const W = grid.w, H = grid.h, N = W * H;
    const kept = keepMainLandmass(grid);
    const seen = new Uint8Array(N);
    const sizes: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!kept.usable[i] || seen[i]) continue;
      let n = 0;
      let fr = [i];
      seen[i] = 1;
      while (fr.length) {
        const nx: number[] = [];
        for (const c of fr) {
          n++;
          const x = c % W, y = (c / W) | 0;
          for (const d of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
            if (d >= 0 && kept.usable[d] && !seen[d]) { seen[d] = 1; nx.push(d); }
          }
        }
        fr = nx;
      }
      sizes.push(n);
    }
    expect(sizes.length).toBe(1); // un seul tenant subsiste
    const before = grid.usable.filter(Boolean).length;
    expect(sizes[0]).toBeLessThan(before); // l'île en avait bien plusieurs
    expect(sizes[0]).toBeGreaterThan(before * 0.5); // et on a gardé le principal
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

  it("reserveKontor pose l'emprise sur la TERRE, au contact de la MER, et la retire du masque", () => {
    const grid = realIsland("roman_island_medium_01");
    const def = pickKontorDef(catalog, "Roman")!;
    const res = reserveKontor(grid, def);
    expect(res).not.toBeNull();
    const { w, h } = footprintSize(res!.def, res!.rotation);
    let touchesSea = false;
    for (let j = -1; j <= h; j++) {
      for (let i = -1; i <= w; i++) {
        const x = res!.x + i, y = res!.y + j;
        if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
        const inside = i >= 0 && i < w && j >= 0 && j < h;
        const c = y * grid.w + x;
        if (inside) {
          expect(grid.usable[c]).toBe(true); // toute l'emprise sur la terre
          expect(res!.grid.usable[c]).toBe(false); // retirée du masque donné aux moteurs
        } else if (grid.water![c]) {
          touchesSea = true;
        }
      }
    }
    expect(touchesSea).toBe(true);
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
