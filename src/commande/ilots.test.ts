import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, PlacedBuilding } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { makeLookup, roadConnected, rootedRoadSet } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { economy } from "../economy/economy";
import { besoinEnIlots, disposerQuartiers } from "./ilots";
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
    const horsMasqueOk = d.placement === "water" || !!d.slotType || d.template === "AqueductProducer";
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
    const p = disposerQuartiers(grille("roman_island_medium_01"), commande("Roman", PATRICIENS, 300), catalog, lookup);
    expect(p.manques).toEqual([]);
    expect(p.servi).toBe(true);
    expect(p.maisonsParPalier[PATRICIENS]).toBe(300);
    // Mesuré : 7 100 à 7 300 cases. Le premier essai sur `planLattice` en prenait 21 800.
    expect(p.zone.cases).toBeLessThan(9_000);
    expect(p.qualite.pct.residence).toBeGreaterThan(30);
    expect(p.qualite.pct.roads).toBeLessThan(20);
    for (const n of ["Forum", "Temple", "Amphithéâtre"]) {
      expect(p.lignes.find((l) => l.nom === n)?.pose).toBe(1);
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
