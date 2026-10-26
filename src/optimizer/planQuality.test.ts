import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, GridShape, PlacedBuilding } from "../model/types";
import { makeLookup } from "../engine/rules";
import { planQuality, roleOf } from "./planQuality";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const def = (id: string) => lookup(id)!;

// GUIDs vérifiés dans le catalogue : Résidence de Patriciens 3×3, Taverne 4×6,
// Boulangerie 4×5, Comptoir (racine) 8×7.
const RESIDENCE = "g3145", TAVERNE = "g3528", BOULANGERIE = "g3174", COMPTOIR = "g3402";

const grid = (w: number, h: number, usable = true): GridShape =>
  ({ w, h, usable: new Array<boolean>(w * h).fill(usable) });
const at = (defId: string, x: number, y: number): PlacedBuilding =>
  ({ uid: `${defId}@${x},${y}`, defId, x, y, rotation: 0, locked: false });

describe("rôle d'un bâtiment", () => {
  it("distingue résidence, service, production et infrastructure", () => {
    expect(roleOf(def(RESIDENCE))).toBe("residence");
    expect(roleOf(def(TAVERNE))).toBe("service");
    expect(roleOf(def(BOULANGERIE))).toBe("production");
    expect(roleOf(def(COMPTOIR))).toBe("infrastructure");
  });
});

describe("qualité d'un plan", () => {
  it("compte chaque case de terre une seule fois, et le reste comme libre", () => {
    // 10×10 = 100 cases : une maison (9), une taverne (24), une ligne de route (10)
    const q = planQuality({
      buildings: [at(RESIDENCE, 0, 0), at(TAVERNE, 5, 0)],
      roads: Array.from({ length: 10 }, (_, x) => ({ x, y: 7 })),
      fields: [],
    }, grid(10, 10), lookup);
    expect(q.land).toBe(100);
    expect(q.counts).toEqual({ residence: 1, service: 1, production: 0, infrastructure: 0 });
    expect(q.pct.residence).toBe(9);
    expect(q.pct.service).toBe(24);
    expect(q.pct.roads).toBe(10);
    expect(q.pct.free).toBe(57);
    expect(q.servicesPerHouse).toBe(1);
  });

  it("une route sous un bâtiment n'est pas comptée deux fois", () => {
    const q = planQuality({
      buildings: [at(RESIDENCE, 0, 0)],
      roads: [{ x: 1, y: 1 }, { x: 5, y: 5 }],
      fields: [],
    }, grid(10, 10), lookup);
    expect(q.pct.residence + q.pct.roads + q.pct.free).toBe(100);
    expect(q.pct.roads).toBe(1);
  });

  it("ignore les emprises hors terre : elles ne sont pas du sol constructible", () => {
    const g = grid(10, 10);
    for (let x = 0; x < 10; x++) for (let y = 0; y < 5; y++) g.usable[y * 10 + x] = false;
    const q = planQuality({ buildings: [at(RESIDENCE, 0, 3)], roads: [], fields: [] }, g, lookup);
    expect(q.land).toBe(50);
    // la maison couvre y=3..5 : seule la rangée y=5 est sur la terre, soit 3 cases sur 50
    expect(q.pct.residence).toBe(6);
  });

  it("des services sans aucune maison donnent un ratio infini, pas zéro", () => {
    const q = planQuality({ buildings: [at(TAVERNE, 0, 0)], roads: [], fields: [] }, grid(10, 10), lookup);
    expect(q.servicesPerHouse).toBe(Infinity);
  });
});
