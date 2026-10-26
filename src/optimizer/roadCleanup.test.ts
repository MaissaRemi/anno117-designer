import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { makeLookup } from "../engine/rules";
import { pruneDeadEnds } from "./roadCleanup";

const lookup = makeLookup(rawCatalog as unknown as BuildingDef[]);
const RESIDENCE = "g3145"; // Résidence de Patriciens, 3×3

const grid = (w: number, h: number): GridShape => ({ w, h, usable: new Array<boolean>(w * h).fill(true) });
const maison = (x: number, y: number): PlacedBuilding =>
  ({ uid: `m${x},${y}`, defId: RESIDENCE, x, y, rotation: 0, locked: false });
const ligne = (y: number, x0: number, x1: number): RoadTile[] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y }));
const cles = (rs: RoadTile[]) => rs.map((r) => `${r.x},${r.y}`).sort();

describe("élagage des culs-de-sac", () => {
  it("retire un bout de route qui ne mène nulle part, jusqu'au dernier bâtiment desservi", () => {
    // maison en (0,0)-(2,2), route y=3 de x=0 à x=9 : les cases x=3..9 ne touchent rien
    const r = pruneDeadEnds(grid(12, 6), [maison(0, 0)], ligne(3, 0, 9), lookup);
    expect(cles(r.roads)).toEqual(cles(ligne(3, 0, 2)));
    expect(r.removed).toBe(7);
  });

  it("garde un tronçon qui RELIE deux bâtiments, même sans en toucher un", () => {
    // deux maisons aux deux bouts ; le milieu de la route ne touche rien mais relie
    const r = pruneDeadEnds(grid(20, 6), [maison(0, 0), maison(15, 0)], ligne(3, 0, 17), lookup);
    expect(r.removed).toBe(0);
    expect(r.roads).toHaveLength(18);
  });

  it("retire une case isolée, sans voisin ni bâtiment", () => {
    const r = pruneDeadEnds(grid(10, 10), [maison(0, 0)], [...ligne(3, 0, 2), { x: 8, y: 8 }], lookup);
    expect(cles(r.roads)).toEqual(cles(ligne(3, 0, 2)));
  });

  it("élague une branche morte sans toucher la boucle qui la porte", () => {
    // boucle autour d'une maison en (2,2), plus une antenne vers l'est sur y=1
    const boucle: RoadTile[] = [...ligne(1, 1, 5), ...ligne(5, 1, 5), { x: 1, y: 2 }, { x: 1, y: 3 },
      { x: 1, y: 4 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 }];
    const antenne = ligne(1, 6, 10);
    const r = pruneDeadEnds(grid(12, 8), [maison(2, 2)], [...boucle, ...antenne], lookup);
    expect(cles(r.roads)).toEqual(cles(boucle));
  });
});
