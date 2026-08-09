import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { economy, worldOf } from "../economy/economy";
import { institutionDefs, pickPatron, SHRINE_TYPE } from "../economy/attributes";
import { DEFAULT_PERMITS, SHRINE_PERMIT, uniqueCap } from "../economy/uniques";
import { regionOfIsland } from "../data/islands";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const autelAny = catalog.find((d) => d.uniqueType === SHRINE_TYPE)!;
const topTierOf = (world: string) =>
  [...economy.tiers].filter((t) => t.residenceId && worldOf(t.region) === world)
    .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

describe("divinité tutélaire — un seul dieu par île", () => {
  it("les seize autels partagent le même type d'unicité", () => {
    // C'est la clé : le quota porte sur le TYPE, pas sur le bâtiment. Le lire par bâtiment
    // faisait poser un autel par divinité — 72 mesurés là où le jeu en autorise deux.
    const shrines = catalog.filter((d) => d.uniqueType === SHRINE_TYPE);
    expect(shrines).toHaveLength(16); // 8 divinités × 2 régions
    for (const s of shrines) expect(s.unique).toBe(true);
    // Le Colisée, lui, a son propre type : il n'entre pas dans le quota des sanctuaires.
    expect(catalog.filter((d) => d.uniqueType === "Monument01").length).toBeGreaterThan(0);
  });

  it("le dieu est choisi sur l'attribut LIMITANT, pas sur la somme des gains", () => {
    // Contre-intuitif et décisif : sur une île où la sécurité incendie est le goulot,
    // Vulcain (🔥+2) vaut des milliers d'habitants et Cérès (❤+1) exactement zéro.
    const cands = institutionDefs("Roman").map((i) => ({ ...i, uniqueType: byId.get(i.defId)?.uniqueType }));
    const feu = pickPatron(cands, { FireSafety: 1000, Happiness: 0, Money: 0, Health: 0 });
    const sante = pickPatron(cands, { FireSafety: 0, Happiness: 0, Money: 0, Health: 1000 });
    expect(feu).toBeDefined();
    expect(sante).toBeDefined();
    expect(byId.get(feu!)?.name).toMatch(/Vulcain/);
    expect(feu).not.toBe(sante);
  });

  it("aucun candidat sanctuaire : pas de dieu, pas d'exception", () => {
    expect(pickPatron([], { FireSafety: 1 })).toBeUndefined();
    expect(pickPatron([{ defId: "gX", attrs: { Health: 1 }, range: 10 }], { Health: 1 })).toBeUndefined();
  });

  for (const islandId of ["roman_island_medium_01", "celtic_island_large_07"]) {
    it(`${islandId} : au plus un dieu, dans la limite des permis`, () => {
      const world = regionOfIsland(islandId);
      const grid = downscaleGrid(buildIslandGrid(islandId)!);
      const r = planIslandImport({
        catalog, grid, tierGuid: topTierOf(world).guid, coverageFloor: 0.8,
        exploitSlots: true, localProduction: true,
      });
      const shrines = r.buildings.filter((b) => byId.get(b.defId)?.uniqueType === SHRINE_TYPE);
      // UN SEUL dieu : « chaque île a un dieu tutélaire que vénère sa population ».
      expect(new Set(shrines.map((b) => b.defId)).size).toBeLessThanOrEqual(1);
      // …mais AUTANT DE COPIES QU'ON VEUT de ce dieu : le permis débloque le sanctuaire, il
      // n'en plafonne pas le nombre. Le `UniqueScope=Area` porte sur le TYPE — c'est la
      // divinité qui est unique, pas l'exemplaire.
      expect(uniqueCap(byId.get(shrines[0]?.defId ?? "") ?? autelAny)).toBe(Infinity);
      // le dieu retenu est bien de la région de l'île
      for (const b of shrines) expect(worldOf(byId.get(b.defId)!.region!)).toBe(world);
    }, 300_000);
  }

  it("la règle d'unicité vient des données du jeu, pas d'une table écrite à la main", () => {
    // `UniqueBuildingConfig` (GUID 81160) déclare huit types. Deux mécanismes distincts s'y
    // côtoient, et les confondre rendait le repli silencieux.
    expect(economy.uniqueTypes.Monument01).toMatchObject({ scope: "Area", allowed: 1 });
    expect(economy.uniqueTypes.Shrine).toMatchObject({ scope: "Area", permit: SHRINE_PERMIT });
    // plafond DUR : aucun permis ne le relève
    const colisee = catalog.find((d) => d.uniqueType === "Monument01")!;
    expect(uniqueCap(colisee, { [SHRINE_PERMIT]: 99 })).toBe(1);
    // plafond par PERMIS : c'est un état de partie, pas une donnée du jeu
    // …et il DEBLOQUE, il ne compte pas : un permis en poche → autant de copies qu'on veut,
    // aucun permis → aucune. Le lire comme un quota faisait poser deux sanctuaires la ou le
    // jeu en accepte une rangee, et masquait la vraie regle : un seul DIEU.
    const autel = catalog.find((d) => d.uniqueType === SHRINE_TYPE)!;
    expect(DEFAULT_PERMITS[SHRINE_PERMIT]).toBeGreaterThan(0);
    expect(uniqueCap(autel)).toBe(Infinity);
    expect(uniqueCap(autel, { [SHRINE_PERMIT]: 5 })).toBe(Infinity);
    expect(uniqueCap(autel, { [SHRINE_PERMIT]: 0 })).toBe(0);
    // un bâtiment sans type d'unicité n'est jamais borné
    expect(uniqueCap(catalog.find((d) => !d.unique)!)).toBe(Infinity);
  });

  it("le quota est réglable — 0 permis, aucun autel", () => {
    const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
    const r = planIslandImport({
      catalog, grid, tierGuid: topTierOf("Roman").guid, coverageFloor: 0.8,
      permits: { [SHRINE_PERMIT]: 0 },
    });
    expect(r.buildings.filter((b) => byId.get(b.defId)?.uniqueType === SHRINE_TYPE)).toHaveLength(0);
  }, 300_000);
});
