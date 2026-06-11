import { describe, expect, it } from "vitest";
import { makeBuildingDef, makeGrid } from "../model/factories";
import { decode, makeDecoder } from "./greedy";
import { DEFAULT_WEIGHTS, type OptimizeRequest } from "./types";

// Test de NON-RÉGRESSION du gâchis de bande : mélanger un grand bâtiment avec
// beaucoup de petits ne doit pas figer une bande globale sur le plus grand.
const tall = makeBuildingDef({ id: "tall", name: "Grand", size: { w: 3, h: 12 }, needsRoad: true });
const small = makeBuildingDef({ id: "small", name: "Petit", size: { w: 3, h: 3 }, needsRoad: true });

function req(): OptimizeRequest {
  return {
    catalog: [tall, small],
    grid: makeGrid(24, 40),
    lockedBuildings: [],
    existingRoads: [],
    existingFields: [],
    items: [
      { defId: "tall", qty: 1 },
      { defId: "small", qty: 60 },
    ],
    weights: { ...DEFAULT_WEIGHTS },
    timeMs: 300,
  };
}

describe("packing par étagères (hauteur variable)", () => {
  it("ne gâche pas l'espace en mélangeant grand + petits bâtiments", () => {
    const r = req();
    const dec = makeDecoder(r);
    const order = ["tall", ...new Array(60).fill("small")];
    const out = decode(r, dec, order, 0);
    const smalls = out.buildings.filter((b) => b.defId === "small").length;
    // Bande globale figée (h=12) ne logerait que ~21 petits ; les étagères
    // de hauteur 3 doivent en loger nettement plus.
    expect(smalls).toBeGreaterThanOrEqual(35);
  });

  it("ne produit aucun chevauchement (bâtiments + champs + routes)", () => {
    const r = req();
    const dec = makeDecoder(r);
    const out = decode(r, dec, ["tall", ...new Array(60).fill("small")], 0);
    const occ = new Set<string>();
    const claim = (x: number, y: number) => {
      const k = `${x},${y}`;
      expect(occ.has(k)).toBe(false);
      occ.add(k);
    };
    for (const b of out.buildings) {
      const h = b.defId === "tall" ? 12 : 3;
      for (let j = 0; j < h; j++) for (let i = 0; i < 3; i++) claim(b.x + i, b.y + j);
    }
    for (const f of out.fields) claim(f.x, f.y);
    // les routes ne doivent pas tomber sur un bâtiment/champ
    for (const road of out.roads) expect(occ.has(`${road.x},${road.y}`)).toBe(false);
  });
});
