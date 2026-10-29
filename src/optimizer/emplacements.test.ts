import { describe, expect, it } from "vitest";
import type { GridShape } from "../model/types";
import { facadeDe, posesSurEmplacement } from "./emplacements";

/** 40 × 40 : pente à gauche (x < 20, ni terre ni mer), terre à droite. */
function montagneAGauche(): GridShape {
  const w = 40, h = 40;
  const usable = Array.from({ length: w * h }, (_, c) => c % w >= 20);
  return { w, h, usable, water: new Array(w * h).fill(false) };
}

describe("posesSurEmplacement", () => {
  const def = { size: { w: 8, h: 3 }, rotatable: true };

  it("pose SUR l'emplacement : centrée à une case près, jamais à distance", () => {
    for (const p of posesSurEmplacement(montagneAGauche(), def, { x: 18, y: 20 })) {
      expect(Math.abs(p.x + p.w / 2 - 18)).toBeLessThanOrEqual(2);
      expect(Math.abs(p.y + p.h / 2 - 20)).toBeLessThanOrEqual(2);
    }
  });

  it("au pied d'une montagne : sur la pente, un grand côté donnant sur la terre", () => {
    const grid = montagneAGauche();
    const p = posesSurEmplacement(grid, def, { x: 18, y: 20 })[0];
    // debout (3 × 8) contre la pente, sa façade à droite sur la terre
    expect(p.w).toBe(3);
    const facade = facadeDe(grid, p);
    expect(facade.every((c) => grid.usable[c])).toBe(true);
    expect(facade.every((c) => c % grid.w === p.x + p.w)).toBe(true);
  });
});
