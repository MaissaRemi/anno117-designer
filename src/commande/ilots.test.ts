import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, PlacedBuilding } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { computeRadiusCoverage, makeLookup, roadConnected, rootedRoadSet } from "../engine/rules";
import { copiesEnTrop } from "../optimizer/doublons";
import { footprintSize } from "../engine/geometry";
import { economy } from "../economy/economy";
import { besoinEnIlots, disposerQuartiers, routeVersReseau } from "./ilots";
import type { Commande } from "./nomenclature";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const grille = (id: string) => downscaleGrid(buildIslandGrid(id)!);
const nomme = (n: string) => catalog.find((d) => d.name === n && (!d.region || d.region === "Roman"))!;
const RESIDENCES = new Set(economy.tiers.map((t) => t.residenceId).filter(Boolean));

// GUIDs vérifiés : Patriciens 1498, Nobles 1504.
const PATRICIENS = "1498", NOBLES = "1504";

/** Les règles qu'un plan doit tenir quel que soit son contenu : rien ne se chevauche, rien
 *  n'est bâti hors de l'île, et chaque bâtiment qui en a besoin rejoint le comptoir. */
function verifierPlan(p: ReturnType<typeof disposerQuartiers>) {
  const { layout } = p;
  const W = layout.grid.w;
  const pris = new Map<number, string>();
  let chevauchements = 0, horsTerre = 0;
  for (const b of layout.buildings) {
    const d = lookup(b.defId)!;
    const fp = footprintSize(d, b.rotation);
    const horsMasqueOk = d.placement === "water" || !!d.slotType || d.template === "AqueductProducerSlot";
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const c = (b.y + j) * W + b.x + i;
      if (pris.has(c)) chevauchements++;
      pris.set(c, b.uid);
      if (!layout.grid.usable[c] && !horsMasqueOk) horsTerre++;
    }
  }
  for (const r of layout.roads) if (pris.has(r.y * W + r.x)) chevauchements++;
  const { set, hasRoot } = rootedRoadSet(layout, lookup);
  const coupes = layout.buildings.filter((b: PlacedBuilding) => !roadConnected(layout, lookup, b, set));
  return { chevauchements, horsTerre, hasRoot, coupes: coupes.map((b) => lookup(b.defId)?.name) };
}

describe("îlots : combien d'îlots fusionner pour un bâtiment", () => {
  it("un petit service tient dans un îlot, un gros en fusionne plusieurs", () => {
    expect(besoinEnIlots(nomme("Puits"))).toMatchObject({ k: 1, m: 1 });
    // 19 × 11 : tourné, il tient dans une colonne de trois îlots plutôt que dans un carré de quatre
    const temple = besoinEnIlots(nomme("Temple"));
    expect(temple).toMatchObject({ k: 1, m: 3, rot: 90 });
    const amphi = besoinEnIlots(nomme("Amphithéâtre"));
    expect(amphi.k * amphi.m).toBe(12);
  });
});

