import { describe, expect, it } from "vitest";
import { fitView } from "./exportImage";

describe("fitView — cadrage plein de l'île pour l'export PNG", () => {
  it("fait tenir la dimension dominante dans maxPx (marge incluse)", () => {
    const { view, width, height } = fitView(320, 200, 2400, 16);
    // 320 cases (dimension dominante) × cell + 2*marge ≤ maxPx
    expect(width).toBeLessThanOrEqual(2400);
    expect(view.cell).toBe(Math.floor((2400 - 32) / 320));
    expect(width).toBe(320 * view.cell + 32);
    expect(height).toBe(200 * view.cell + 32);
    expect(view.originX).toBe(16);
  });

  it("cell minimale de 2 px sur très grande grille", () => {
    const { view } = fitView(5000, 5000, 100);
    expect(view.cell).toBe(2);
  });

  it("petite grille : grandes cases, tout tient", () => {
    const { view, width } = fitView(40, 40, 2400, 16);
    expect(view.cell).toBe(Math.floor((2400 - 32) / 40));
    expect(width).toBeLessThanOrEqual(2400);
  });
});
