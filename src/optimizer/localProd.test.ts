import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { priceOf } from "../economy/economy";
import { VITAL_ATTRS } from "../economy/attributes";

const catalog = rawCatalog as unknown as BuildingDef[];
const t4 = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
const plan = (localProduction: boolean) =>
  planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, localProduction });

describe("production finale sur l'île", () => {
  const off = plan(false);
  const on = plan(true);

  it("option désactivée : aucun atelier, comportement inchangé", () => {
    expect(off.workshops).toEqual([]);
  });

  it("option activée : des ateliers sont posés et le manifeste d'import baisse", () => {
    expect(on.workshops.length).toBeGreaterThan(0);
    for (const w of on.workshops) {
      expect(w.copies).toBeGreaterThan(0);
      expect(w.perMin).toBeGreaterThan(0);
    }

    // Le gain se mesure en VALEUR, pas en tonnage. Un atelier ne supprime pas un besoin, il
    // le DÉPLACE en amont : produire des tuniques sur place, c'est cesser d'importer des
    // tuniques et commencer à importer de la laine. Le tonnage total peut donc monter — il
    // le fait, mesuré 155,7 → 158,4 u/min — parce qu'une recette consomme souvent plus
    // d'unités qu'elle n'en produit. Ce qu'on économise, c'est la valeur ajoutée.
    const value = (r: typeof off) => r.importGoods.reduce((a, g) => a + g.perMin * priceOf(g.good), 0);
    expect(value(on)).toBeLessThan(value(off));

    // et les biens finis produits ici pèsent moins au manifeste qu'avant
    for (const w of on.workshops) {
      const before = off.importGoods.find((g) => g.good === w.good)?.perMin ?? 0;
      const after = on.importGoods.find((g) => g.good === w.good)?.perMin ?? 0;
      if (before > 0) expect(after).toBeLessThan(before);
    }
  });

  it("les intrants des ateliers sont AU MANIFESTE, ou produits sur place", () => {
    // Régression : seule la moitié du bilan était comptée — le bien fini disparaissait du
    // manifeste, son intrant n'y entrait jamais. Le manifeste promettait une île qui
    // n'aurait pas tourné.
    const produced = new Set(on.workshops.map((w) => w.good));
    for (const w of on.workshops) {
      for (const inp of w.inputs) {
        const imported = on.importGoods.find((g) => g.good === inp.good)?.perMin ?? 0;
        // soit l'intrant est acheminé, soit un atelier amont le fabrique ici
        expect(imported > 0 || produced.has(inp.good)).toBe(true);
      }
    }
  });

  it("LA RÈGLE D'ARRÊT : le bilan de l'île reste positif", () => {
    expect(on.viable).toBe(true);
    for (const k of VITAL_ATTRS) expect(on.attrsTotal[k]).toBeGreaterThanOrEqual(0);
  });

  it("le budget d'attributs est bien CONSOMMÉ (sinon la règle ne servirait à rien)", () => {
    // au moins un attribut vital doit avoir baissé : les ateliers coûtent quelque chose
    const spent = VITAL_ATTRS.some((k) => (on.attrsTotal[k] ?? 0) < (off.attrsTotal[k] ?? 0));
    expect(spent).toBe(true);
  });

  it("les maisons rasées sortent VRAIMENT du plan et des compteurs", () => {
    // L'assertion d'origine était « activer la production locale fait BAISSER la population ».
    // Elle ne tient plus, et c'est un progrès : depuis que le plan réserve le sol des ateliers
    // et les y épingle, le quartier se bâtit autour au lieu d'être démoli, et l'option ne coûte
    // plus rien — mesuré 25 001 habitants avec, contre 24 953 sans.
    //
    // Ce qui doit rester vrai, c'est la COMPTABILITÉ : une maison rasée disparaît du plan et
    // de son palier. On la vérifie donc directement, dans le plan lui-même.
    const razed = new Set(on.workshops.flatMap((w) => w.razed));
    const uids = new Set(on.buildings.map((b) => b.uid));
    for (const u of razed) expect(uids.has(u)).toBe(false);
    expect(Object.values(on.tierCounts).reduce((a, b) => a + b, 0)).toBe(on.houses);
    expect(on.residents).toBeGreaterThan(0);
  });

  it("les ateliers cherchent le TERRAIN LIBRE avant de raser, et le plan leur en RÉSERVE", () => {
    // Régression : la spirale de placement partait du barycentre des maisons et retenait la
    // PREMIÈRE position tenable — or « tenable » incluait les cases occupées par des
    // résidences, qu'elle rasait. Le moteur bulldozait donc le centre-ville plutôt que
    // d'aller chercher du vide quelques tuiles plus loin.
    //
    // Mesuré sur cette île, à cette configuration : 69 maisons rasées pour 26 copies
    // d'atelier (2,65 par copie) contre 42 pour 40 copies (1,05) une fois le terrain libre
    // essayé d'abord — soit 23 263 → 24 046 habitants, et 14 copies d'atelier de plus, le
    // budget d'attributs n'étant plus mangé par les maisons détruites.
    //
    // Le seuil porte sur le RATIO, pas sur un compte absolu : le nombre d'ateliers posés
    // dépend du budget, mais une copie qui trouve du vide n'emporte aucune maison.
    //
    // Seconde étape, mesuree sur roman_island_medium_01 en plan complet : chercher le vide ne
    // suffit pas la ou il en manque. Le plan rejoue alors sa recette gagnante sur une grille
    // ou le sol des ateliers est RETIRE du masque constructible, et les y EPINGLE — le
    // quartier se batit autour au lieu d'etre demoli. 70 maisons rasees -> 7, et 17 266 ->
    // 17 608 habitants. Sans l'epinglage les ateliers se reinstallent ailleurs et rasent de
    // nouveau : la reservation seule ne ramenait les demolitions qu'a 59, gain nul.
    const lost = on.workshops.reduce((a, w) => a + w.razed.length, 0);
    const copies = on.workshops.reduce((a, w) => a + w.copies, 0);
    expect(copies).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(copies * 1.5);
  });

  it("aucun chevauchement avec le reste du plan", () => {
    const occ = new Set<string>();
    const byId = new Map(catalog.map((d) => [d.id, d]));
    for (const b of on.buildings) {
      const d = byId.get(b.defId)!;
      const w = b.rotation === 90 || b.rotation === 270 ? d.size.h : d.size.w;
      const h = b.rotation === 90 || b.rotation === 270 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = `${b.x + i},${b.y + j}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
      }
    }
  });
});
