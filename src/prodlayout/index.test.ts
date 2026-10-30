import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { normalizeBasket } from "./basket";
import { planFromBasket } from "./index";

const catalog = rawCatalog as unknown as BuildingDef[];

// Lot parfait du pain (moulin à 20 s depuis le patch 200) : 3 boulangeries, 1 moulin, 3 fermes.
// Latium : g3174, g3075, g2693 ; entrepôt g3310. Albion : boulangerie g5960 ; entrepôt g7055
// (template `Warehouse_Marsh`).
const painRomain = normalizeBasket([{ defId: "g3174", count: 3 }, { defId: "g3075", count: 1 }, { defId: "g2693", count: 3 }]);

describe("planFromBasket — bout en bout sur le pain", () => {
  const plan = planFromBasket(catalog, painRomain, { exitSide: "sud" });
  if ("refuse" in plan) throw new Error(plan.raison);

  it("rend un Layout que le moteur de rendu sait dessiner", () => {
    expect(plan.layout.grid.w).toBe(plan.box.w);
    expect(plan.layout.grid.h).toBe(plan.box.h);
    expect(plan.layout.grid.cellsPerTile).toBeUndefined(); // grille TUILE, pas ½-tuile
  });

  it("choisit l'entrepôt du monde de l'île", () => {
    expect(plan.layout.buildings.some((b) => b.defId === "g3310")).toBe(true);
  });

  it("en Albion, l'entrepôt d'Albion — même quand le premier bâtiment du panier est commun", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g5960", count: 2 }]), { exitSide: "sud", region: "Celtic" });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.buildings.some((b) => b.defId === "g7055")).toBe(true);
    expect(p.layout.buildings.some((b) => b.defId === "g3310")).toBe(false);
  });

  it("est reproductible à l'identique", () => {
    expect(JSON.stringify(planFromBasket(catalog, painRomain, { exitSide: "sud" }))).toBe(JSON.stringify(plan));
  });
});
