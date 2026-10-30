import { describe, expect, it } from "vitest";
import { normaliserConfiguration, nouvelleConfiguration, nouvelleIle, provinceDe } from "./configuration";
import { fertilitesDeLaProvince } from "./fertilites";
import { depotEnMemoire, lireExport } from "./stockage";

// Données vérifiées : Gisement de fer 4049 (mine du Latium et d'Albion), olives 2210 (Latium),
// orge 2212 (Albion), or 32027 (mine ET rivière du Latium), salicorne 2218 (côte d'Albion).
const FER = "4049", OLIVES = "2210", ORGE = "2212", OR = "32027";

describe("configuration d'un monde", () => {
  it("une configuration neuve, une île neuve : inconnue, sans rôle imposé", () => {
    const c = nouvelleConfiguration("  Partie avec Ethan ", new Date("2026-10-30T10:00:00Z"));
    expect(c.nom).toBe("Partie avec Ethan");
    expect(c.creeLe).toBe("2026-10-30T10:00:00.000Z");
    const i = nouvelleIle("celtic_island_large_02");
    expect(i).toMatchObject({ ileId: "celtic_island_large_02", propriete: "inconnue", role: "auto", fertilites: [] });
    expect(provinceDe(i)).toBe("Celtic");
    expect(nouvelleIle("roman_island_large_02").cle).not.toBe(i.cle);
  });

  it("la normalisation écarte le reste : île inconnue, fertilité inconnue, valeurs hors domaine", () => {
    const c = normaliserConfiguration({
      id: "m1", nom: "", iles: [
        { cle: "a", ileId: "roman_island_large_03", propriete: "moi", role: "principale", fertilites: [OLIVES, "999999", OLIVES], libelle: "  Roma " },
        { cle: "a", ileId: "celtic_island_small_03", propriete: "pirate", role: "chef", fertilites: null },
        { cle: "b", ileId: "ile_qui_n_existe_pas" },
        "n'importe quoi",
      ], extra: 1,
    });
    expect(c).not.toBeNull();
    expect(c!.nom).toBe("Sans nom");
    expect(c!.iles).toHaveLength(2);
    expect(c!.iles[0]).toEqual({ cle: "a", ileId: "roman_island_large_03", libelle: "Roma", propriete: "moi", role: "principale", fertilites: [OLIVES] });
    expect(c!.iles[1]).toMatchObject({ ileId: "celtic_island_small_03", propriete: "inconnue", role: "auto", fertilites: null });
    expect(c!.iles[1].cle).not.toBe("a"); // clé en double : renouvelée
    expect(normaliserConfiguration({ nom: "sans id" })).toBeNull();
    expect(normaliserConfiguration("texte")).toBeNull();
  });

  it("le dépôt en mémoire : enregistre des copies, liste les plus récentes d'abord", async () => {
    const d = depotEnMemoire();
    const a = { ...nouvelleConfiguration("A"), modifieLe: "2026-10-30T09:00:00.000Z" };
    const b = { ...nouvelleConfiguration("B"), modifieLe: "2026-10-30T11:00:00.000Z" };
    await d.enregistrer(a);
    await d.enregistrer(b);
    a.nom = "modifiée après coup";
    expect((await d.lister()).map((c) => c.nom)).toEqual(["B", "A"]);
    await d.supprimer(b.id);
    expect((await d.lister()).map((c) => c.nom)).toEqual(["A"]);
  });

  it("un fichier d'export : une configuration ou une liste, et rien d'un fichier abîmé", () => {
    const c = nouvelleConfiguration("Export");
    expect(lireExport(JSON.stringify(c))).toHaveLength(1);
    expect(lireExport(JSON.stringify([c, { id: "x" }, 3]))).toHaveLength(2);
    expect(lireExport("{pas du json")).toEqual([]);
  });
});

describe("fertilités proposées, par province", () => {
  const plat = (p: string) => fertilitesDeLaProvince(p).flatMap((g) => g.fertilites.map((f) => `${g.categorie}:${f.guid}`));

  it("chaque province ne propose que ses fertilités", () => {
    expect(plat("Roman")).toContain(`terre:${OLIVES}`);
    expect(plat("Roman")).not.toContain(`terre:${ORGE}`);
    expect(plat("Celtic")).toContain(`terre:${ORGE}`);
    expect(plat("Celtic")).not.toContain(`terre:${OLIVES}`);
    expect(plat("Roman")).toContain(`montagne:${FER}`);
    expect(plat("Celtic")).toContain(`montagne:${FER}`);
  });

  it("l'or du Latium apparaît dans les mines et dans la rivière", () => {
    expect(plat("Roman")).toEqual(expect.arrayContaining([`montagne:${OR}`, `riviere:${OR}`]));
  });

  it("les groupes suivent l'ordre du jeu : terrestres, maritimes, minières, rivière", () => {
    expect(fertilitesDeLaProvince("Roman").map((g) => g.categorie).slice(0, 4)).toEqual(["terre", "cote", "montagne", "riviere"]);
  });
});
