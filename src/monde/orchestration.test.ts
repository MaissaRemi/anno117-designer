import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import type { IslandPlanResult } from "../optimizer/islandPlan";
import type { ResultatCommande } from "../commande/planifier";
import { nouvelleConfiguration, nouvelleIle, type ConfigurationMonde, type IleDuMonde } from "./configuration";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { makeLookup } from "../engine/rules";
import { calculerMonde, capaciteCote, conseillerPrincipales, reaffecterMines, VERSION_CALCUL, type Executeurs, type IleCalculee } from "./calcul";

/**
 * L'ORCHESTRATION DU CALCUL D'UN MONDE, avec des moteurs FACTICES : une île principale demande
 * 10 pains et 4 bières par minute, une île de production pose exactement ce qu'on lui demande.
 * On vérifie la reprise par empreinte et les suggestions d'achat sans payer les vrais moteurs
 * (le test de bout en bout, lourd, est `calcul.test.ts`).
 */

const catalog = rawCatalog as unknown as BuildingDef[];
// Pain 2137 (Latium et Albion), Bière 2154 (Albion seulement, orge 2212).
const PAIN = "2137", BIERE = "2154", ORGE = "2212";

function factices() {
  const appels = { principale: 0, production: 0 };
  const executeurs: Executeurs = {
    principale: async () => {
      appels.principale++;
      return {
        importGoods: [{ good: PAIN, name: "Pain", perMin: 10 }, { good: BIERE, name: "Bière", perMin: 4 }],
        exploited: [], residents: 1000, houses: 50, money: { gross: 600, upkeep: 100, net: 500 }, tierName: "Patriciens",
        buildings: [], roads: [], fields: [], aqueducts: [], gaps: [],
      } as unknown as IslandPlanResult;
    },
    production: async (req) => {
      appels.production++;
      return {
        objectif: (req.commande.objectif ?? []).map((ob) => ({ ...ob, nom: "", produit: ob.parMinute, pose: ob.parMinute, chaine: [] })),
        nomenclature: { biens: [] }, imports: [], habitants: 100, maisonsParPalier: { x: 5 },
        argent: { impots: 80, entretien: 30, net: 50 },
        buildings: [], roads: [], fields: [], aqueducts: [], manques: [], avertissements: [],
      } as unknown as ResultatCommande;
    },
  };
  return { appels, executeurs };
}

const ile = (ileId: string, extra: Partial<IleDuMonde>): IleDuMonde => ({ ...nouvelleIle(ileId), propriete: "moi", ...extra });

function monde(...iles: IleDuMonde[]): ConfigurationMonde {
  const c = nouvelleConfiguration("Orchestration");
  // réglages de la partie au cran Faible : les chiffres des moteurs factices passent tels quels
  c.reglages = { ...c.reglages, consommation: "faible", entretien: "faible" };
  c.iles = iles;
  return c;
}

