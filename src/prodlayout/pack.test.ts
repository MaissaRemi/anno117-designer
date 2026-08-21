import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { adjacentRoads, roadDistances } from "./roads";
import { at, BUILDING, fill, makeOcc } from "./occupancy";
import { tryBox, type PackInput } from "./pack";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

// le lot parfait du pain romain : 2 boulangeries, 1 moulin, 2 fermes
const BREAD = [
  { defId: "g3174", count: 2 },
  { defId: "g3075", count: 1 },
  { defId: "g2693", count: 2 },
];
const input: PackInput = { items: BREAD, warehouseDefId: "g3310", lookup };

/** Une boîte confortable : ce fichier teste la POSE, pas le choix des dimensions. */
const LARGE = 34;

describe("tryBox — invariants de pose", () => {
  const r = tryBox(input, LARGE, LARGE, "sud");

  it("pose tout ce qui a été demandé, plus l'entrepôt", () => {
    expect(r.placements.filter((p) => p.defId === "g3174").length).toBe(2);
    expect(r.placements.filter((p) => p.defId === "g3075").length).toBe(1);
    expect(r.placements.filter((p) => p.defId === "g2693").length).toBe(2);
    expect(r.placements.filter((p) => p.defId === "g3310").length).toBeGreaterThanOrEqual(1);
  });

  it("aucun chevauchement entre emprises, champs et routes", () => {
    const o = makeOcc(r.w, r.h);
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      const w = p.rot === 90 ? d.size.h : d.size.w;
      const h = p.rot === 90 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          expect(at(o, p.x + i, p.y + j)).toBe(0);
          fill(o, p.x + i, p.y + j, 1, 1, BUILDING);
        }
      }
    }
    for (const f of [...r.fields, ...r.roads]) {
      expect(at(o, f.x, f.y)).toBe(0);
      fill(o, f.x, f.y, 1, 1, BUILDING);
    }
  });

  it("tout bâtiment needsRoad touche une route", () => {
    const o = makeOcc(r.w, r.h);
    for (const road of r.roads) fill(o, road.x, road.y, 1, 1, 2);
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      if (!d.needsRoad) continue;
      const w = p.rot === 90 ? d.size.h : d.size.w;
      const h = p.rot === 90 ? d.size.w : d.size.h;
      expect(adjacentRoads(o, p.x, p.y, w, h).length).toBeGreaterThan(0);
    }
  });

  it("tout producteur est sous son transporterRange en distance-rue", () => {
    const o = makeOcc(r.w, r.h);
    for (const road of r.roads) fill(o, road.x, road.y, 1, 1, 2);
    const seeds: number[] = [];
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      if (!d.roadRoot) continue;
      seeds.push(...adjacentRoads(o, p.x, p.y, d.size.w, d.size.h));
    }
    const dist = roadDistances(o, seeds);
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      if (!d.production) continue;
      const w = p.rot === 90 ? d.size.h : d.size.w;
      const h = p.rot === 90 ? d.size.w : d.size.h;
      const best = adjacentRoads(o, p.x, p.y, w, h)
        .map((c) => dist[c])
        .filter((v) => v >= 0);
      expect(best.length).toBeGreaterThan(0);
      expect(Math.min(...best)).toBeLessThanOrEqual(d.transporterRange ?? 30);
    }
  });

  it("deux appels identiques rendent un plan identique", () => {
    expect(JSON.stringify(tryBox(input, LARGE, LARGE, "sud"))).toBe(
      JSON.stringify(tryBox(input, LARGE, LARGE, "sud")),
    );
  });

  it("les fermes atteignent leur quota de champ", () => {
    const perFarm = new Map<string, number>();
    for (const f of r.fields) perFarm.set(f.ownerUid, (perFarm.get(f.ownerUid) ?? 0) + 1);
    const quota = lookup("g2693")!.field!.tiles;
    expect([...perFarm.values()].every((n) => n === quota)).toBe(true);
    expect(perFarm.size).toBe(2);
    expect(r.unmet).toEqual([]);
  });
});

describe("l'objectif : servi d'abord, petit ensuite", () => {
  it("une boîte assez grande sert tout et sort par le bord demandé", () => {
    const r = tryBox(input, LARGE, LARGE, "sud");
    expect(r.unmet).toEqual([]);
    expect(r.served).toBe(true);
    expect(r.exit).not.toBeNull();
    expect(r.exit!.side).toBe("sud");
    expect(r.exit!.y).toBe(r.h - 1);
  });

  it("une boîte trop petite REFUSE en chiffrant, au lieu de livrer un plan dégradé", () => {
    const r = tryBox(input, 12, 12, "sud");
    expect(r.served).toBe(false);
    expect(r.unmet.length).toBeGreaterThan(0);
    for (const u of r.unmet) {
      if ("defId" in u) expect(lookup(u.defId)).toBeDefined();
    }
  });

  it("l'efficacité se mesure sur la surface UTILISABLE, pas sur w×h", () => {
    const usable = new Array(LARGE * LARGE).fill(true);
    for (let x = 0; x < LARGE; x++) usable[x] = false; // toute la ligne nord hors forme
    const r = tryBox(input, LARGE, LARGE, "sud", usable);
    expect(r.efficiency).toBeGreaterThan(0);
    expect(r.efficiency).toBeLessThanOrEqual(1);
  });

  it("tout bâtiment sur route est dans la MÊME composante que la sortie", () => {
    const r = tryBox(input, LARGE, LARGE, "sud");
    expect(r.served).toBe(true);
    expect(r.unmet.filter((u) => u.kind === "route")).toEqual([]);
  });

  it("une case hors forme n'accueille jamais rien", () => {
    const usable = new Array(LARGE * LARGE).fill(true);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) usable[y * LARGE + x] = false;
    const r = tryBox(input, LARGE, LARGE, "sud", usable);
    for (const p of r.placements) expect(r.usable[p.y * r.w + p.x]).toBe(true);
    for (const f of r.fields) expect(r.usable[f.y * r.w + f.x]).toBe(true);
    for (const rd of r.roads) expect(r.usable[rd.y * r.w + rd.x]).toBe(true);
  });
});
