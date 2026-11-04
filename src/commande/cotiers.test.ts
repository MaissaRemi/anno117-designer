import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup, terrainConvient } from "../engine/rules";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { planifierCommande } from "./planifier";

/**
 * LES BÂTIMENTS CÔTIERS SE POSENT — le quai à terre, la partie dans l'eau sur l'eau, le reste
 * de l'emprise sur l'un ou l'autre (`partieQuai`, `terrainConvient`).
 *
 * Avant le 04/11/2026 le moteur exigeait la terre partout hors de l'eau : les marais salants
 * (eau 5 × 4 dans une emprise 9 × 5, une colonne et une rangée libres au large) et le ramasseur
 * de coques (une colonne libre au large) ne se posaient sur AUCUNE île — donc ni sel ni garum,
 * ni coques en Albion. GUIDs vérifiés : Marais salants g2957 (Latium), Ramasseur de coques
 * g5278 (Albion), Garum 2139.
 */

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const SALINE = "g2957", COQUES = "g5278", GARUM = "2139";

const poses = (ile: string, region: string, defId: string, count: number) => {
  const p = planifierCommande(downscaleGrid(buildIslandGrid(ile)!), { region, maisons: [], production: [{ defId, count }] }, catalog, lookup);
  return p.lignes.find((l) => l.defId === defId)?.pose ?? 0;
};

describe("bâtiments côtiers", () => {
  it("le quai est lu pour chaque bâtiment à partie dans l'eau, sauf les merveilles", () => {
    const cotiers = catalog.filter((d) => d.partieEau);
    const sansQuai = cotiers.filter((d) => !d.partieQuai).map((d) => d.name);
    expect(sansQuai.sort()).toEqual(["Phare de Pharos", "Statue de Zeus Ombrios"].sort());
  });

  it("le reste de l'emprise peut être au large : les marais salants se posent contre une côte droite", () => {
    // une côte verticale : terre à gauche (x < 5), eau constructible à droite
    const W = 20, H = 12;
    const usable = Array.from({ length: W * H }, (_, c) => c % W < 5);
    const water = usable.map((u) => !u);
    const grid = { w: W, h: H, usable, water };
    const saline = lookup(SALINE)!;
    // quai x 0→2 à terre, eau x 3→7, colonne 8 au large : tout le bâtiment posé en x = 2
    expect(terrainConvient(grid, saline, 2, 0, 0, 1)).toBe(true);
    // trop dans les terres : la partie dans l'eau tomberait sur la terre
    expect(terrainConvient(grid, saline, 0, 0, 0, 1)).toBe(false);
    // trop au large : le quai tomberait dans l'eau
    expect(terrainConvient(grid, saline, 4, 0, 0, 1)).toBe(false);
  });

  it("sur de vraies îles : des marais salants au Latium, des ramasseurs de coques en Albion", () => {
    expect(poses("roman_island_medium_01", "Roman", SALINE, 6)).toBeGreaterThan(0);
    expect(poses("roman_island_large_03", "Roman", SALINE, 6)).toBeGreaterThan(0);
    expect(poses("celtic_island_large_02", "Celtic", COQUES, 6)).toBeGreaterThan(0);
    expect(poses("celtic_island_medium_01", "Celtic", COQUES, 6)).toBeGreaterThan(0);
  }, 300_000);

  it("le garum se produit enfin : sel et ateliers posés", () => {
    const p = planifierCommande(downscaleGrid(buildIslandGrid("roman_island_medium_01")!),
      { region: "Roman", maisons: [], objectif: [{ good: GARUM, parMinute: 6 }] }, catalog, lookup);
    expect(p.objectif.find((o) => o.good === GARUM)!.pose).toBeGreaterThan(0);
  }, 300_000);
});
