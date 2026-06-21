import { describe, expect, it } from "vitest";
import { resizeGridShape } from "./factories";
import type { GridShape } from "./types";

describe("resizeGridShape — préservation du terrain (B3)", () => {
  // grille 4×4 : eau sur la colonne 0, rivière en (1,1), un slot montagne en (3,3)
  const base: GridShape = {
    w: 4,
    h: 4,
    usable: Array.from({ length: 16 }, (_, i) => i % 4 !== 0), // col 0 = non constructible
    water: Array.from({ length: 16 }, (_, i) => i % 4 === 0),
    rivers: Array.from({ length: 16 }, (_, i) => i === 5), // (1,1)
    slots: [{ type: "mountain", x: 3, y: 3 }],
    islandId: "med01",
  };

  it("agrandir conserve eau/rivières/slots/île et n'invente pas d'eau", () => {
    const g = resizeGridShape(base, 6, 6);
    expect(g.w).toBe(6);
    expect(g.islandId).toBe("med01");
    expect(g.water![0 * 6 + 0]).toBe(true); // eau (0,0) préservée
    expect(g.rivers![1 * 6 + 1]).toBe(true); // rivière (1,1) préservée
    expect(g.slots).toEqual([{ type: "mountain", x: 3, y: 3 }]); // slot toujours dans les bornes
    // nouvelle case (5,5) : constructible, pas d'eau
    expect(g.usable[5 * 6 + 5]).toBe(true);
    expect(g.water![5 * 6 + 5]).toBe(false);
  });

  it("rétrécir filtre les slots hors limites", () => {
    const g = resizeGridShape(base, 3, 3);
    expect(g.slots).toEqual([]); // (3,3) hors d'une grille 3×3
    expect(g.water![0]).toBe(true); // eau (0,0) toujours là
  });

  it("grille sans terrain reste sans terrain (champs optionnels undefined)", () => {
    const plain: GridShape = { w: 2, h: 2, usable: [true, true, true, true] };
    const g = resizeGridShape(plain, 3, 3);
    expect(g.water).toBeUndefined();
    expect(g.rivers).toBeUndefined();
    expect(g.slots).toBeUndefined();
    expect(g.usable.length).toBe(9);
  });
});
