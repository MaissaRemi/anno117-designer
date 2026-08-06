import { describe, expect, it } from "vitest";
import rawCatalog from "./catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { islands, regionOfIsland, WORLDS, worldLabel } from "./islands";
import { economy } from "../economy/economy";

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

  it("les deux mondes ont des paliers résidentiels distincts", () => {
    for (const w of WORLDS) {
      const t = economy.tiers.filter((x) => x.residenceId && x.region === w.region);
      expect(t.length).toBeGreaterThan(0);
    }
    const roman = new Set(economy.tiers.filter((t) => t.region === "Roman").map((t) => t.guid));
    const celtic = economy.tiers.filter((t) => t.region === "Celtic").map((t) => t.guid);
    for (const g of celtic) expect(roman.has(g)).toBe(false);
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