describe("disposer une commande en quartiers", () => {
  const commande = (region: string, tierGuid: string, maisons: number): Commande =>
    ({ region, maisons: [{ tierGuid, maisons }] });

  it("300 Patriciens sur roman_island_medium_01 : servis, compacts, une copie par grand service", () => {
    // Routes pavées, le défaut de l'interface. En terre, depuis que la montagne et la rivière
    // sont à leur vraie place, la ville tient dans l'isthme étroit de l'île et le Forum n'y
    // reçoit pas d'eau (une seule source sert la moitié nord) : limite connue du routage.
    const p = disposerQuartiers(grille("roman_island_medium_01"),
      { ...commande("Roman", PATRICIENS, 300), routes: "pavee" }, catalog, lookup);
    expect(p.manques).toEqual([]);
    expect(p.servi).toBe(true);
    expect(p.maisonsParPalier[PATRICIENS]).toBe(300);
    // Mesuré : 7 100 à 7 300 cases. Le premier essai sur `planLattice` en prenait 21 800.
    expect(p.zone.cases).toBeLessThan(9_000);
    expect(p.qualite.pct.residence).toBeGreaterThan(30);
    expect(p.qualite.pct.roads).toBeLessThan(20);
    // L'Amphithéâtre est unique. Forum et Temple : un, ou deux sur une ville étirée — à leur
    // vraie place, montagne et rivière cantonnent la ville à l'isthme de l'île (mesuré : un
    // Forum, deux Temples). Jamais les 6 Forums et 7 Temples du premier essai.
    expect(p.lignes.find((l) => l.nom === "Amphithéâtre")?.pose).toBe(1);
    for (const n of ["Forum", "Temple"]) {
      expect(p.lignes.find((l) => l.nom === n)?.pose).toBeGreaterThanOrEqual(1);
      expect(p.lignes.find((l) => l.nom === n)?.pose).toBeLessThanOrEqual(2);
    }
    const v = verifierPlan(p);
    expect(v).toEqual({ chevauchements: 0, horsTerre: 0, hasRoot: true, coupes: [] });
  });

  it("200 Nobles sur celtic_island_large_07 : servis, et rien d'un autre monde", () => {
    const p = disposerQuartiers(grille("celtic_island_large_07"), commande("Celtic", NOBLES, 200), catalog, lookup);
    expect(p.servi).toBe(true);
    for (const b of p.layout.buildings) {
      const r = lookup(b.defId)?.region;
      if (r) expect(r).toBe("Celtic");
    }
    expect(verifierPlan(p).coupes).toEqual([]);
  });

  it("le plan ne contient que les maisons commandées : aucun excédent", () => {
    const p = disposerQuartiers(grille("roman_island_large_03"), commande("Roman", PATRICIENS, 120), catalog, lookup);
    const maisons = p.layout.buildings.filter((b) => RESIDENCES.has(b.defId)).length;
    expect(maisons).toBe(120);
  });

  it("une commande trop grande pour l'île le DIT, chiffré, au lieu de se prétendre servie", () => {
    // Mesuré : 300 Nobles ne tiennent pas en îlots sur `celtic_island_small_01`, une île
    // découpée de bras de mer.
    const p = disposerQuartiers(grille("celtic_island_small_01"), commande("Celtic", NOBLES, 300), catalog, lookup);
    expect(p.servi).toBe(false);
    expect(p.manques.some((m) => /non logée/.test(m))).toBe(true);
    expect(verifierPlan(p).chevauchements).toBe(0);
  });

  it("est déterministe : mêmes positions pour la même commande", () => {
    const g = grille("roman_island_medium_01");
    const pos = (p: ReturnType<typeof disposerQuartiers>) =>
      p.layout.buildings.map((b) => `${b.defId}@${b.x},${b.y},${b.rotation}`).sort();
    const a = disposerQuartiers(g, commande("Roman", PATRICIENS, 150), catalog, lookup);
    const b = disposerQuartiers(g, commande("Roman", PATRICIENS, 150), catalog, lookup);
    expect(pos(a)).toEqual(pos(b));
    expect(a.layout.roads.length).toBe(b.layout.roads.length);
  });
});

describe("services sans doublons", () => {
  // Juge INDÉPENDANT du placeur : la couverture de l'éditeur (`computeRadiusCoverage`), au type
  // de route du plan. Une copie dont toutes les maisons sont vues par une autre copie du même
  // type n'apporte rien à personne.
  it("routes pavées : aucune copie en trop, et bien moins de services que sur la terre", () => {
    // Une île qui loge les 300 maisons : roman_island_small_06, surtout rocheuse, n'y suffit
    // plus depuis que la montagne n'est plus constructible. Mesuré : 45 services en pavé, 100
    // en terre.
    const grid = grille("roman_island_large_03");
    const commande = (routes: "terre" | "pavee"): Commande =>
      ({ region: "Roman", maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], routes });
    const pave = disposerQuartiers(grid, commande("pavee"), catalog, lookup);
    const terre = disposerQuartiers(grid, commande("terre"), catalog, lookup);
    const nbServices = (p: typeof pave) => p.layout.buildings.filter((b) => {
      const d = lookup(b.defId)!;
      return !RESIDENCES.has(b.defId) && !!d.streetRange;
    }).length;
    expect(nbServices(pave)).toBeLessThan(nbServices(terre) * 0.7);

    const layout = { ...pave.layout, roadType: "pavee" as const };
    const cov = computeRadiusCoverage(layout, lookup);
    const maisons = layout.buildings.filter((b) => RESIDENCES.has(b.defId));
    const cases = maisons.map((m) => {
      const fp = footprintSize(lookup(m.defId)!, m.rotation);
      const out: string[] = [];
      for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) out.push(`${m.x + i},${m.y + j}`);
      return out;
    });
    const parType = new Map<string, PlacedBuilding[]>();
    for (const b of layout.buildings) {
      if (RESIDENCES.has(b.defId) || !lookup(b.defId)?.streetRange) continue;
      parType.set(b.defId, [...(parType.get(b.defId) ?? []), b]);
    }
    for (const [defId, copies] of parType) {
      const vues = copies.map((b) => {
        const s = cov.get(b.uid) ?? new Set<string>();
        return cases.flatMap((cs, i) => (cs.some((c) => s.has(c)) ? [i] : []));
      });
      expect(copiesEnTrop(vues, maisons.length), lookup(defId)!.name).toEqual([]);
    }
  });
});

