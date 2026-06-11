import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeLookup } from "../engine/rules";
import { makeGrid } from "../model/factories";
import type { BuildingDef, Layout, PlacedBuilding } from "../model/types";
import { economy } from "../economy/economy";
import { analyzeCoverage } from "../economy/coverage";
import { placeServicesForCoverage } from "./coverPlace";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.some((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)),
)!;
const svc = tier.services.find((s) => s.building && (lookup(s.building!)?.streetRange || lookup(s.building!)?.radius?.range))!.building!;
const place = (defId: string, x: number, y: number): PlacedBuilding => ({ uid: `${defId}_${x}_${y}`, defId, x, y, rotation: 0, locked: false });

describe("placeServicesForCoverage (solveur couverture)", () => {
  it("place des services et couvre 100 % d'une résidence isolée", () => {
    const grid = makeGrid(60, 60);
    const layout: Layout = { grid, buildings: [place(tier.residenceId!, 0, 0)], roads: [], fields: [] };
    const res = placeServicesForCoverage(layout, lookup);
    expect(res.added.length).toBeGreaterThan(0);
    const s = res.perService.find((p) => p.serviceId === svc)!;
    expect(s.gap).toBe(0); // aucune résidence laissée sans ce service

    // après ajout, l'analyse confirme la couverture
    const after: Layout = { ...layout, buildings: [...layout.buildings, ...res.added] };
    const rep = analyzeCoverage(after, lookup);
    expect(rep.services.find((x) => x.serviceId === svc)!.pct).toBe(100);
  });

  it("résidences trop éloignées pour un seul service → en place plusieurs", () => {
    const grid = makeGrid(120, 120);
    const layout: Layout = {
      grid,
      buildings: [place(tier.residenceId!, 0, 0), place(tier.residenceId!, 110, 110)],
      roads: [], fields: [],
    };
    const res = placeServicesForCoverage(layout, lookup);
    const placedForSvc = res.added.filter((b) => b.defId === svc).length;
    expect(placedForSvc).toBeGreaterThanOrEqual(2);
    const after: Layout = { ...layout, buildings: [...layout.buildings, ...res.added] };
    expect(analyzeCoverage(after, lookup).services.find((x) => x.serviceId === svc)!.pct).toBe(100);
  });

  it("ne place rien si aucune résidence", () => {
    const grid = makeGrid(40, 40);
    const layout: Layout = { grid, buildings: [], roads: [], fields: [] };
    expect(placeServicesForCoverage(layout, lookup).added.length).toBe(0);
  });
});