describe("orchestration du calcul d'un monde", () => {
  it("tout est couvert : la bière vient d'Albion, le pain du Latium ou d'Albion, aucun manque", async () => {
    const { executeurs } = factices();
    const c = monde(
      ile("roman_island_medium_01", { role: "principale" }),
      ile("roman_island_large_03", { fertilites: [] }),
      ile("celtic_island_large_02", { fertilites: [ORGE] }),
    );
    const r = await calculerMonde(c, { catalog, executeurs });
    expect(r.deficits).toEqual([]);
    const albion = c.iles[2].cle, principale = c.iles[0].cle;
    expect(r.flux).toContainEqual(expect.objectContaining({ de: albion, vers: principale, good: BIERE, parMinute: 4 }));
    expect(r.flux.filter((f) => f.good === PAIN && f.vers === principale).reduce((s, f) => s + f.parMinute, 0)).toBeCloseTo(10, 1);
    // l'argent des îles de production compte : 50 par île posée, en plus des 500 de la principale
    const posees = r.iles.filter((i) => i.role === "production").length;
    expect(posees).toBe(2);
    expect(r.bilan).toMatchObject({ habitants: 1200, argent: 500 + 50 * posees });
    expect(r.suggestions).toEqual([]);
  });

  it("les réglages de la partie : consommation ×1,25, entretien ×1,22 au cran Moyen", async () => {
    const { executeurs } = factices();
    const c = monde(
      ile("roman_island_medium_01", { role: "principale" }),
      ile("roman_island_large_03", { fertilites: [] }),
      ile("celtic_island_large_02", { fertilites: [ORGE] }),
    );
    c.reglages = { ...c.reglages, consommation: "moyen", entretien: "moyen" };
    const r = await calculerMonde(c, { catalog, executeurs });
    const principale = r.iles.find((i) => i.role === "principale")!;
    expect(principale.consomme).toContainEqual({ good: BIERE, parMinute: 5 });
    // principale : 600 d'impôts − 100 × 1,22 ; production : 80 − 30 × 1,22 (arrondi) par île
    expect(principale.argent).toBe(478);
    expect(r.iles.filter((i) => i.role === "production").every((i) => i.argent === 43)).toBe(true);
    expect(r.flux.filter((f) => f.good === BIERE).reduce((s, f) => s + f.parMinute, 0)).toBeCloseTo(5, 1);
  });

  it("le calcul suivant reprend les îles inchangées, et ne recalcule que ce qui a changé", async () => {
    const { appels, executeurs } = factices();
    const c = monde(
      ile("roman_island_medium_01", { role: "principale" }),
      ile("celtic_island_large_02", { fertilites: [ORGE] }),
    );
    const r1 = await calculerMonde(c, { catalog, executeurs });
    expect(appels).toEqual({ principale: 1, production: 1 });
    const r2 = await calculerMonde(c, { catalog, executeurs, precedent: r1 });
    expect(appels).toEqual({ principale: 1, production: 1 });
    expect(r2.reutilisees).toBe(2);
    expect(r2.recalculees).toBe(0);
    expect(r2.bilan).toEqual(r1.bilan);
    // un dieu sur l'île principale : elle seule est recalculée (sa demande factice ne change pas)
    c.iles[0].dieu = "43594";
    const r3 = await calculerMonde(c, { catalog, executeurs, precedent: r2 });
    expect(appels).toEqual({ principale: 2, production: 1 });
    expect(r3.recalculees).toBe(1);
  });

  it("un plan posé par une autre version des moteurs n'est pas repris", async () => {
    const { appels, executeurs } = factices();
    const c = monde(
      ile("roman_island_medium_01", { role: "principale" }),
      ile("celtic_island_large_02", { fertilites: [ORGE] }),
    );
    const r1 = await calculerMonde(c, { catalog, executeurs });
    const ancien = { ...r1, iles: r1.iles.map((i) => ({ ...i, empreinte: i.empreinte?.replace(`"v":${VERSION_CALCUL}`, `"v":${VERSION_CALCUL - 1}`) })) };
    const r2 = await calculerMonde(c, { catalog, executeurs, precedent: ancien });
    expect(appels).toEqual({ principale: 2, production: 2 });
    expect(r2.reutilisees).toBe(0);
  });

  it("les mines d'une île principale extraient ce qui manque au monde, pas ce qui se vend le plus cher", () => {
    // Gisement d'or 32027, gisement minéral 4053 ; minerai d'or 31697, minéraux 8563.
    const OR = "32027", MINERAL = "4053", MINERAI_OR = "31697", MINERAUX = "8563";
    const lookup = makeLookup(catalog);
    const def = (nom: string) => catalog.find((d) => d.name === nom && d.region === "Roman")!;
    const c = monde(ile("roman_island_medium_01", { role: "principale", fertilites: [OR, MINERAL] }));
    const principale: IleCalculee = {
      cle: c.iles[0].cle, role: "principale", habitants: 1000, maisons: 50, argent: 500,
      plan: { buildings: [{ uid: "mine", defId: def("Mine d'or").id, x: 0, y: 0, rotation: 0, locked: false }], roads: [], fields: [], aqueducts: [] },
      produit: [{ good: MINERAI_OR, parMinute: 0.4 }], consomme: [], affecte: [], manques: [], avertissements: [],
    };
    // le monde manque de minéraux : la mine d'or devient une carrière de minéraux, au même endroit
    const [r] = reaffecterMines([principale], { [MINERAUX]: 2 }, c, catalog, lookup);
    expect(r.plan!.buildings[0]).toMatchObject({ uid: "mine", defId: def("Carrière de minéraux").id, x: 0, y: 0 });
    expect(r.produit).toEqual([{ good: MINERAUX, parMinute: 1.33 }]);
    // repartir du résultat redonne le même : le recalcul d'un monde est stable
    expect(reaffecterMines([r], { [MINERAUX]: 2 }, c, catalog, lookup)[0].produit).toEqual(r.produit);
    // rien ne manque : le choix du moteur reste
    expect(reaffecterMines([principale], {}, c, catalog, lookup)[0]).toBe(principale);
    // gisement minéral non déclaré sur l'île : pas d'échange
    const sansGisement = monde({ ...c.iles[0], fertilites: [OR] });
    expect(reaffecterMines([principale], { [MINERAUX]: 2 }, sansGisement, catalog, lookup)[0]).toBe(principale);
  });

  it("la côte d'une île accueille un nombre compté de bâtiments côtiers, lu sur sa carte", () => {
    const grille = downscaleGrid(buildIslandGrid("roman_island_large_02")!);
    const def = (nom: string) => catalog.find((d) => d.name === nom && d.region === "Roman")!;
    // mesuré le 11/11/2026 ; la pose en tient 77 à 86 % (`COTE_TENUE`)
    expect(capaciteCote(grille, def("Marais salants"))).toBe(15);
    expect(capaciteCote(grille, def("Cabane de pêcheur"))).toBe(25);
    // un bâtiment de terre n'a pas de capacité côtière
    expect(capaciteCote(grille, def("Bûcheron"))).toBe(0);
  });

  it("conseille l'île principale : chaque île à moi essayée seule, classée selon l'objectif de la partie", async () => {
    // moteur factice : les habitants suivent la terre de l'île, les gains vont à l'inverse
    const executeurs: Executeurs = {
      principale: async (req) => {
        const terre = req.grid.usable.filter(Boolean).length;
        return {
          importGoods: [], exploited: [], residents: terre, houses: Math.round(terre / 100),
          money: { gross: 1_000_000 - terre, upkeep: 0, net: 1_000_000 - terre }, tierName: "Patriciens",
          buildings: [], roads: [], fields: [], aqueducts: [], gaps: [],
        } as unknown as IslandPlanResult;
      },
      production: async () => { throw new Error("le conseil ne pose aucune île de production"); },
    };
    const c = monde(
      ile("roman_island_small_02", {}),
      ile("roman_island_large_03", {}),
      ile("roman_island_medium_01", {}),
      ile("celtic_island_large_02", { propriete: "achetable" }),
    );
    const [petite, grande, moyenne] = c.iles.map((i) => i.cle);
    c.reglages = { ...c.reglages, objectif: "habitants" };
    const parHabitants = await conseillerPrincipales(c, { catalog, executeurs });
    // seulement mes îles, la plus peuplée d'abord
    expect(parHabitants.map((x) => x.cle)).toEqual([grande, moyenne, petite]);
    expect(parHabitants[0].valeur).toBe(parHabitants[0].habitants);
    c.reglages = { ...c.reglages, objectif: "argent" };
    const parGains = await conseillerPrincipales(c, { catalog, executeurs });
    expect(parGains.map((x) => x.cle)).toEqual([petite, moyenne, grande]);
  });

  it("une bière que personne ne produit : l'île achetable d'Albion qui a l'orge est proposée, jamais celle d'un adversaire", async () => {
    const { executeurs } = factices();
    const c = monde(
      ile("roman_island_medium_01", { role: "principale" }),
      ile("roman_island_large_03", { fertilites: [] }),
      ile("celtic_island_large_04", { propriete: "indisponible", fertilites: [ORGE] }),
      ile("celtic_island_medium_01", { propriete: "achetable", fertilites: [ORGE] }),
      ile("roman_island_small_02", { propriete: "inconnue", fertilites: null }),
    );
    const r = await calculerMonde(c, { catalog, executeurs });
    expect(r.deficits).toEqual([expect.objectContaining({ good: BIERE, parMinute: 4 })]);
    expect(r.deficits[0].raison).toMatch(/aucune de tes îles/);
    expect(r.suggestions?.map((s) => s.cle)).toEqual([c.iles[3].cle]);
    expect(r.suggestions![0]).toMatchObject({ total: 4, part: 1, fertilitesInconnues: false });
    // l'île réclamerait les biens de ses ouvriers, mais rapporte bien plus qu'elle ne coûte
    expect(r.suggestions![0].enRetour).toBeLessThan(r.suggestions![0].total);
  });
});
