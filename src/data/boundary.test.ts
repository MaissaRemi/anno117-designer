import { describe, expect, it } from "vitest";
import rawCatalog from "./catalog.generated.json";
import { economy } from "../economy/economy";
import { terrainOf } from "./terrain";
import { islands } from "./islands";
import type { BuildingDef } from "../model/types";

// Frontière de données (T4) : sans zod, on valide structurellement le JSON généré par
// les scripts python. Une dérive de forme après regen casse CE test au lieu de produire
// un `undefined` profond au runtime.
const catalog = rawCatalog as unknown as BuildingDef[];

describe("frontière de données — intégrité du JSON généré", () => {
  it("catalogue : chaque entrée a id/name/size{w,h} + id unique", () => {
    expect(catalog.length).toBeGreaterThan(100);
    const ids = new Set<string>();
    for (const d of catalog) {
      expect(typeof d.id).toBe("string");
      expect(typeof d.name).toBe("string");
      expect(typeof d.size?.w).toBe("number");
      expect(typeof d.size?.h).toBe("number");
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
    }
  });

  it("tiers : guid + services[] ; toute residenceId pointe un bâtiment du catalogue", () => {
    const ids = new Set(catalog.map((d) => d.id));
    expect(economy.tiers.length).toBeGreaterThan(0);
    for (const t of economy.tiers) {
      expect(typeof t.guid).toBe("string");
      expect(Array.isArray(t.services)).toBe(true);
      expect(Array.isArray(t.goods)).toBe(true);
      if (t.residenceId) expect(ids.has(t.residenceId)).toBe(true);
    }
  });

  it("producers/goodPrices/goodNames : formes cohérentes", () => {
    for (const [good, defs] of Object.entries(economy.producers)) {
      expect(typeof good).toBe("string");
      expect(Array.isArray(defs)).toBe(true);
      expect(defs.length).toBeGreaterThan(0);
      for (const id of defs) expect(typeof id).toBe("string");
    }
    for (const v of Object.values(economy.goodPrices)) expect(typeof v).toBe("number");
    for (const v of Object.values(economy.goodNames)) expect(typeof v).toBe("string");
  });

  it("terrain : tout slot d'île a type + coords numériques", () => {
    for (const isl of islands.slice(0, 10)) {
      const t = terrainOf(isl.id);
      if (!t) continue;
      for (const s of t.slots) {
        expect(typeof s.type).toBe("string");
        expect(Number.isFinite(s.x)).toBe(true);
        expect(Number.isFinite(s.y)).toBe(true);
      }
    }
  });
});
