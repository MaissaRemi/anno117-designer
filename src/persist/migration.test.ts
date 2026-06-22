import { describe, expect, it } from "vitest";
import { upscale2x } from "../data/islands";
import { migrateV7toV8 } from "./local";
import type { Catalog, Layout } from "../model/types";

describe("upscale2x — tuile → ½-tuile (×2, plus proche voisin)", () => {
  it("1 tuile terre → bloc 2×2 de cellules terre", () => {
    // grille 2×2 : terre seulement en (1,0)
    const mask = [false, true, false, false];
    const up = upscale2x(mask, 2, 2); // → 4×4
    const W = 4;
    // (1,0) tuile → cellules (2,0),(3,0),(2,1),(3,1)
    for (const [x, y] of [[2, 0], [3, 0], [2, 1], [3, 1]] as const) expect(up[y * W + x]).toBe(true);
    // (0,0) tuile (false) → cellules (0,0),(1,0),(0,1),(1,1) restent false
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) expect(up[y * W + x]).toBe(false);
    expect(up.length).toBe(16);
  });

  it("masque plein → tout plein, taille ×4", () => {
    const up = upscale2x([true, true, true, true], 2, 2);
    expect(up.length).toBe(16);
    expect(up.every(Boolean)).toBe(true);
  });
});

describe("migrateV7toV8 — état tuile → grille vivante ½-tuile (×2)", () => {
  const catalog: Catalog = [];
  it("double grille + bâtiments + routes + champs + slots, pose cellsPerTile=2", () => {
    const v7: { catalog: Catalog; layout: Layout } = {
      catalog,
      layout: {
        grid: {
          w: 3,
          h: 3,
          usable: [true, true, true, true, true, true, true, true, true],
          slots: [{ type: "mountain", x: 2, y: 1 }],
          islandId: "med01",
        },
        buildings: [{ uid: "b1", defId: "house", x: 1, y: 2, rotation: 0, locked: false }],
        roads: [{ x: 0, y: 0 }],
        fields: [{ x: 1, y: 1, ownerUid: "b1", fieldType: "ble" }],
        aqueducts: [{ x: 2, y: 2 }],
      },
    };
    const m = migrateV7toV8(v7);
    expect(m.layout.grid.w).toBe(6);
    expect(m.layout.grid.h).toBe(6);
    expect(m.layout.grid.cellsPerTile).toBe(2);
    expect(m.layout.grid.usable.length).toBe(36);
    // bâtiment (1,2) → (2,4)
    expect(m.layout.buildings[0]).toMatchObject({ x: 2, y: 4 });
    // route (0,0) → (0,0) ; champ (1,1) → (2,2) ; aqueduc (2,2) → (4,4) ; slot (2,1) → (4,2)
    expect(m.layout.roads[0]).toEqual({ x: 0, y: 0 });
    expect(m.layout.fields[0]).toMatchObject({ x: 2, y: 2, ownerUid: "b1" });
    expect(m.layout.aqueducts![0]).toEqual({ x: 4, y: 4 });
    expect(m.layout.grid.slots![0]).toEqual({ type: "mountain", x: 4, y: 2 });
  });

  it("préserve l'absence des champs optionnels", () => {
    const v7 = {
      catalog,
      layout: {
        grid: { w: 2, h: 2, usable: [true, true, true, true] },
        buildings: [],
        roads: [],
        fields: [],
      } as Layout,
    };
    const m = migrateV7toV8(v7);
    expect(m.layout.grid.water).toBeUndefined();
    expect(m.layout.grid.rivers).toBeUndefined();
    expect(m.layout.aqueducts).toBeUndefined();
    expect(m.layout.grid.cellsPerTile).toBe(2);
  });
});
