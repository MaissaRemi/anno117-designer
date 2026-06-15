import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { islands, decodeMask } from "../data/islands";
import { terrainOf } from "../data/terrain";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { planIslandProduction } from "./prodPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

function realIsland(id: string): GridShape {
  const isl = islands.find((i) => i.id === id)!;
  const mask = decodeMask(isl.mask, isl.size.w, isl.size.h);
  const grid = makeGrid(isl.size.w, isl.size.h, false);
  for (let i = 0; i < mask.length; i++) grid.usable[i] = mask[i];
  const t = terrainOf(id);
  grid.slots = (t?.slots ?? []).filter((s) => s.type !== "blocker")
    .map((s) => ({ type: s.type, x: Math.round(s.x), y: Math.round(s.y) }));
  return grid;
}

// un bien agricole simple avec chaîne (ex: bière / pain) — premier bien produisible
const anyGood = Object.keys(economy.producers)[0];

describe("planIslandProduction (archetype île d'export)", () => {
  it("chaîne + maisons ouvrières + entrepôts couvrant les prods (île réelle)", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planIslandProduction(catalog, grid, lookup, anyGood, 5, { timeMs: 800 });
    expect(r.prodsTotal).toBeGreaterThan(0);
    expect(r.warehousesPlaced).toBeGreaterThanOrEqual(1);
    // entrepôts écrasent les champs au besoin → quasi toutes les prods à portée
    expect(r.prodsCovered / r.prodsTotal).toBeGreaterThanOrEqual(0.9);
    // main-d'œuvre locale : des maisons ouvrières sont posées si la chaîne en demande
    if (Object.values(r.solution.populationByTier).some((p) => p > 0)) {
      expect(r.houses).toBeGreaterThan(0);
    }
  });

  it("pas de chevauchement entre bâtiments posés", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planIslandProduction(catalog, grid, lookup, anyGood, 3, { timeMs: 500 });
    const occ = new Set<string>();
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
      const rot = b.rotation === 90 || b.rotation === 270;
      const w = rot ? d.size.h : d.size.w, h = rot ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = `${b.x + i},${b.y + j}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
      }
    }
  });

  it("bien minier : mines posées près des slots montagne (ou gap explicite)", () => {
    // trouve un bien dont le PRODUCTEUR (economy.producers) est une mine
    const goodGuid = Object.entries(economy.producers).find(([, defIds]) =>
      (defIds as string[]).some((id) => lookup(id)?.template === "SlotFactoryBuilding7"),
    )?.[0];
    if (!goodGuid) return;
    const grid = realIsland("roman_island_medium_01");
    const r = planIslandProduction(catalog, grid, lookup, goodGuid, 2, { timeMs: 500 });
    const minesPlaced = r.buildings.filter((b) => lookup(b.defId)?.template === "SlotFactoryBuilding7");
    if (minesPlaced.length) {
      // chaque mine proche d'un slot montagne (Chebyshev <= 12)
      const slots = grid.slots!.filter((s) => s.type === "mountain");
      for (const m of minesPlaced) {
        const near = slots.some((s) => Math.max(Math.abs(m.x - s.x), Math.abs(m.y - s.y)) <= 12);
        expect(near).toBe(true);
      }
    } else {
      expect(r.gaps.some((g) => g.includes("slot montagne"))).toBe(true);
    }
  });
});
