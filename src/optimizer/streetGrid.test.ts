import { describe, expect, it } from "vitest";
import type { BuildingDef } from "../model/types";
import { creerParcours, idDroite, idLosange, parcourir, poserLosange } from "../engine/reseauRoutier";
import { makeStreetGrid, type ReachState } from "./streetGrid";

/**
 * Les primitives des moteurs sur le réseau en graphe, là où le golden de la trame droite ne
 * voit rien : des losanges de route. Une rangée droite (1..4, 5) qui entre dans trois losanges
 * en biais (5,5) (6,6) (7,7), d'où repart une rangée droite (7..9, 7) — deux jonctions par
 * recouvrement : (4, 5) est sous le losange (5, 5), (7, 7) sous le losange (7, 7).
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
  for (const x of [1, 2, 3, 4]) i.roadAt[5 * i.W + x] = 1;
  for (const [X, Y] of [[5, 5], [6, 6], [7, 7]]) poserLosange(i.sg.reseau, X, Y);
  for (const x of [7, 8, 9]) i.roadAt[7 * i.W + x] = 1;
  return i;
}

describe("streetGrid sur le réseau en graphe", () => {
  it("la portée traverse les jonctions : une longueur, 1 par case droite, √2 par losange", () => {
    const { sg } = routeMelee();
    const def = { id: "svc" } as BuildingDef;
    const portee = (range: number) => {
      const tc: ReachState = { def, range, reach: new Uint8Array(0), reachList: [], parent: new Int32Array(0) };
      sg.bfsType(tc, new Map([[def.id, [{ x: 0, y: 5, w: 1, h: 1 }]]]));
      return tc;
    };
    const r = sg.reseau;
    // (9, 7) : 4 droites + 3 losanges + 3 droites = 7 + 3√2 ≈ 11,24
    expect(portee(12).reach[idDroite(r, 9, 7)]).toBe(1);
    expect(portee(11).reach[idDroite(r, 9, 7)]).toBe(0);
    expect(portee(11).reach[idDroite(r, 8, 7)]).toBe(1);
    const tc = portee(12);
    expect(tc.parent[idDroite(r, 7, 7)]).toBe(idLosange(r, 7, 7));
    expect(tc.parent[idLosange(r, 5, 5)]).toBe(idDroite(r, 4, 5));
  });

  it("une maison touchée par la seule pointe d'un losange est desservie", () => {
    const { sg } = ile();
    poserLosange(sg.reseau, 3, 5); // pointe droite (4, 5) : coin haut-gauche d'une maison en (4, 5)
    expect(sg.touchesRoad(4, 5)).toBe(true);
    expect(sg.touchesRoad(4, 6)).toBe(false);
    expect(sg.routesAuContact(4, 5, 3, 3)).toEqual([idLosange(sg.reseau, 3, 5)]);
  });

  it("connectRing entre dans la première case recouverte par un losange", () => {
    const { W, roadAt, sg } = ile();
    poserLosange(sg.reseau, 9, 5);
    // anneau isolé d'un bâtiment 1 × 1 en (4, 5) : routes posées autour, sans réseau
    const ring = sg.layRing(4, 5, 1, 1);
    expect(ring.length).toBe(8);
    const avant = roadAt.reduce((s, v) => s + v, 0);
    sg.connectRing(ring);
    // le plus court chemin droit jusqu'à une case sous le losange (9, 5), qui recouvre les
    // colonnes 8 et 9 : 3 cases depuis l'anneau, (6, ·) (7, ·) (8, ·), la dernière en recouvrement
    expect(roadAt.reduce((s, v) => s + v, 0) - avant).toBe(3);
    expect(roadAt[5 * W + 9] + roadAt[4 * W + 9]).toBe(0);
    const p = creerParcours(sg.reseau);
    parcourir(sg.reseau, p, ring);
    expect(p.dist[idLosange(sg.reseau, 9, 5)]).toBeGreaterThan(0);
  });
});
