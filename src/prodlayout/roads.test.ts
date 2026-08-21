import { describe, expect, it } from "vitest";
import { at, BLOCKED, BUILDING, fill, FREE, makeOcc, ROAD } from "./occupancy";
import { adjacentRoads, paintSkeleton, roadDistances, touchesRoad } from "./roads";

describe("paintSkeleton", () => {
  it("trace une épine continue et des branches INTÉRIEURES au pas donné", () => {
    const o = makeOcc(11, 9);
    paintSkeleton(o, 4, 5);
    for (let x = 0; x < 11; x++) expect(at(o, x, 4)).toBe(ROAD);
    // branches à x = 1 puis 1+5 = 6, jamais les colonnes de bord 0 et 10
    for (let y = 0; y < 9; y++) {
      expect(at(o, 1, y)).toBe(ROAD);
      expect(at(o, 6, y)).toBe(ROAD);
    }
    expect(at(o, 3, 0)).toBe(FREE);
  });

  it("n'écrase jamais une case déjà occupée", () => {
    const o = makeOcc(11, 9);
    fill(o, 4, 3, 3, 3, BUILDING);
    paintSkeleton(o, 4, 5);
    expect(at(o, 5, 4)).toBe(BUILDING);
    expect(at(o, 3, 4)).toBe(ROAD);
  });
});

describe("adjacence et distance-rue", () => {
  it("touchesRoad ne voit que les quatre côtés, pas les diagonales", () => {
    const o = makeOcc(6, 6);
    fill(o, 0, 0, 1, 1, ROAD);
    expect(touchesRoad(o, 1, 1, 2, 2)).toBe(false); // en diagonale de la route
    expect(touchesRoad(o, 1, 0, 2, 2)).toBe(true);
  });

  it("adjacentRoads rend les indices des routes contiguës", () => {
    const o = makeOcc(6, 6);
    fill(o, 0, 0, 6, 1, ROAD);
    expect(adjacentRoads(o, 2, 1, 2, 2).sort()).toEqual([2, 3]);
  });

  it("le BFS compte LE LONG des routes, pas à vol d'oiseau", () => {
    // U de routes : (0,0)->(0,4)->(4,4)->(4,0). Les deux extrémités sont à 4 cases
    // à vol d'oiseau mais à 12 pas le long de la voirie.
    const o = makeOcc(5, 5);
    fill(o, 0, 0, 1, 5, ROAD);
    fill(o, 0, 4, 5, 1, ROAD);
    fill(o, 4, 0, 1, 5, ROAD);
    const d = roadDistances(o, [0]); // graine : (0,0), distance 1
    expect(d[0]).toBe(1);
    expect(d[4 * 5 + 0]).toBe(5);
    expect(d[0 * 5 + 4]).toBe(13);
  });

  it("laisse -1 sur ce que la voirie n'atteint pas", () => {
    const o = makeOcc(5, 5);
    fill(o, 0, 0, 1, 2, ROAD);
    fill(o, 4, 4, 1, 1, ROAD);
    const d = roadDistances(o, [0]);
    expect(d[4 * 5 + 4]).toBe(-1);
  });
});

describe("le squelette ne gaspille plus les colonnes de bord", () => {
  it("axe horizontal : aucune colonne de bord peinte hors l'épine", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    for (let y = 0; y < 5; y++) {
      if (y === 2) continue; // l'épine traverse toute la largeur, bords compris
      expect(at(o, 0, y)).toBe(FREE);
      expect(at(o, 8, y)).toBe(FREE);
    }
  });

  it("axe horizontal : au moins une branche intérieure existe", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 1, 0)).toBe(ROAD);
  });

  it("axe vertical : le rôle des lignes et des colonnes s'échange", () => {
    const o = makeOcc(5, 9);
    paintSkeleton(o, 2, 3, "v");
    for (let x = 0; x < 5; x++) {
      if (x === 2) continue;
      expect(at(o, x, 0)).toBe(FREE);
      expect(at(o, x, 8)).toBe(FREE);
    }
    expect(at(o, 0, 1)).toBe(ROAD);
  });

  it("une case bloquée n'est jamais peinte", () => {
    const usable = new Array(9 * 5).fill(true);
    usable[2 * 9 + 4] = false;
    const o = makeOcc(9, 5, usable);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 4, 2)).toBe(BLOCKED);
  });
});
