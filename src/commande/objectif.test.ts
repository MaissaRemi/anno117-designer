import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup } from "../engine/rules";
import { economy, tierByGuid, worldOf } from "../economy/economy";
import { nomenclature, type Commande } from "./nomenclature";

/**
 * L'OBJECTIF DE PRODUCTION : des biens et leur débit → les bâtiments de leurs chaînes.
 * Conception : `docs/superpowers/specs/2026-10-30-ile-de-production-design.md`.
 */

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

// Données vérifiées (economy.generated) : Boulangerie g3174 1 pain/min, Moulin g3075 3 farines/min
// (1 blé chacune), Ferme de céréales g2693 1 blé/min, sans fertilité. Fonderie g3070 1 fer/min
// (1 minerai), Mine de fer g2918 2 minerais/min, montagne, Gisement de fer 4049. Albion : Pain
// g5960 (Mercators, branche romanisée), Bière g5570 (Forgerons, branche celte). Cérès 43594 dope
// les trois bâtiments du pain, +150 % à 300 000 de dévotion.
const PAIN = "2137", FARINE = "2119", FER = "2115", MINERAI_FER = "2080", BIERE = "2154";
const BOULANGERIE = "g3174", MOULIN = "g3075", FERME = "g2693", FONDERIE = "g3070", MINE_FER = "g2918";
const CERES = "43594";

const devis = (c: Partial<Commande>) => nomenclature({ region: "Roman", maisons: [], ...c }, catalog, lookup);
const nombre = (n: ReturnType<typeof devis>, defId: string) =>
  n.lignes.filter((l) => l.defId === defId && l.role === "production").reduce((s, l) => s + l.nombre, 0);

