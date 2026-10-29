import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { planProductionLayout } from "./index";

const catalog = rawCatalog as unknown as BuildingDef[];

describe("planProductionLayout — bout en bout sur la boulangerie romaine", () => {
  const plan = planProductionLayout(catalog, "g3174", 1);

  it("rend un Layout que le moteur de rendu sait dessiner", () => {
    expect(plan.layout.grid.w).toBe(plan.box.w);
    expect(plan.layout.grid.h).toBe(plan.box.h);
    expect(plan.layout.grid.usable.every(Boolean)).toBe(true);
    expect(plan.layout.grid.cellsPerTile).toBeUndefined(); // grille TUILE, pas ½-tuile
    expect(plan.layout.buildings.length).toBe(plan.report.buildings.reduce((s, b) => s + b.count, 0));
  });

  it("suggère le lot parfait quand le ratio est incomplet", () => {
    expect(plan.order.perfectMultiplier).toBe(3); // moulin à 20 s depuis le patch 200
    expect(plan.order.items.find((i) => i.defId === "g3075")!.utilisation).toBe(1 / 3);
  });

  it("le lot parfait ne gaspille plus rien", () => {
    const perfect = planProductionLayout(catalog, "g3174", 3);
    expect(perfect.order.perfectMultiplier).toBe(1);
    expect(perfect.order.items.every((i) => i.utilisation === 1)).toBe(true);
  });

  it("choisit l'entrepôt de la région du bâtiment cible", () => {
    expect(plan.layout.buildings.some((b) => b.defId === "g3310")).toBe(true);
  });

  it("est reproductible à l'identique", () => {
    const again = planProductionLayout(catalog, "g3174", 1);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });

  it("refuse un bâtiment qui ne produit rien", () => {
    expect(() => planProductionLayout(catalog, "g3310", 1)).toThrow(/ne produit rien/);
  });
});
