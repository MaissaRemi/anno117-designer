import { describe, expect, it } from "vitest";
import type { BuildingDef } from "../model/types";
import { creerParcours, idDroite, idLosange, parcourir, poserLosange } from "../engine/reseauRoutier";
import { makeStreetGrid, type ReachState } from "./streetGrid";

/**
 * Les primitives des moteurs sur le réseau en graphe, là où le golden de la trame droite ne
 * voit rien : des losanges de route. Une rangée droite (1..3, 5), trois losanges en biais
 * (5,5) (6,6) (7,7), puis une rangée droite (8..9, 7) — deux jonctions par la pointe.
 */
function ile(W = 14, H = 12) {
  const N = W * H;
  const roadAt = new Uint8Array(N);
  const sg = makeStreetGrid({
    W, H, occ: new Uint8Array(N), roadAt, bldAdj: new Uint8Array(N), usable: new Array(N).fill(true),
    rw: 3, rh: 3, x0: 0, y0: 0, x1: W - 1, y1: H - 1, STEPH: 7,
  });
  return { W, H, roadAt, sg };
}

function routeMelee() {
  const i = ile();
  for (const x of [1, 2, 3]) i.roadAt[5 * i.W + x] = 1;
  for (const [X, Y] of [[5, 5], [6, 6], [7, 7]]) poserLosange(i.sg.reseau, X, Y);
  for (const x of [8, 9]) i.roadAt[7 * i.W + x] = 1;
  return i;
}

describe("streetGrid sur le réseau en graphe", () => {
  it("la portée traverse les jonctions : chaque case, droite ou losange, compte un pas", () => {
    const { sg } = routeMelee();
    const def = { id: "svc" } as BuildingDef;
    const portee = (range: number) => {
      const tc: ReachState = { def, range, reach: new Uint8Array(0), reachList: [], parent: new Int32Array(0) };
      sg.bfsType(tc, new Map([[def.id, [{ x: 0, y: 5, w: 1, h: 1 }]]]));
      return tc;
    };
    const r = sg.reseau;
    expect(portee(8).reach[idDroite(r, 9, 7)]).toBe(1); // 3 droites + 3 losanges + 2 droites
    expect(portee(7).reach[idDroite(r, 9, 7)]).toBe(0);
    expect(portee(7).reach[idDroite(r, 8, 7)]).toBe(1);
    const tc = portee(8);
    expect(tc.parent[idDroite(r, 8, 7)]).toBe(idLosange(r, 7, 7));
  });

  it("une maison touchée par la seule pointe d'un losange est desservie", () => {
    const { sg } = ile();
    poserLosange(sg.reseau, 3, 5); // pointe droite (4, 5) : coin haut-gauche d'une maison en (4, 5)
    expect(sg.touchesRoad(4, 5)).toBe(true);
    expect(sg.touchesRoad(4, 6)).toBe(false);
    expect(sg.routesAuContact(4, 5, 3, 3)).toEqual([idLosange(sg.reseau, 3, 5)]);
  });

  it("connectRing s'arrête au premier losange touché par un coin", () => {
    const { W, roadAt, sg } = ile();
    poserLosange(sg.reseau, 9, 5);
    // anneau isolé d'un bâtiment 1 × 1 en (4, 5) : routes posées autour, sans réseau
    const ring = sg.layRing(4, 5, 1, 1);
    expect(ring.length).toBe(8);
    const avant = roadAt.reduce((s, v) => s + v, 0);
    sg.connectRing(ring);
    // le plus court chemin droit vers une case dont un coin porte la pointe gauche (8, 5) du
    // losange : 2 cases depuis l'anneau, par (6, ·) puis (7, ·)
    expect(roadAt.reduce((s, v) => s + v, 0) - avant).toBe(2);
    expect(roadAt[5 * W + 8]).toBe(0);
    const p = creerParcours(sg.reseau);
    parcourir(sg.reseau, p, ring);
    expect(p.dist[idLosange(sg.reseau, 9, 5)]).toBeGreaterThan(0);
  });
});
