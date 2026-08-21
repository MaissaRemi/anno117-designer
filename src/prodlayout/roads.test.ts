import { describe, expect, it } from "vitest";
import { at, BLOCKED, BUILDING, fill, FREE, makeOcc, ROAD } from "./occupancy";
import { adjacentRoads, connectRoads, paintSkeleton, roadComponents, roadDistances, touchesRoad } from "./roads";

describe("paintSkeleton", () => {
  it("trace une épine continue et des branches au pas donné", () => {
    const o = makeOcc(11, 9);
    paintSkeleton(o, 4, 5);
    for (let x = 0; x < 11; x++) expect(at(o, x, 4)).toBe(ROAD);
    // branches à x = 0, 5, 10 — le pas tombe ici sur la dernière colonne, ce n'est pas
    // une règle : c'est l'arithmétique du pas.
    for (let y = 0; y < 9; y++) {
      expect(at(o, 0, y)).toBe(ROAD);
      expect(at(o, 5, y)).toBe(ROAD);
      expect(at(o, 10, y)).toBe(ROAD);
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

describe("le squelette ne force plus la dernière ligne", () => {
  it("axe horizontal : la dernière colonne n'est peinte que si le pas y tombe", () => {
    // w = 9, pas 3 → branches à 0, 3, 6. La colonne 8 n'est PAS sur le pas : autrefois
    // elle était peinte d'office, et ces cases-là ne servaient à rien.
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    for (let y = 0; y < 5; y++) {
      if (y === 2) continue; // l'épine traverse toute la largeur, bords compris
      expect(at(o, 8, y)).toBe(FREE);
    }
    expect(at(o, 0, 0)).toBe(ROAD);
    expect(at(o, 6, 0)).toBe(ROAD);
  });

  it("axe vertical : le rôle des lignes et des colonnes s'échange", () => {
    const o = makeOcc(5, 9);
    paintSkeleton(o, 2, 3, "v");
    for (let x = 0; x < 5; x++) {
      if (x === 2) continue;
      expect(at(o, x, 8)).toBe(FREE);
    }
    expect(at(o, 0, 0)).toBe(ROAD);
    expect(at(o, 0, 6)).toBe(ROAD);
  });

  it("une case bloquée n'est jamais peinte", () => {
    const usable = new Array(9 * 5).fill(true);
    usable[2 * 9 + 4] = false;
    const o = makeOcc(9, 5, usable);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 4, 2)).toBe(BLOCKED);
  });
});

describe("connectRoads — un seul réseau, ou le comptoir n'en voit qu'un bout", () => {
  it("raccorde un îlot de voirie séparé par un bâtiment", () => {
    const o = makeOcc(9, 5);
    fill(o, 0, 0, 1, 2, ROAD);   // îlot en haut à gauche
    fill(o, 4, 0, 1, 5, ROAD);   // réseau principal
    fill(o, 5, 0, 5, 5, ROAD);
    expect(roadComponents(o)[0]).not.toBe(roadComponents(o)[4]);
    connectRoads(o);
    const comp = roadComponents(o);
    expect(comp[0]).toBe(comp[4]);
  });

  it("ne touche à rien quand la voirie est déjà d'un seul tenant", () => {
    const o = makeOcc(9, 5);
    fill(o, 0, 2, 9, 1, ROAD);
    const avant = [...o.cell];
    connectRoads(o);
    expect([...o.cell]).toEqual(avant);
  });
});