describe("corridors d'eau", () => {
  // Un corridor ajoute une voie libre entre deux routes : sans ponts, la ville serait coupée en
  // bandes et chaque bande perdrait le comptoir. On les force sur une ville moyenne.
  it("forcés : la voie reste libre, les ponts gardent toute la ville reliée au comptoir", () => {
    // l'espacement réel (4) sur une île assez large : sur l'isthme de medium_01, les deux
    // rangées de plus par corridor ne laissent plus la place aux 300 maisons
    const p = disposerQuartiers(grille("roman_island_large_03"),
      { region: "Roman", maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], routes: "pavee" }, catalog, lookup, { corridors: 4 });
    expect(verifierPlan(p)).toEqual({ chevauchements: 0, horsTerre: 0, hasRoot: true, coupes: [] });
    expect(p.maisonsParPalier[PATRICIENS]).toBe(300);
  });
});

describe("route du comptoir et aqueducs", () => {
  // Grille 9 × 9 : comptoir 2 × 2 en bas, route en haut (y = 0), conduite horizontale en y = 4.
  const grid = { w: 9, h: 9, usable: new Array(81).fill(true) };
  const routes = Array.from({ length: 9 }, (_, x) => ({ x, y: 0 }));
  const comptoir = { x: 3, y: 7, w: 2, h: 2 };
  it("franchit une conduite perpendiculaire, tout droit", () => {
    const conduite = Array.from({ length: 9 }, (_, x) => ({ x, y: 4 }));
    const chemin = routeVersReseau(grid, comptoir, [], routes, conduite, lookup);
    expect(chemin).not.toBeNull();
    // la case franchie est sur la conduite, et ses deux voisines du chemin sont au-dessus et au-dessous
    const franchie = chemin!.find((c) => c.y === 4)!;
    expect(chemin!.some((c) => c.x === franchie.x && c.y === 3)).toBe(true);
    expect(chemin!.some((c) => c.x === franchie.x && c.y === 5)).toBe(true);
  });
  it("ne longe jamais une conduite : seule une traversée à angle droit est permise", () => {
    // seule la colonne x = 3 est praticable, et une conduite la parcourt dans sa longueur
    const colonne = { w: 9, h: 9, usable: Array.from({ length: 81 }, (_, c) => c % 9 === 3) };
    const conduite = Array.from({ length: 6 }, (_, k) => ({ x: 3, y: 1 + k }));
    expect(routeVersReseau(colonne, { x: 3, y: 7, w: 1, h: 1 }, [], routes, conduite, lookup)).toBeNull();
  });
});

describe("routes pavées : la ville reste reliée au comptoir", () => {
  // Données du patch 200 : la recette des Patriciens prend la Citerne, l'aqueduc longe alors le
  // bas de la ville et coupait le chemin du comptoir (300 maisons sans accès).
  it("300 Patriciens sur roman_island_medium_01", () => {
    const p = disposerQuartiers(grille("roman_island_medium_01"),
      { region: "Roman", maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], routes: "pavee" }, catalog, lookup);
    expect(verifierPlan(p)).toEqual({ chevauchements: 0, horsTerre: 0, hasRoot: true, coupes: [] });
    expect(p.manques).toEqual([]);
  });
});
