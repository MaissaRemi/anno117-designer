import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup } from "../engine/rules";
import { solve } from "./solve";
import { dieuDeLAutel, dieuParId, dieux, effetsDuDieu, nomDuDieu, productiviteDuDieu } from "./dieux";
import { nomenclature } from "../commande/nomenclature";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const CERES = "43594", VULCAIN = "144800";
const MOULIN = "g3075", BOULANGERIE = "g3174", PLEBEIENS = "1496", PATRICIENS = "1498";

describe("les dieux tutélaires et leur dévotion", () => {
  it("les huit dieux, nommés comme en jeu, chacun avec ses autels", () => {
    const d = dieux();
    expect(d).toHaveLength(8);
    expect(d.map(nomDuDieu)).toContain("Cérès");
    for (const p of d) {
      expect(p.shrines?.length).toBe(2); // un autel par région
      for (const a of p.shrines!) expect(dieuDeLAutel(a)?.id).toBe(p.id);
    }
  });

  it("sept dieux dopent un groupe d'ateliers lu dans le jeu (Cérès : la chaîne du pain)", () => {
    const dopants = dieux().filter((p) => p.local.some((e) => e.boosted?.length));
    expect(dopants).toHaveLength(7); // Mercure-Lug passe par le commerce passif
    const ceres = effetsDuDieu(dieuParId(CERES)!, 300000);
    expect(ceres.ateliers).toEqual(expect.arrayContaining([MOULIN, BOULANGERIE]));
  });

  it("la dévotion monte les effets par paliers : Cérès à 4 500", () => {
    // productivité : paliers 2 500 → 50, 3 500 → 60, 6 000 → 70 ; population : 4 500 → 3
    const fx = effetsDuDieu(dieuParId(CERES)!, 4500);
    expect(fx.productivitePct).toBe(60);
    expect(fx.residence).toEqual({ Population: 3 });
    expect(fx.autel && fx.merveille).toBe(true);
    expect(fx.dominant).toBe(false);
    expect(effetsDuDieu(dieuParId(CERES)!, 0).productivitePct).toBe(0);
    // Vulcain ne loge personne : il donne de la main-d'œuvre
    const v = effetsDuDieu(dieuParId(VULCAIN)!, 4500);
    expect(v.residence).toEqual({});
    expect(v.mainDoeuvrePct).toBeGreaterThan(0);
  });

  it("la productivité divise le nombre d'ateliers, pas le rapport intrant / produit", () => {
    const opts = { includeProduction: true, includeServices: false, includeWorkforce: false, capacities: {}, region: "Roman", strictWorld: true };
    const cible = [{ tier: PLEBEIENS, pop: 30000 }];
    const sans = solve(cible, opts);
    const avec = solve(cible, { ...opts, productivity: productiviteDuDieu(dieuParId(CERES)!, 4500) });
    expect(avec.productionCounts[MOULIN]).toBeLessThan(sans.productionCounts[MOULIN]);
    expect(avec.productionCounts[MOULIN]).toBeLessThanOrEqual(Math.ceil(sans.productionCounts[MOULIN] / 1.6));
    // les biens demandés ne changent pas : seul le nombre d'ateliers baisse
    expect(avec.goodsPerMin).toEqual(sans.goodsPerMin);
  });

  it("une commande sous Cérès : moins d'ateliers, plus d'habitants, la dévotion suit la Foi", () => {
    const c = { region: "Roman", maisons: [{ tierGuid: PATRICIENS, maisons: 300 }], biensDesMaisons: "produire" as const };
    const sans = nomenclature(c, catalog, lookup);
    const avec = nomenclature({ ...c, dieu: CERES }, catalog, lookup);
    expect(avec.foi).toBeGreaterThan(0);
    expect(avec.dieu?.devotion).toBe(avec.foi);
    expect(avec.dieu?.productivitePct).toBeGreaterThan(0);
    const nb = (n: typeof sans, id: string) => n.lignes.filter((l) => l.defId === id).reduce((s, l) => s + l.nombre, 0);
    expect(nb(avec, BOULANGERIE)).toBeLessThan(nb(sans, BOULANGERIE));
    expect(avec.habitants).toBeGreaterThan(sans.habitants);
    // une dévotion imposée fige l'état de partie
    expect(nomenclature({ ...c, dieu: CERES, devotion: 0 }, catalog, lookup).dieu?.productivitePct).toBe(0);
  });
});
