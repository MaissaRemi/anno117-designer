import { describe, expect, it } from "vitest";
import { addF, commonMultiplier, divF, frac, mulF, subF, toNumber } from "./frac";

describe("frac — rationnels réduits", () => {
  it("réduit à la création", () => {
    expect(frac(60, 30)).toEqual({ n: 2, d: 1 });
    expect(frac(2, 4)).toEqual({ n: 1, d: 2 });
    expect(frac(0, 5)).toEqual({ n: 0, d: 1 });
  });

  it("refuse un dénominateur nul", () => {
    expect(() => frac(1, 0)).toThrow(/dénominateur/);
  });

  it("ajoute, multiplie et divise sans perte", () => {
    expect(addF(frac(1, 3), frac(1, 6))).toEqual({ n: 1, d: 2 });
    expect(mulF(frac(1, 2), frac(2, 3))).toEqual({ n: 1, d: 3 });
    expect(divF(frac(1, 1), frac(2, 1))).toEqual({ n: 1, d: 2 });
  });

  it("refuse la division par zéro", () => {
    expect(() => divF(frac(1), frac(0))).toThrow(/division/);
  });

  it("convertit en nombre", () => {
    expect(toNumber(frac(1, 4))).toBe(0.25);
  });

  it("commonMultiplier rend le plus petit entier qui rend tout entier", () => {
    // c'est le lot parfait du pain : 1, 1/2, 1 -> ×2
    expect(commonMultiplier([frac(1), frac(1, 2), frac(1)])).toBe(2);
    expect(commonMultiplier([frac(1, 3), frac(1, 4)])).toBe(12);
    expect(commonMultiplier([])).toBe(1);
  });
});

it("soustrait sans passer par le flottant", () => {
  expect(subF(frac(1, 3), frac(1, 6))).toEqual({ n: 1, d: 6 });
  expect(subF(frac(2), frac(2))).toEqual({ n: 0, d: 1 });
  expect(subF(frac(1), frac(3))).toEqual({ n: -2, d: 1 });
});
