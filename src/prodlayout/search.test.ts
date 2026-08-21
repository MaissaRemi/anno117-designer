import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { tryBox, type PackInput } from "./pack";
import { searchBox } from "./search";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);
const input: PackInput = {
  items: [{ defId: "g3174", count: 2 }, { defId: "g3075", count: 1 }, { defId: "g2693", count: 2 }],
  warehouseDefId: "g3310",
  lookup,
};

describe("searchBox — mode auto", () => {
  const r = searchBox(input, { mode: "auto" }, "sud");

  it("rend un plan servi", () => {
    expect(r.served).toBe(true);
    expect(r.unmet).toEqual([]);
  });

  it("ne dépasse pas la référence mesurée du pain ×2 (23×23 = 529 cases)", () => {
    expect(r.w * r.h).toBeLessThanOrEqual(529);
  });

  it("est MINIMAL au pas de 1 — retirer une ligne ou une colonne casse le service", () => {
    expect(tryBox(input, r.w - 1, r.h, "sud").served).toBe(false);
    expect(tryBox(input, r.w, r.h - 1, "sud").served).toBe(false);
  });

  it("est reproductible à l'identique", () => {
    expect(JSON.stringify(searchBox(input, { mode: "auto" }, "sud"))).toBe(JSON.stringify(r));
  });
});

describe("searchBox — boîte imposée", () => {
  it("mode taille : respecte les dimensions et sert si elles suffisent", () => {
    const r = searchBox(input, { mode: "taille", w: 34, h: 34 }, "est");
    expect(r.served).toBe(true);
    expect(r.exit!.side).toBe("est");
  });

  it("mode taille : refuse en chiffrant quand c'est trop serré", () => {
    const r = searchBox(input, { mode: "taille", w: 12, h: 12 }, "sud");
    expect(r.served).toBe(false);
    expect(r.unmet.length).toBeGreaterThan(0);
  });

  it("mode forme : ne pose jamais rien sur une case hors masque", () => {
    const W = 34;
    const H = 34;
    const usable = new Array(W * H).fill(true);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) usable[y * W + x] = false;
    const r = searchBox(input, { mode: "forme", w: W, h: H, usable }, "sud");
    for (const p of r.placements) expect(r.usable[p.y * r.w + p.x]).toBe(true);
    for (const f of r.fields) expect(r.usable[f.y * r.w + f.x]).toBe(true);
    for (const rd of r.roads) expect(r.usable[rd.y * r.w + rd.x]).toBe(true);
  });
});
