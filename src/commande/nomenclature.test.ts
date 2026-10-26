import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup } from "../engine/rules";
import { worldOf } from "../economy/economy";
import { copiesPourCouvrir, nomenclature, type Commande } from "./nomenclature";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

// GUIDs vérifiés : paliers romains Plébéiens 1496, Patriciens 1498 ; Nobles 1504 (Albion).
// Boulangerie g3174, Moulin à grains g3075, Ferme de céréales g2693 (lot parfait du pain :
// 2 boulangeries, 1 moulin, 2 fermes — cf. plan du panier de blueprints).
const PATRICIENS = "1498", PLEBEIENS = "1496", NOBLES = "1504";
const BOULANGERIE = "g3174", MOULIN = "g3075", FERME_CEREALES = "g2693";

const devis = (c: Partial<Commande>) => nomenclature({ region: "Roman", maisons: [], ...c }, catalog, lookup);
const ligne = (n: ReturnType<typeof devis>, defId: string) => n.lignes.find((l) => l.defId === defId);

describe("nomenclature d'une commande", () => {
  it("300 maisons de Patriciens : les maisons, une recette, les institutions, un comptoir", () => {
    const n = devis({ maisons: [{ tierGuid: PATRICIENS, maisons: 300 }] });
    const res = n.lignes.filter((l) => l.role === "residence");
    expect(res).toHaveLength(1);
    expect(res[0].nombre).toBe(300);
    expect(n.paliers).toEqual([expect.objectContaining({ demande: "Patriciens", atteint: "Patriciens" })]);
    expect(n.habitants).toBe(300 * n.paliers[0].capacite);
    expect(n.lignes.filter((l) => l.role === "service").length).toBeGreaterThan(0);
    expect(n.lignes.filter((l) => l.role === "institution").length).toBeGreaterThan(0);
    expect(n.lignes.filter((l) => l.role === "comptoir")).toHaveLength(1);
    // un bâtiment unique n'est jamais commandé en plusieurs exemplaires
    for (const l of n.lignes) if (lookup(l.defId)?.unique) expect(l.nombre).toBe(1);
    expect(n.avertissements).toEqual([]);
  });

  it("la recette complète pose plus de types de services et loge plus par maison", () => {
    const min = devis({ maisons: [{ tierGuid: PATRICIENS, maisons: 300 }] });
    const tout = devis({ maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], services: "complet" });
    const types = (n: typeof min) => n.lignes.filter((l) => l.role === "service").length;
    expect(types(tout)).toBeGreaterThan(types(min));
    expect(tout.paliers[0].capacite).toBeGreaterThan(min.paliers[0].capacite);
  });

  it("le panier se pose tel quel, et sa complétion est un geste explicite", () => {
    const seul = devis({ maisons: [{ tierGuid: PLEBEIENS, maisons: 40 }], production: [{ defId: BOULANGERIE, count: 2 }] });
    expect(ligne(seul, BOULANGERIE)?.nombre).toBe(2);
    expect(ligne(seul, MOULIN)).toBeUndefined();

    const complet = devis({
      maisons: [{ tierGuid: PLEBEIENS, maisons: 40 }],
      production: [{ defId: BOULANGERIE, count: 2 }], completerProduction: true,
    });
    expect(ligne(complet, BOULANGERIE)).toMatchObject({ nombre: 2, raison: "demandé" });
    expect(ligne(complet, MOULIN)).toMatchObject({ nombre: 1, raison: "complète une chaîne demandée" });
    expect(ligne(complet, FERME_CEREALES)).toMatchObject({ nombre: 2 });
  });

  it("produire les biens des maisons : rien de l'autre monde, et la main-d'œuvre est logée", () => {
    const n = devis({ maisons: [{ tierGuid: PATRICIENS, maisons: 100 }], biensDesMaisons: "produire" });
    for (const l of n.lignes) {
      const reg = lookup(l.defId)?.region;
      if (reg) expect(worldOf(reg)).toBe("Roman");
    }
    expect(n.lignes.some((l) => l.role === "production")).toBe(true);
    expect(n.lignes.some((l) => l.role === "ouvriers")).toBe(true);
    expect(n.mainOeuvre.manque).toEqual({});
    // un bien qu'aucun bâtiment romain ne produit part à l'import au lieu de tirer une chaîne
    expect(n.biens.some((b) => b.source === "import")).toBe(true);
    expect(n.biens.some((b) => b.source === "produit")).toBe(true);
  });

  it("main-d'œuvre « signaler » : aucune maison ajoutée, le manque est dit", () => {
    const n = devis({
      maisons: [{ tierGuid: PATRICIENS, maisons: 100 }], biensDesMaisons: "produire", mainOeuvre: "signaler",
    });
    expect(n.lignes.some((l) => l.role === "ouvriers")).toBe(false);
    expect(Object.keys(n.mainOeuvre.manque).length).toBeGreaterThan(0);
    expect(n.avertissements.some((a) => /manquante/.test(a))).toBe(true);
  });

  it("un palier de l'autre monde est écarté et signalé", () => {
    const n = devis({ region: "Celtic", maisons: [{ tierGuid: PATRICIENS, maisons: 10 }, { tierGuid: NOBLES, maisons: 50 }] });
    expect(n.paliers.map((p) => p.demande)).toEqual(["Nobles"]);
    expect(n.avertissements.some((a) => a.includes("Patriciens"))).toBe(true);
  });

  it("une commande trop grande pour l'île est signalée", () => {
    const n = devis({ maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], terre: 1000 });
    expect(n.surface.total).toBeGreaterThan(1000);
    expect(n.avertissements.some((a) => a.includes("1000 de terre"))).toBe(true);
  });

  it("est déterministe : deux appels identiques rendent la même nomenclature", () => {
    const c: Partial<Commande> = { maisons: [{ tierGuid: PATRICIENS, maisons: 120 }], biensDesMaisons: "produire" };
    expect(devis(c)).toEqual(devis(c));
  });
});

describe("copies pour couvrir une zone", () => {
  it("un bâtiment unique : une copie quelle que soit la surface", () => {
    const unique = catalog.find((d) => d.unique && (d.streetRange || d.radius?.range))!;
    expect(copiesPourCouvrir(unique, 1_000_000)).toBe(1);
  });
  it("croît avec la surface, au moins une", () => {
    const taverne = lookup("g3528")!;
    expect(copiesPourCouvrir(taverne, 10)).toBe(1);
    expect(copiesPourCouvrir(taverne, 20_000)).toBeGreaterThan(copiesPourCouvrir(taverne, 5_000));
  });
});
