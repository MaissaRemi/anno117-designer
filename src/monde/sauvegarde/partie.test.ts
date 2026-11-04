import { describe, expect, it } from "vitest";
import { configurationDepuisPartie, joueursDeLaPartie, lirePartie, type PartieLue } from "./partie";
import { normaliserConfiguration } from "../configuration";
import { sansEmplacementsInactifs } from "../calcul";
import { buildIslandGrid } from "../../data/islandGrid";
import type { GridShape } from "../../model/types";

/**
 * Sur une vraie sauvegarde de Rémi, si elle est sur la machine (sinon le test est sauté : les
 * sauvegardes ne sont pas versionnées). Valeurs relevées le 04/11/2026 avec `tools/filedb.py`,
 * et propriétaires vérifiés dans assets.xml (41 = Profile_Human_00).
 */
// modules chargés par chaîne : le projet n'embarque pas les types de Node
type NodeFs = { existsSync(p: string): boolean; readFileSync(p: string): Uint8Array };
const nodeFs = "node:fs";
const { existsSync, readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as NodeFs;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SAUVEGARDE = `${env.USERPROFILE ?? env.HOME ?? ""}/Documents/Anno 117 - Pax Romana/accounts/`
  + "0f3603e1-11b0-4b81-b124-ece069cc3d61/Maximilia Maxima/Maximilia Maxima 1.a8s";

describe.skipIf(!existsSync(SAUVEGARDE))("import d'une vraie sauvegarde (Maximilia Maxima)", () => {
  it("lit les îles des deux provinces, leurs fertilités et leurs propriétaires", async () => {
    const t0 = performance.now();
    const p = await lirePartie(new Uint8Array(readFileSync(SAUVEGARDE)));
    const duree = performance.now() - t0;
    // 24 îles au Latium, 16 en Albion ; comptoirs tiers et décors écartés
    expect(p.iles.filter((i) => i.ileId.startsWith("roman_")).length).toBe(24);
    expect(p.iles.filter((i) => i.ileId.startsWith("celtic_")).length).toBe(16);
    expect(p.inconnues).toEqual([]);

    const continentale = p.iles.find((i) => i.ileId === "roman_dlc01_island_continental_01")!;
    expect(continentale.proprietaire).toBe(41);
    expect(continentale.rotation).toBe(0);
    expect(continentale.fertilites.sort()).toEqual(["2205", "2208", "2209", "32027", "4049", "4062", "8577"]);

    const l05 = p.iles.find((i) => i.ileId === "celtic_island_large_05")!;
    expect(l05.proprietaire).toBeUndefined();
    expect(l05.rotation).toBe(1);
    expect(l05.position).toEqual({ x: 536, y: 544 });
    expect(l05.fertilites.sort()).toEqual(["2202", "2212", "2217", "4049", "8432", "8487"]);

    expect(p.iles.find((i) => i.ileId === "celtic_island_large_07")!.proprietaire).toBe(31101);
    // à moi : 7 au Latium, 3 en Albion
    expect(p.iles.filter((i) => i.proprietaire === 41).length).toBe(10);

    const c = normaliserConfiguration(configurationDepuisPartie("Maximilia Maxima 1", p))!;
    expect(c.iles.length).toBe(40);
    expect(c.iles.filter((i) => i.propriete === "moi").length).toBe(10);
    expect(c.iles.find((i) => i.ileId === "celtic_island_large_05")).toMatchObject({ propriete: "achetable", rotation: 1 });
    expect(c.iles.find((i) => i.ileId === "celtic_island_large_07")!.propriete).toBe("indisponible");
    // emplacements : Grande 05 d'Albion a 6 emplacements de montagne tirés au hasard, 2 activés
    // (ses deux gisements, argent et fer) ; les 6 fixes et les 8 de marais le sont tous
    expect(l05.emplacementsInactifs.length).toBe(4);
    const grille = buildIslandGrid("celtic_island_large_05")!;
    const montagnes = (g: GridShape) => (g.slots ?? []).filter((x) => x.type === "mountain").length;
    expect(montagnes(grille)).toBe(12);
    expect(montagnes(sansEmplacementsInactifs(grille, l05.emplacementsInactifs))).toBe(8);
    console.log(`sauvegarde lue en ${Math.round(duree)} ms`);
  }, 60_000);
});

describe("partie à plusieurs", () => {
  const partie: PartieLue = {
    inconnues: [],
    iles: [
      { ileId: "roman_island_medium_01", rotation: 0, position: { x: 0, y: 0 }, fertilites: [], proprietaire: 41, emplacementsInactifs: [] },
      { ileId: "roman_island_large_03", rotation: 2, position: { x: 9, y: 9 }, fertilites: ["2209"], proprietaire: 600070, emplacementsInactifs: [] },
      { ileId: "celtic_island_large_02", rotation: 1, position: { x: 5, y: 5 }, fertilites: [], proprietaire: 31101, emplacementsInactifs: [] },
      { ileId: "celtic_island_medium_01", rotation: 3, position: { x: 1, y: 1 }, fertilites: [], emplacementsInactifs: [] },
    ],
  };

  it("liste les joueurs humains qui ont des îles, pas les rivaux", () => {
    expect(joueursDeLaPartie(partie)).toEqual([
      { guid: 41, libelle: "Joueur 1", iles: 1 },
      { guid: 600070, libelle: "Joueur 3", iles: 1 },
    ]);
  });

  it("les îles du joueur choisi sont à moi, les autres joueurs sont des adversaires", () => {
    const c = configurationDepuisPartie("Multi", partie, 600070);
    expect(c.iles.map((i) => i.propriete)).toEqual(["indisponible", "moi", "indisponible", "achetable"]);
    expect(c.iles.map((i) => i.rotation)).toEqual([0, 2, 1, 3]);
    expect(configurationDepuisPartie("Seul", partie).iles[0].propriete).toBe("moi");
  });
});
