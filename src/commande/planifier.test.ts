import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { makeLookup, roadConnected, rootedRoadSet } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { economy } from "../economy/economy";
import { lotsDeProduction } from "./production";
import { planifierCommande, resumer } from "./planifier";
import type { Commande } from "./nomenclature";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const grille = (id: string) => downscaleGrid(buildIslandGrid(id)!);

// GUIDs vérifiés : Plébéiens 1496 ; Boulangerie g3174, Moulin g3075, Ferme de céréales g2693 ;
// Mine de fer g2918 (montagne) ; Cabane de pêcheur g2955 (côtier).
const PLEBEIENS = "1496";
const BOULANGERIE = "g3174", MOULIN = "g3075", FERME = "g2693", MINE_FER = "g2918", PECHEUR = "g2955";

/** Aucun chevauchement entre bâtiments, champs et routes, et tout bâtiment relié au comptoir. */
function verifier(p: ReturnType<typeof planifierCommande>) {
  const W = p.layout.grid.w;
  const pris = new Set<number>();
  let chevauchements = 0;
  const prendre = (c: number) => { if (pris.has(c)) chevauchements++; pris.add(c); };
  for (const b of p.layout.buildings) {
    const fp = footprintSize(lookup(b.defId)!, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) prendre((b.y + j) * W + b.x + i);
  }
  for (const f of p.layout.fields) prendre(f.y * W + f.x);
  for (const r of p.layout.roads) prendre(r.y * W + r.x);
  const { set, hasRoot } = rootedRoadSet(p.layout, lookup);
  const coupes = p.layout.buildings.filter((b) => !roadConnected(p.layout, lookup, b, set)).map((b) => lookup(b.defId)?.name);
  return { chevauchements, hasRoot, coupes };
}

describe("lots de production", () => {
  it("une chaîne reste ensemble, ce qui n'échange rien est séparé", () => {
    const lots = lotsDeProduction([
      { defId: BOULANGERIE, count: 2 }, { defId: MOULIN, count: 1 }, { defId: FERME, count: 2 },
      { defId: MINE_FER, count: 1 },
    ]);
    const pain = lots.find((l) => l.some((x) => x.defId === BOULANGERIE))!;
    expect(pain.map((x) => x.defId).sort()).toEqual([BOULANGERIE, FERME, MOULIN].sort());
    expect(lots.find((l) => l.some((x) => x.defId === MINE_FER))).toHaveLength(1);
  });
});

describe("planifier une commande : quartiers et production sur la même île", () => {
  it("100 Plébéiens et la chaîne du pain : tout servi, tout relié", () => {
    const c: Commande = {
      region: "Roman", maisons: [{ tierGuid: PLEBEIENS, maisons: 100 }],
      production: [{ defId: BOULANGERIE, count: 2 }], completerProduction: true,
    };
    const p = planifierCommande(grille("roman_island_medium_01"), c, catalog, lookup);
    expect(p.manques).toEqual([]);
    expect(p.servi).toBe(true);
    for (const id of [BOULANGERIE, MOULIN, FERME]) {
      const l = p.lignes.find((x) => x.defId === id)!;
      expect(l.pose).toBe(l.demande);
    }
    expect(verifier(p)).toEqual({ chevauchements: 0, hasRoot: true, coupes: [] });
  });

  it("production seule : mines sur la montagne, pêcheurs sur la côte, chacun avec son entrepôt", () => {
    // Mesuré : la seconde mine partait vers l'emplacement le plus proche à vol d'oiseau, de
    // l'autre côté d'un bras de mer, sans route possible, puis était retirée faute d'entrepôt.
    const c: Commande = {
      region: "Roman", maisons: [],
      production: [{ defId: MINE_FER, count: 2 }, { defId: BOULANGERIE, count: 2 }, { defId: PECHEUR, count: 2 }],
      completerProduction: true,
    };
    const p = planifierCommande(grille("roman_island_large_03"), c, catalog, lookup);
    expect(p.manques).toEqual([]);
    for (const id of [MINE_FER, PECHEUR]) expect(p.lignes.find((x) => x.defId === id)?.pose).toBe(2);
    expect(p.production.entrepots).toBeGreaterThan(0);
    expect(verifier(p)).toEqual({ chevauchements: 0, hasRoot: true, coupes: [] });
  });

  it("une commande trop grosse pour un seul entrepôt est découpée, pas refusée", () => {
    // Avant : un panier de quinze bâtiments sans lien de chaîne était refusé en bloc —
    // « aucun entrepôt sous 30 en distance-rue ».
    const quinze = catalog
      .filter((d) => d.region === "Roman" && !d.slotType && d.placement !== "water"
        && (economy.buildingProd[d.id]?.outputs?.length ?? 0) > 0)
      .slice(0, 15)
      .map((d) => ({ defId: d.id, count: 1 }));
    const p = planifierCommande(grille("roman_island_large_03"), { region: "Roman", maisons: [], production: quinze }, catalog, lookup);
    const poses = p.lignes.filter((l) => l.role === "production").reduce((s, l) => s + l.pose, 0);
    expect(poses).toBe(15);
    expect(verifier(p).chevauchements).toBe(0);
  });
});

describe("ce qui traverse la frontière du worker", () => {
  it("le résumé se clone, et ne porte ni la zone ni le masque de l'île", () => {
    const c: Commande = { region: "Roman", maisons: [{ tierGuid: PLEBEIENS, maisons: 40 }] };
    const p = planifierCommande(grille("roman_island_medium_01"), c, catalog, lookup);
    const r = structuredClone(resumer(p));
    expect(r.buildings.length).toBe(p.layout.buildings.length);
    expect(r.servi).toBe(p.servi);
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(p).length / 4);
  });
});
