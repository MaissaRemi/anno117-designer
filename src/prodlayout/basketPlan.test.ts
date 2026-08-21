import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { normalizeBasket } from "./basket";
import { planFromBasket } from "./index";

const catalog = rawCatalog as unknown as BuildingDef[];
const pain = normalizeBasket([
  { defId: "g3174", count: 2 },
  { defId: "g3075", count: 1 },
  { defId: "g2693", count: 2 },
]);

describe("planFromBasket", () => {
  it("pose exactement le panier, plus l'entrepôt — rien de plus", () => {
    const p = planFromBasket(catalog, pain, { exitSide: "sud" });
    if ("refuse" in p) throw new Error(p.raison);
    const compte = (id: string) => p.layout.buildings.filter((b) => b.defId === id).length;
    expect(compte("g3174")).toBe(2);
    expect(compte("g3075")).toBe(1);
    expect(compte("g2693")).toBe(2);
    expect(compte("g3310")).toBeGreaterThanOrEqual(1);
    // rien d'autre que le panier et des entrepôts
    const attendus = new Set(["g3174", "g3075", "g2693", "g3310"]);
    for (const b of p.layout.buildings) expect(attendus.has(b.defId)).toBe(true);
  });

  it("la sortie est sur le bord demandé et porte une route", () => {
    for (const side of ["nord", "sud", "est", "ouest"] as const) {
      const p = planFromBasket(catalog, pain, { exitSide: side });
      if ("refuse" in p) throw new Error(`${side} refusé : ${p.raison}`);
      expect(p.exit.side).toBe(side);
      const surBord =
        side === "nord" ? p.exit.y === 0
        : side === "sud" ? p.exit.y === p.box.h - 1
        : side === "ouest" ? p.exit.x === 0
        : p.exit.x === p.box.w - 1;
      expect(surBord).toBe(true);
      expect(p.layout.roads.some((r) => r.x === p.exit.x && r.y === p.exit.y)).toBe(true);
    }
  });

  it("les trois champs de moutons sont posés, tous les trois", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g2786", count: 1 }]), {
      exitSide: "sud",
    });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.fields.length).toBe(3);
    expect(p.layout.fields.every((f) => f.fieldType === "moutons")).toBe(true);
  });

  it("les 140 cases de champ d'une ferme de céréales sont complètes", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g2693", count: 1 }]), {
      exitSide: "sud",
    });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.fields.length).toBe(140);
  });

  it("le bilan des biens accompagne le plan", () => {
    const p = planFromBasket(catalog, pain, { exitSide: "sud" });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.balance.deficits).toEqual([]);
    expect(p.balance.surplus.map((f) => f.good)).toEqual(["2137"]);
  });

  it("une boîte trop serrée REFUSE, en disant quoi manque", () => {
    const p = planFromBasket(catalog, pain, {
      exitSide: "sud",
      box: { mode: "taille", w: 12, h: 12 },
    });
    expect("refuse" in p).toBe(true);
    if (!("refuse" in p)) return;
    expect(p.nonServis.length).toBeGreaterThan(0);
    expect(p.raison).toMatch(/\S/);
  });

  it("un bâtiment à slotType est POSÉ, avec son avis", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g2878", count: 1 }]), {
      exitSide: "sud",
    });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.advisories).toEqual([{ defId: "g2878", slotType: "forest" }]);
    expect(p.layout.buildings.some((b) => b.defId === "g2878")).toBe(true);
  });

  it("le masque de forme remonte dans le Layout", () => {
    const W = 34;
    const H = 34;
    const usable = new Array(W * H).fill(true);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) usable[y * W + x] = false;
    const p = planFromBasket(catalog, pain, {
      exitSide: "sud",
      box: { mode: "forme", w: W, h: H, usable },
    });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.grid.usable.length).toBe(p.box.w * p.box.h);
    expect(p.layout.grid.usable.some((u) => !u)).toBe(true);
    expect(p.layout.grid.cellsPerTile).toBeUndefined(); // grille TUILE, pas ½-tuile
  });

  it("est reproductible à l'identique", () => {
    const a = planFromBasket(catalog, pain, { exitSide: "sud" });
    const b = planFromBasket(catalog, pain, { exitSide: "sud" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("un panier vide est refusé plutôt que rendu vide", () => {
    const p = planFromBasket(catalog, normalizeBasket([]), { exitSide: "sud" });
    expect("refuse" in p).toBe(true);
  });
});
