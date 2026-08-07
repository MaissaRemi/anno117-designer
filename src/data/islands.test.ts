import { describe, expect, it } from "vitest";
import rawCatalog from "./catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { islands, regionOfIsland, worldLabel } from "./islands";
import { cityStatusAttrs, cityStatusLadder, economy, residentialChain, residentialChainExtended, worldOf } from "../economy/economy";

const catalog = rawCatalog as unknown as BuildingDef[];

describe("séparation des mondes (Latium / Albion)", () => {
  it("toute île est rattachée à un monde, d'après sa région DÉCLARÉE", () => {
    // Régression : la région était devinée par `id.includes("celtic")`, ce qui cassait
    // silencieusement sur les îles DLC et sur tout renommage d'asset.
    for (const i of islands) {
      const r = regionOfIsland(i.id);
      expect(["Roman", "Celtic"]).toContain(r);
      if (i.region === "Celtic") expect(r).toBe("Celtic");
      if (i.region === "Roman" || i.region === "DLC") expect(r).toBe("Roman");
    }
  });

  it("une île celtique n'est pas prise pour romaine (et réciproquement)", () => {
    const celtic = islands.find((i) => i.region === "Celtic")!;
    const roman = islands.find((i) => i.region === "Roman")!;
    expect(regionOfIsland(celtic.id)).toBe("Celtic");
    expect(regionOfIsland(roman.id)).toBe("Roman");
  });

  it("identifiant inconnu ou absent : repli sur le Latium, sans exception", () => {
    expect(regionOfIsland(undefined)).toBe("Roman");
    expect(regionOfIsland("inconnue")).toBe("Roman");
  });

  it("chaque monde a EXACTEMENT ses paliers", () => {
    // Régression : `region_of()` testait « roman » avant « celtic », si bien que
    // « Population Level Roman Celtic 02 Merchants » tombait en Latium. Les Mercators et
    // les Nobles sont la population ROMANISÉE d'Albion — leurs services sont le Fanum et le
    // Théâtre bardique, bâtiments celtiques. Ils n'existent pas en Latium.
    const namesOf = (world: string) =>
      economy.tiers.filter((t) => t.residenceId && worldOf(t.region) === world)
        .map((t) => t.name).sort();
    expect(namesOf("Roman")).toEqual(["Equites", "Liberti", "Patriciens", "Plébéiens"]);
    expect(namesOf("Celtic"))
      .toEqual(["Aldermen", "Forgerons", "Mercators", "Nobles", "Tourbiers"]);
  });

  it("les trois cultures sont distinguées, et Albion en héberge deux", () => {
    const cultureOf = (name: string) => economy.tiers.find((t) => t.name === name)?.region;
    expect(cultureOf("Patriciens")).toBe("Roman");
    expect(cultureOf("Aldermen")).toBe("Celtic");
    expect(cultureOf("Mercators")).toBe("RomanCeltic");
    expect(cultureOf("Nobles")).toBe("RomanCeltic");
  });

  it("le rang de cité prend ses seuils du MONDE et ses effets de la CULTURE", () => {
    // L'échelle diffère par monde : 40 rangs jusqu'à 260 000 habitants en Latium, 25 jusqu'à
    // 47 500 en Albion. Lire l'échelle romaine pour une ville celtique appliquait des malus
    // qui n'existent pas à cette population.
    const roman = cityStatusLadder("Roman");
    const celtic = cityStatusLadder("Celtic");
    const last = (l: typeof roman) => l[l.length - 1];
    expect(roman.length).toBeGreaterThan(celtic.length);
    expect(last(roman).population).toBeGreaterThan(last(celtic).population);

    // En Latium une seule culture vit : les trois variantes y sont identiques. En Albion
    // elles divergent — un romanisé encaisse un malus de Bonheur plus lourd qu'un natif.
    const at = (r: string) => cityStatusAttrs(1e9, r).Happiness ?? 0;
    expect(at("Roman")).toBeLessThan(0);
    expect(at("RomanCeltic")).not.toBe(at("Celtic"));
    expect(at("RomanCeltic")).toBeLessThan(at("Celtic"));
  });

  it("Albion : les DEUX lignées sont hébergeables sur une même île", () => {
    // 21 biens celtiques n'ont de producteur que dans la lignée native (Bière, Fromage,
    // Bronze, Granite…), et les carrières comme les mines d'étain réclament des Forgerons.
    // Sans eux, une île visant les Nobles ne peut jamais armer ces bâtiments.
    const nobles = economy.tiers.find((t) => t.name === "Nobles")!;
    const strict = residentialChain(nobles.guid).map((t) => t.name);
    const large = residentialChainExtended(nobles.guid).map((t) => t.name);
    expect(strict).not.toContain("Forgerons");
    expect(large).toContain("Forgerons");
    expect(large).toContain("Mercators");
    // capacité croissante, et jamais au-delà de la cible
    const caps = residentialChainExtended(nobles.guid).map((t) => t.capacityDefault);
    expect([...caps].sort((a, b) => a - b)).toEqual(caps);
    expect(Math.max(...caps)).toBe(nobles.capacityDefault);
  });

  it("Latium : chaîne déjà emboîtée, l'extension n'y change rien", () => {
    const pat = economy.tiers.find((t) => t.name === "Patriciens")!;
    expect(residentialChainExtended(pat.guid).map((t) => t.name))
      .toEqual(residentialChain(pat.guid).map((t) => t.name));
  });

  it("une maison romanisée peut se hisser depuis un palier natif", () => {
    // Il n'existe pas de palier 01 romano-celtique : les Mercators montent des Tourbiers.
    // La chaîne se filtre donc sur le MONDE, pas sur la culture.
    const mercators = economy.tiers.find((t) => t.name === "Mercators")!;
    const chain = residentialChain(mercators.guid).map((t) => t.name);
    expect(chain).toContain("Mercators");
    expect(chain).toContain("Tourbiers");
    expect(chain).not.toContain("Plébéiens");
  });

  it("les deux mondes ont des bâtiments propres, plus un fonds commun", () => {
    const byRegion = (r: string) => catalog.filter((d) => d.region === r);
    expect(byRegion("Roman").length).toBeGreaterThan(0);
    expect(byRegion("Celtic").length).toBeGreaterThan(0);
    // le filtre de l'interface : monde actif + bâtiments sans région
    const shown = (world: string) => catalog.filter((d) => !d.region || d.region === world);
    expect(shown("Roman").length).toBeLessThan(catalog.length);
    expect(shown("Celtic").length).toBeLessThan(catalog.length);
    // aucun bâtiment strictement celtique ne doit apparaître en Latium
    expect(shown("Roman").some((d) => d.region === "Celtic")).toBe(false);
  });

  it("les libellés de monde sont ceux du jeu", () => {
    expect(worldLabel("Roman")).toBe("Latium");
    expect(worldLabel("Celtic")).toBe("Albion");
  });
});
