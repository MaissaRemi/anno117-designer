import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { makeLookup, roadConnected, rootedRoadSet } from "../engine/rules";
import { mainOeuvrePosee, planifierCommande } from "./planifier";
import type { Commande } from "./nomenclature";

/**
 * L'ÎLE DE PRODUCTION SUR DE VRAIES CARTES — la vérification de la conception
 * (`docs/superpowers/specs/2026-10-30-ile-de-production-design.md`) : un objectif simple, de deux
 * biens, sur trois îles du Latium et trois d'Albion, une branche par bien. Tout doit être posé,
 * relié au comptoir, et le débit demandé atteint.
 *
 * Chaque monde, et en Albion chaque branche, a ses propres bâtiments (GUIDs vérifiés dans
 * economy.generated) : Latium, Pain g3174 (Plébéiens) et Tuniques g3187 (Liberti) ; Albion
 * branche celte, Bière g5570 (Forgerons) et Tuniques g5958 (Tourbiers) ; Albion branche
 * romanisée, Pain g5960 et Saucisses g5959 (Mercators).
 */

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const PAIN = "2137", TUNIQUES = "2141", BIERE = "2154", SAUCISSES = "8405";

const CAS: { ile: string; region: string; branche: string; objectif: Commande["objectif"] }[] = [
  { ile: "roman_island_small_02", region: "Roman", branche: "Latium", objectif: [{ good: PAIN, parMinute: 6 }, { good: TUNIQUES, parMinute: 4 }] },
  { ile: "roman_island_medium_01", region: "Roman", branche: "Latium", objectif: [{ good: PAIN, parMinute: 10 }, { good: TUNIQUES, parMinute: 6 }] },
  { ile: "roman_island_large_03", region: "Roman", branche: "Latium", objectif: [{ good: PAIN, parMinute: 20 }, { good: TUNIQUES, parMinute: 10 }] },
  { ile: "celtic_island_medium_01", region: "Celtic", branche: "celte", objectif: [{ good: BIERE, parMinute: 6 }, { good: TUNIQUES, parMinute: 6 }] },
  { ile: "celtic_island_large_02", region: "Celtic", branche: "romanisée", objectif: [{ good: PAIN, parMinute: 8 }, { good: SAUCISSES, parMinute: 4 }] },
  { ile: "celtic_island_small_03", region: "Celtic", branche: "romanisée", objectif: [{ good: PAIN, parMinute: 4 }, { good: SAUCISSES, parMinute: 2 }] },
];

describe("île de production sur de vraies cartes", () => {
  for (const c of CAS) {
    it(`${c.ile} (${c.branche}) : tout posé, relié, débit atteint`, () => {
      const commande: Commande = { region: c.region, maisons: [], objectif: c.objectif, routes: "pavee" };
      const p = planifierCommande(downscaleGrid(buildIslandGrid(c.ile)!), commande, catalog, lookup);
      const { set, hasRoot } = rootedRoadSet(p.layout, lookup);
      expect(hasRoot).toBe(true);
      const coupes = p.layout.buildings.filter((b) => !roadConnected(p.layout, lookup, b, set)).map((b) => lookup(b.defId)?.name);
      expect(coupes).toEqual([]);
      expect(p.manques).toEqual([]);
      // la main-d'œuvre de ce qui est POSÉ est logée, pas seulement celle du devis
      expect(Object.keys(p.mainOeuvre.demande).length).toBeGreaterThan(0);
      expect(p.mainOeuvre.manque).toEqual({});
      for (const o of p.objectif) {
        expect(o.produit, o.nom).toBe(o.parMinute);
        expect(o.pose, o.nom).toBe(o.parMinute);
      }
      // aucun bâtiment de l'autre monde
      for (const b of p.layout.buildings) {
        const r = lookup(b.defId)?.region;
        if (r) expect(r, lookup(b.defId)?.name).toBe(c.region);
      }
    });
  }

  it("la main-d'œuvre se compte sur ce qui est posé : un atelier sans maison manque d'ouvriers", () => {
    // g3174 : la boulangerie du Latium
    const boulangerie = { uid: "b", defId: "g3174", x: 0, y: 0, rotation: 0 as const, locked: false };
    const [palier, n] = Object.entries(mainOeuvrePosee([boulangerie], {}).manque)[0];
    expect(n).toBeGreaterThan(0);
    // assez d'habitants de ce palier : plus rien ne manque
    expect(mainOeuvrePosee([boulangerie], { [palier]: 10_000 }).manque).toEqual({});
    // le réglage d'entretien de la partie alourdit ce que le bâtiment réclame
    expect(mainOeuvrePosee([boulangerie], {}, 1.22).manque[palier]).toBeGreaterThan(n);
  });
});
