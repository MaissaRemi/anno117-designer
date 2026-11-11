import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup } from "../engine/rules";
import { besoinsDuDevis, cumulerBudgets, devisIle, fertilitesPourMoteur, repartir, type IleProductrice, type OptionsRepartition } from "./repartition";

const catalog = rawCatalog as unknown as BuildingDef[];
const o: OptionsRepartition = { catalog, lookup: makeLookup(catalog), routes: "pavee", productiviteGlobale: 0 };

// Données vérifiées : Pain 2137 (Latium et Albion), Bière 2154 (Albion seulement, orge 2212),
// Fer 2115 (fonderie sans fertilité), Minerai de fer 2080 (Gisement de fer 4049, montagne).
const PAIN = "2137", BIERE = "2154", FER = "2115", MINERAI = "2080";
const ile = (cle: string, region: string, fertilites: string[] | null, terre = 20_000, emplacements: Record<string, number> = { mountain: 4 }): IleProductrice =>
  ({ cle, region, fertilites: fertilitesPourMoteur(fertilites), emplacements, terre, cote: 3000 });

describe("répartir la demande d'un monde", () => {
  it("un bien que seule l'autre province produit va sur une île de cette province", () => {
    const r = repartir({ [PAIN]: 10, [BIERE]: 4 }, [ile("latium", "Roman", ["4049"]), ile("albion", "Celtic", ["2212"])], o);
    expect(r.affectation.albion?.some((b) => b.good === BIERE)).toBe(true);
    expect(r.affectation.latium?.some((b) => b.good === BIERE) ?? false).toBe(false);
    expect(r.nonCouvert).toEqual([]);
  });

  it("sans île capable, le bien reste non couvert, avec sa raison", () => {
    const r = repartir({ [BIERE]: 4 }, [ile("latium", "Roman", [])], o);
    expect(r.affectation).toEqual({});
    expect(r.nonCouvert).toEqual([expect.objectContaining({ good: BIERE, parMinute: 4 })]);
    expect(r.nonCouvert[0].raison).toMatch(/aucune de tes îles/);
  });

  it("une liste vide veut dire « aucune fertilité » : le minerai s'importe, il devient un besoin", () => {
    const sans = ile("sans", "Roman", []);
    const n = devisIle(sans, [{ good: FER, parMinute: 10 }], o);
    expect(besoinsDuDevis(n)).toEqual(expect.arrayContaining([expect.objectContaining({ good: MINERAI, parMinute: 10 })]));
    const avec = ile("avec", "Roman", ["4049"], 20_000, { mountain: 5 }); // 10 fers = 5 mines
    expect(besoinsDuDevis(devisIle(avec, [{ good: FER, parMinute: 10 }], o)).some((b) => b.good === MINERAI)).toBe(false);
  });

  it("le rattrapage ne redonne pas les emplacements déjà pris, et n'écarte une île que pour le bien manqué", () => {
    // 10 fers = 5 mines : l'île a ses 5 emplacements de montagne pris après la première passe
    const mine = ile("mine", "Roman", ["4049"], 20_000, { mountain: 5 });
    const r1 = repartir({ [MINERAI]: 10 }, [mine], o);
    expect(r1.affectation.mine).toEqual([expect.objectContaining({ good: MINERAI })]);
    expect(r1.placesUtilisees.mine.mountain).toBeCloseTo(5, 1);
    // seconde passe, budgets de la première transmis : plus un seul emplacement
    const r2 = repartir({ [MINERAI]: 4 }, [mine], o, r1);
    expect(r2.affectation).toEqual({});
    // sans eux, l'ancienne passe redonnait les mêmes emplacements
    expect(repartir({ [MINERAI]: 4 }, [mine], o, { terreUtilisee: r1.terreUtilisee }).affectation.mine).toBeDefined();
    // les budgets de deux passes se cumulent
    expect(cumulerBudgets(r1, r1).placesUtilisees.mine.mountain).toBeCloseTo(10, 1);
    // écartée pour le minerai seulement : le pain lui reste ouvert
    const r3 = repartir({ [MINERAI]: 2, [PAIN]: 5 }, [ile("mixte", "Roman", ["4049"])], o, {}, new Set([`mixte|${MINERAI}`]));
    expect(r3.affectation.mixte.map((b) => b.good)).toEqual([PAIN]);
  });

  it("la place manque : le bien se partage entre îles, puis le reste est signalé", () => {
    const petite = (cle: string) => ile(cle, "Roman", [], 900);
    const r = repartir({ [PAIN]: 30 }, [petite("a"), petite("b")], o);
    const total = Object.values(r.affectation).flat().reduce((s, b) => s + b.parMinute, 0);
    expect(Object.keys(r.affectation).length).toBe(2);
    expect(total).toBeLessThan(30);
    expect(r.nonCouvert[0]).toMatchObject({ good: PAIN });
    expect(r.nonCouvert[0].raison).toMatch(/place/);
  });
});
