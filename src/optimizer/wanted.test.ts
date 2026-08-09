import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { economy, worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import { planIslandImport } from "./islandPlan";
import { pickSlotBuilding } from "./slotPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const ISLAND = "roman_island_medium_01";
const grid = () => downscaleGrid(buildIslandGrid(ISLAND)!);
const topTier = [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === worldOf(regionOfIsland(ISLAND)))
  .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

const plan = (wanted?: { workshops?: { defId: string; count: number }[]; slots?: Record<string, string> }) =>
  planIslandImport({
    catalog, grid: grid(), tierGuid: topTier.guid, coverageFloor: 1,
    localProduction: true, exploitSlots: true, wanted,
  });

/** Un atelier ROMAIN, hors emplacement de terrain, que l'île sait produire. */
const someWorkshop = (): BuildingDef => {
  const base = plan();
  const w = base.workshops.find((x) => !catalog.find((d) => d.id === x.defId)?.slotType);
  return catalog.find((d) => d.id === w!.defId)!;
};

describe("liste de vœux de production", () => {
  it("une demande réalisable est posée à l'identique, et AVANT le manifeste", () => {
    // Le contrat n'est pas « au moins autant » mais « exactement ce qui est demandé, en
    // premier » : c'est ce qui distingue une liste de vœux d'un simple biais de tri.
    const def = someWorkshop();
    const r = plan({ workshops: [{ defId: def.id, count: 2 }] });
    const mine = r.workshops.find((w) => w.defId === def.id);
    expect(mine).toBeDefined();
    expect(mine!.copies).toBe(2);
    // servi en premier : le vœu ouvre la liste des ateliers retenus
    expect(r.workshops[0].defId).toBe(def.id);
  }, 300_000);

  it("une demande DÉRAISONNABLE est servie en partie, et la cause est dite", () => {
    // 40 copies d'un même atelier ne tiennent ni dans le budget d'attributs ni dans la
    // main-d'œuvre. Le plan doit poser ce qu'il peut et NOMMER ce qui a manqué — pas échouer,
    // pas se taire.
    const def = someWorkshop();
    const r = plan({ workshops: [{ defId: def.id, count: 40 }] });
    const mine = r.workshops.find((w) => w.defId === def.id);
    expect(mine!.copies).toBeLessThan(40);
    const said = r.gaps.find((g) => g.includes(def.name) && g.includes("demandé"));
    expect(said).toBeDefined();
    // la raison est explicite, pas un simple compte
    expect(said).toMatch(/main-d'œuvre|budget|place|quota/);
  }, 300_000);

  it("une préférence d'emplacement infaisable est ignorée, jamais imposée", () => {
    // `pickSlotBuilding` ne doit pas laisser passer un bâtiment que ses propres filtres —
    // monde, gisement déclaré, main-d'œuvre — ont écarté. Une préférence n'ouvre aucune porte.
    const celticSlot = catalog.find((d) => d.slotType === "mountain" && d.region === "Celtic");
    if (!celticSlot) return; // rien à vérifier si le catalogue n'en propose pas
    const picked = pickSlotBuilding(catalog, "mountain", {
      region: "Roman", slotPrefs: { mountain: celticSlot.id },
    });
    expect(picked?.id).not.toBe(celticSlot.id);
    expect(picked?.region === "Roman" || picked?.region === undefined).toBe(true);
  });

  it("une préférence RÉALISABLE est retenue", () => {
    const roman = catalog.filter((d) => d.slotType === "mountain" && (!d.region || d.region === "Roman"));
    if (roman.length < 2) return;
    const def = pickSlotBuilding(catalog, "mountain", { region: "Roman" });
    // on demande volontairement un AUTRE candidat que celui choisi spontanément
    const other = roman.find((d) => d.id !== def?.id)!;
    const picked = pickSlotBuilding(catalog, "mountain", {
      region: "Roman", slotPrefs: { mountain: other.id },
    });
    expect(picked?.id).toBe(other.id);
  });

  it("sans liste de vœux, le plan est INCHANGÉ", () => {
    // Non-régression : l'option ne doit rien coûter tant qu'elle n'est pas utilisée.
    const a = plan();
    const b = plan({});
    expect(b.residents).toBe(a.residents);
    expect(b.workshops.map((w) => `${w.defId}×${w.copies}`)).toEqual(
      a.workshops.map((w) => `${w.defId}×${w.copies}`),
    );
  }, 300_000);
});
