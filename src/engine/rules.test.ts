import { describe, expect, it } from "vitest";
import { emptyLayout, makeBuildingDef, placeBuilding } from "../model/factories";
import type { Layout } from "../model/types";
import {
  canPlace,
  computeRadiusCoverage,
  makeLookup,
  roadConnected,
  validateFields,
  validateLayout,
} from "./rules";

const farm = makeBuildingDef({
  id: "farm",
  name: "Ferme",
  size: { w: 3, h: 3 },
  needsRoad: true,
  field: { tiles: 4, fieldType: "ble" },
});
const catalog = [farm];
const lookup = makeLookup(catalog);

function base(): Layout {
  return emptyLayout(20, 20);
}

describe("canPlace", () => {
  it("autorise une pose valide dans la grille", () => {
    expect(canPlace(base(), lookup, farm, 0, 0, 0)).toBe(true);
  });

  it("refuse hors de la grille", () => {
    expect(canPlace(base(), lookup, farm, 18, 18, 0)).toBe(false);
  });

  it("refuse le chevauchement avec un bâtiment existant", () => {
    const l = base();
    l.buildings.push(placeBuilding("farm", 0, 0, 0));
    expect(canPlace(l, lookup, farm, 1, 1, 0)).toBe(false);
  });

  it("refuse sur une case non utilisable", () => {
    const l = base();
    l.grid.usable[0] = false;
    expect(canPlace(l, lookup, farm, 0, 0, 0)).toBe(false);
  });
});

describe("roadConnected", () => {
  it("faux sans route adjacente", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0);
    l.buildings.push(b);
    expect(roadConnected(l, lookup, b)).toBe(false);
  });

  it("vrai avec route adjacente", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0);
    l.buildings.push(b);
    l.roads.push({ x: 3, y: 0 }); // adjacent à la colonne droite (x=2)
    expect(roadConnected(l, lookup, b)).toBe(true);
  });

  it("vrai si needsRoad === false", () => {
    const noRoad = makeBuildingDef({ id: "park", needsRoad: false });
    const l = base();
    const b = placeBuilding("park", 0, 0, 0);
    l.buildings.push(b);
    expect(roadConnected(l, makeLookup([noRoad]), b)).toBe(true);
  });
});

describe("validateFields", () => {
  it("valide une chaîne de champs touchant le bâtiment", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0); // emprise x:0..2, y:0..2
    l.buildings.push(b);
    // 4 cases connectées, la 1re (x=3,y=0) touche le bâtiment.
    l.fields.push({ x: 3, y: 0, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 3, y: 1, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 3, y: 2, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 4, y: 2, ownerUid: b.uid, fieldType: "ble" });
    const r = validateFields(l, lookup, b)!;
    expect(r.ok).toBe(true);
    expect(r.count).toBe(4);
    expect(r.connected).toBe(true);
    expect(r.touchesBuilding).toBe(true);
  });

  it("invalide un champ détaché (non connecté)", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0);
    l.buildings.push(b);
    l.fields.push({ x: 3, y: 0, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 3, y: 1, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 3, y: 2, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 10, y: 10, ownerUid: b.uid, fieldType: "ble" }); // isolée
    const r = validateFields(l, lookup, b)!;
    expect(r.connected).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("invalide si pas assez de cases", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0);
    l.buildings.push(b);
    l.fields.push({ x: 3, y: 0, ownerUid: b.uid, fieldType: "ble" });
    const r = validateFields(l, lookup, b)!;
    expect(r.count).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("invalide si le champ ne touche pas le bâtiment", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0);
    l.buildings.push(b);
    l.fields.push({ x: 5, y: 5, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 5, y: 6, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 5, y: 7, ownerUid: b.uid, fieldType: "ble" });
    l.fields.push({ x: 5, y: 8, ownerUid: b.uid, fieldType: "ble" });
    const r = validateFields(l, lookup, b)!;
    expect(r.touchesBuilding).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe("computeRadiusCoverage", () => {
  it("couvre les cases dans la portée", () => {
    const market = makeBuildingDef({
      id: "market",
      size: { w: 2, h: 2 },
      needsRoad: false,
      radius: { kind: "service", range: 5 },
    });
    const l = base();
    const b = placeBuilding("market", 5, 5, 0);
    l.buildings.push(b);
    const cov = computeRadiusCoverage(l, makeLookup([market]));
    const set = cov.get(b.uid)!;
    expect(set.size).toBeGreaterThan(0);
    expect(set.has("6,6")).toBe(true); // proche du centre
    expect(set.has("19,19")).toBe(false); // hors portée
  });
});

describe("validateLayout", () => {
  it("agrège les problèmes par bâtiment", () => {
    const l = base();
    const b = placeBuilding("farm", 0, 0, 0); // pas de route ni champ
    l.buildings.push(b);
    const issues = validateLayout(l, lookup);
    const i = issues.get(b.uid)!;
    expect(i.road).toBe(true);
    expect(i.ok).toBe(false);
    expect(i.field!.ok).toBe(false);
  });
});
