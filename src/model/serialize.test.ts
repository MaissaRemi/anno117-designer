import { describe, expect, it } from "vitest";
import { emptyLayout, makeBuildingDef, placeBuilding } from "./factories";
import { findOrphanRefs, parse, serialize } from "./serialize";
import type { Catalog, Layout } from "./types";

describe("serialize — intégrité référentielle (B2)", () => {
  it("disposition propre = aucun orphelin", () => {
    const def = makeBuildingDef({ id: "house" });
    const layout: Layout = { ...emptyLayout(10, 10), buildings: [placeBuilding("house", 0, 0)] };
    const r = findOrphanRefs([def], layout);
    expect(r.orphanDefs).toEqual([]);
    expect(r.orphanFieldOwners).toBe(0);
  });

  it("defId absent du catalogue = orphelin signalé (sinon invisible au rendu)", () => {
    const layout: Layout = { ...emptyLayout(10, 10), buildings: [placeBuilding("ghost", 1, 1)] };
    const r = findOrphanRefs([], layout);
    expect(r.orphanDefs).toEqual(["ghost"]);
  });

  it("champ sans bâtiment propriétaire = compté", () => {
    const def = makeBuildingDef({ id: "farm", field: { tiles: 4, fieldType: "ble" } });
    const layout: Layout = {
      ...emptyLayout(10, 10),
      fields: [{ x: 0, y: 0, ownerUid: "nope", fieldType: "ble" }],
    };
    expect(findOrphanRefs([def], layout).orphanFieldOwners).toBe(1);
  });

  it("serialize → parse : round-trip fidèle", () => {
    const catalog: Catalog = [makeBuildingDef({ id: "a" })];
    const layout: Layout = { ...emptyLayout(8, 8), buildings: [placeBuilding("a", 2, 3)] };
    const file = parse(serialize(catalog, layout));
    expect(file.catalog).toEqual(catalog);
    expect(file.layout).toEqual(layout);
    expect(file.app).toBe("anno117-designer");
  });

  it("parse : fichier étranger rejeté", () => {
    expect(() => parse(JSON.stringify({ foo: 1 }))).toThrow();
  });
});
