import { describe, expect, it } from "vitest";
import { at, BLOCKED, BUILDING, count, fill, fits, FREE, makeOcc, ROAD, setAt, usableArea } from "./occupancy";

describe("occupancy", () => {
  it("naît entièrement libre", () => {
    const o = makeOcc(4, 3);
    expect(o.cell.length).toBe(12);
    expect(at(o, 0, 0)).toBe(FREE);
  });

  it("rend -1 hors limites", () => {
    const o = makeOcc(4, 3);
    expect(at(o, -1, 0)).toBe(-1);
    expect(at(o, 4, 0)).toBe(-1);
    expect(at(o, 0, 3)).toBe(-1);
  });

  it("fits refuse le débordement et le chevauchement", () => {
    const o = makeOcc(4, 4);
    expect(fits(o, 0, 0, 4, 4)).toBe(true);
    expect(fits(o, 1, 0, 4, 4)).toBe(false);
    setAt(o, 2, 2, BUILDING);
    expect(fits(o, 0, 0, 4, 4)).toBe(false);
    expect(fits(o, 0, 0, 2, 2)).toBe(true);
  });

  it("fill marque tout le rectangle", () => {
    const o = makeOcc(4, 4);
    fill(o, 1, 1, 2, 2, ROAD);
    expect(at(o, 1, 1)).toBe(ROAD);
    expect(at(o, 2, 2)).toBe(ROAD);
    expect(at(o, 3, 3)).toBe(FREE);
  });
});

describe("masque de forme", () => {
  it("sans masque, toutes les cases sont libres et utilisables", () => {
    const o = makeOcc(3, 2);
    expect(count(o, FREE)).toBe(6);
    expect(usableArea(o)).toBe(6);
  });

  it("le masque marque les cases hors forme et les sort de la surface utilisable", () => {
    const o = makeOcc(2, 2, [true, false, true, true]);
    expect(at(o, 1, 0)).toBe(BLOCKED);
    expect(at(o, 0, 0)).toBe(FREE);
    expect(usableArea(o)).toBe(3);
  });

  it("un rectangle qui chevauche une case bloquée ne tient pas", () => {
    const o = makeOcc(3, 1, [true, false, true]);
    expect(fits(o, 0, 0, 2, 1)).toBe(false);
    expect(fits(o, 2, 0, 1, 1)).toBe(true);
  });
});