describe("objectif de production", () => {
  it("10 pains par minute : la chaîne par ratios exacts, arrondie au supérieur, et ses ouvriers", () => {
    const n = devis({ objectif: [{ good: PAIN, parMinute: 10 }] });
    expect(nombre(n, BOULANGERIE)).toBe(10);
    expect(nombre(n, MOULIN)).toBe(4); // 10 / 3
    expect(nombre(n, FERME)).toBe(10);
    expect(n.objectif).toEqual([expect.objectContaining({ good: PAIN, parMinute: 10, produit: 10 })]);
    expect(new Set(n.objectif[0].chaine)).toEqual(new Set([BOULANGERIE, MOULIN, FERME]));
    expect(n.imports).toEqual([]);
    // personne n'est commandé : les maisons sont celles des ouvriers de la chaîne
    expect(n.lignes.some((l) => l.role === "ouvriers")).toBe(true);
    expect(n.lignes.filter((l) => l.role === "comptoir")).toHaveLength(1);
  });

  it("Cérès à 300 000 de dévotion : +150 % sur les trois bâtiments du pain", () => {
    const n = devis({ objectif: [{ good: PAIN, parMinute: 10 }], dieu: CERES, devotion: 300_000 });
    expect(nombre(n, BOULANGERIE)).toBe(4); // 10 / 2,5
    expect(nombre(n, MOULIN)).toBe(2); // 10 / 7,5
    expect(nombre(n, FERME)).toBe(4);
  });

  it("la productivité saisie s'additionne : globale, puis par atelier", () => {
    expect(nombre(devis({ objectif: [{ good: PAIN, parMinute: 10 }], productivite: { globale: 50 } }), BOULANGERIE)).toBe(7);
    const n = devis({ objectif: [{ good: PAIN, parMinute: 10 }], productivite: { globale: 50, parAtelier: { [BOULANGERIE]: 50 } } });
    expect(nombre(n, BOULANGERIE)).toBe(5); // +100 %
    expect(nombre(n, MOULIN)).toBe(3); // 10 / 4,5
    // avec Cérès : +150 % du dieu et +50 % saisis = ×3
    const c = devis({ objectif: [{ good: PAIN, parMinute: 12 }], dieu: CERES, devotion: 300_000, productivite: { globale: 50 } });
    expect(nombre(c, BOULANGERIE)).toBe(4);
  });

  it("deux biens d'une même chaîne : la farine est cumulée AVANT l'arrondi", () => {
    const n = devis({ objectif: [{ good: PAIN, parMinute: 10 }, { good: FARINE, parMinute: 2 }] });
    expect(nombre(n, MOULIN)).toBe(4); // 10/3 + 2/3 = 4, et non 4 + 1
    expect(nombre(n, BOULANGERIE)).toBe(10);
    expect(n.objectif.map((o) => o.good).sort()).toEqual([FARINE, PAIN].sort());
  });

  it("un gisement non déclaré : la matière part à l'import, avec sa raison", () => {
    const n = devis({ objectif: [{ good: FER, parMinute: 10 }], fertilites: ["0"] });
    expect(nombre(n, FONDERIE)).toBe(10);
    expect(nombre(n, MINE_FER)).toBe(0);
    expect(n.imports).toEqual([expect.objectContaining({ good: MINERAI_FER, parMinute: 10 })]);
    expect(n.imports[0].raison).toMatch(/non déclaré/);
    // déclaré : produit sur place
    const ok = devis({ objectif: [{ good: FER, parMinute: 10 }], fertilites: ["4049"] });
    expect(nombre(ok, MINE_FER)).toBe(5);
    expect(ok.imports).toEqual([]);
  });

  it("trop peu d'emplacements de montagne : ce qui tient est produit, le reste importé", () => {
    const n = devis({ objectif: [{ good: FER, parMinute: 10 }], emplacements: { mountain: 2 } });
    expect(nombre(n, MINE_FER)).toBe(2);
    expect(nombre(n, FONDERIE)).toBe(10);
    expect(n.imports).toEqual([expect.objectContaining({ good: MINERAI_FER, parMinute: 6 })]);
    expect(n.imports[0].raison).toMatch(/montagne/);
    // assez d'emplacements : rien d'importé
    expect(devis({ objectif: [{ good: FER, parMinute: 10 }], emplacements: { mountain: 5 } }).imports).toEqual([]);
  });

  it("un bien qu'aucun bâtiment de ce monde ne produit est importé, et le joueur est prévenu", () => {
    const n = devis({ objectif: [{ good: BIERE, parMinute: 4 }] });
    expect(n.lignes.filter((l) => l.role === "production")).toEqual([]);
    expect(n.imports).toEqual([expect.objectContaining({ good: BIERE, parMinute: 4 })]);
    expect(n.avertissements.join(" ")).toMatch(/ne peut pas être produit/);
  });

  it("Albion : seulement des bâtiments d'Albion, et les ouvriers de la branche du bâtiment", () => {
    const ouvriers = (n: ReturnType<typeof devis>) => n.lignes.filter((l) => l.role === "ouvriers")
      .map((l) => [...economy.tiers].find((t) => t.residenceId === l.defId)!.guid);
    const biere = devis({ region: "Celtic", objectif: [{ good: BIERE, parMinute: 4 }] });
    const pain = devis({ region: "Celtic", objectif: [{ good: PAIN, parMinute: 4 }] });
    for (const n of [biere, pain]) {
      const prod = n.lignes.filter((l) => l.role === "production");
      expect(prod.length).toBeGreaterThan(0);
      for (const l of prod) expect(worldOf(lookup(l.defId)!.region!)).toBe(worldOf("Celtic"));
      expect(n.avertissements.filter((a) => a.includes("autre monde"))).toEqual([]);
    }
    expect(nombre(pain, "g5960")).toBe(4);
    expect(nombre(pain, BOULANGERIE)).toBe(0);
    expect(ouvriers(biere).map((g) => tierByGuid(g)!.name)).toContain("Forgerons");
    expect(ouvriers(pain).map((g) => tierByGuid(g)!.name)).toContain("Mercators");
  });
});
