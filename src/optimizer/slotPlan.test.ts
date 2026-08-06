import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { pickSlotBuilding } from "./slotPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const t4 = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
const realIsland = (id: string) => downscaleGrid(buildIslandGrid(id)!);

describe("choix du bâtiment d'emplacement", () => {
  it("le catalogue porte le type d'emplacement requis (Factory7/RawResourceType)", () => {
    const withSlot = catalog.filter((d) => d.slotType);
    expect(withSlot.length).toBeGreaterThan(20);
    expect(withSlot.some((d) => d.slotType === "mountain")).toBe(true);
    expect(withSlot.some((d) => d.slotType === "river")).toBe(true);
  });

  it("respecte la région de l'île", () => {
    const rom = pickSlotBuilding(catalog, "mountain", { region: "Roman" });
    const cel = pickSlotBuilding(catalog, "mountain", { region: "Celtic" });
    expect(rom?.region === "Roman" || rom?.region === undefined).toBe(true);
    expect(cel?.region === "Celtic" || cel?.region === undefined).toBe(true);
  });

  it("écarte ce dont le gisement n'est pas déclaré sur l'île", () => {
    // profil sans aucun gisement : seuls les bâtiments SANS NeededFertility restent
    const d = pickSlotBuilding(catalog, "mountain", { region: "Roman", fertilities: ["0"] });
    expect(d).toBeDefined();
    expect(economy.buildingProd[d!.id]?.fertility).toBeFalsy();
  });

  it("déterministe", () => {
    const a = pickSlotBuilding(catalog, "mountain", { region: "Roman" });
    const b = pickSlotBuilding(catalog, "mountain", { region: "Roman" });
    expect(a?.id).toBe(b?.id);
  });
});

describe("exploitation des emplacements dans le plan d'île", () => {
  const grid = realIsland("roman_island_medium_01");

  it("option désactivée : aucun emplacement exploité (comportement inchangé)", () => {
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8 });
    expect(r.exploited).toEqual([]);
  });

  it("option activée : des emplacements sont exploités et servis par un entrepôt", () => {
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, exploitSlots: true });
    expect(r.exploited.length).toBeGreaterThan(0);
    // chaque exploitation produit quelque chose de nommé
    for (const e of r.exploited) {
      expect(e.perMin).toBeGreaterThan(0);
      expect(e.goodName).toBeTruthy();
      expect(["mountain", "river", "marsh"]).toContain(e.slotType);
    }
    // l'essentiel doit pouvoir expédier
    const served = r.exploited.filter((e) => e.served).length;
    expect(served / r.exploited.length).toBeGreaterThan(0.5);
  });

  it("L'EAU RESTE PRIORITAIRE : le réseau d'eau n'est pas dégradé par l'exploitation", () => {
    // Les deux plans sont comparés sur la recette COMPLÈTE. Depuis la cascade de
    // main-d'œuvre, exploiter les emplacements réclame des paliers ouvriers, donc des
    // services supplémentaires (`unlockWorkerTiers`) : en mode « recette optimisée » les
    // deux plans ne poseraient plus les mêmes bâtiments, et la comparaison ne dirait plus
    // rien de l'eau. Sur la recette complète l'ajout est un no-op par construction.
    const opts = { catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, needMode: "all" as const };
    const base = planIslandImport(opts);
    const withSlots = planIslandImport({ ...opts, exploitSlots: true });
    const ok = (x: typeof base) => (x.water ? x.water.consumers.filter((c) => c.connected).length : 0);
    expect(ok(withSlots)).toBe(ok(base));
    expect(withSlots.water?.sources).toBe(base.water?.sources);
    // et la population ne s'effondre pas (au pire quelques maisons rasées par les accès)
    expect(withSlots.residents).toBeGreaterThan(base.residents * 0.9);
  });

  it("aucun chevauchement entre les bâtiments du plan complet", () => {
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, exploitSlots: true });
    const occ = new Set<string>();
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
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
