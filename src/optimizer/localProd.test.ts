import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { VITAL_ATTRS } from "../economy/attributes";

const catalog = rawCatalog as unknown as BuildingDef[];
const t4 = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
const plan = (localProduction: boolean) =>
  planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, localProduction });

describe("production finale sur l'île", () => {
  const off = plan(false);
  const on = plan(true);

  it("option désactivée : aucun atelier, comportement inchangé", () => {
    expect(off.workshops).toEqual([]);
  });

  it("option activée : des ateliers sont posés et le manifeste d'import baisse", () => {
    expect(on.workshops.length).toBeGreaterThan(0);
    const total = (r: typeof off) => r.importGoods.reduce((a, g) => a + g.perMin, 0);
    expect(total(on)).toBeLessThan(total(off));
    for (const w of on.workshops) {
      expect(w.copies).toBeGreaterThan(0);
      expect(w.perMin).toBeGreaterThan(0);
    }
  });

  it("LA RÈGLE D'ARRÊT : le bilan de l'île reste positif", () => {
    expect(on.viable).toBe(true);
    for (const k of VITAL_ATTRS) expect(on.attrsTotal[k]).toBeGreaterThanOrEqual(0);
  });

  it("le budget d'attributs est bien CONSOMMÉ (sinon la règle ne servirait à rien)", () => {
    // au moins un attribut vital doit avoir baissé : les ateliers coûtent quelque chose
    const spent = VITAL_ATTRS.some((k) => (on.attrsTotal[k] ?? 0) < (off.attrsTotal[k] ?? 0));
    expect(spent).toBe(true);
  });

  it("les maisons rasées sont décomptées de la population", () => {
    const lost = on.workshops.reduce((a, w) => a + w.housesLost, 0);
    expect(lost).toBeGreaterThan(0);
    expect(on.houses).toBeLessThan(off.houses);
    expect(on.residents).toBeLessThan(off.residents);
  });

  it("aucun chevauchement avec le reste du plan", () => {
    const occ = new Set<string>();
    const byId = new Map(catalog.map((d) => [d.id, d]));
    for (const b of on.buildings) {
      const d = byId.get(b.defId)!;
      const w = b.rotation === 90 || b.rotation === 270 ? d.size.h : d.size.w;
      const h = b.rotation === 90 || b.rotation === 270 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = `${b.x + i},${b.y + j}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
      }
    }
  });
});
