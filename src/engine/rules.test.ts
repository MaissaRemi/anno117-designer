import { describe, expect, it } from "vitest";
import { makeBuildingDef, makeGrid, placeBuilding } from "../model/factories";
import type { Layout } from "../model/types";

// Oracle vérité-terrain en TUILES (cellsPerTile=1 → scale 1). emptyLayout est ½-tuile
// (grille vivante) ; ici on teste la sémantique tuile avec des valeurs calculées à la main.
const tileLayout = (w: number, h: number): Layout => ({
  grid: makeGrid(w, h, true),
  buildings: [],
  fields: [],
  roads: [],
});
import {
  canPlace,
  computeRadiusCoverage,
  makeLookup,
  roadConnected,
  rootedRoadSet,
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

describe("computeRadiusCoverage — vérité-terrain (§2-D : oracle indépendant des moteurs)", () => {
  it("distance-rue bornée + cases servies = voisines des routes ATTEINTES (calcul manuel)", () => {
    const svc = makeBuildingDef({ id: "svc", size: { w: 1, h: 1 }, radius: { kind: "service", range: 2 }, streetRange: 2 });
    const lk = makeLookup([svc]);
    const layout: Layout = {
      ...tileLayout(10, 10),
      buildings: [{ uid: "s", defId: "svc", x: 5, y: 5, rotation: 0, locked: false }],
      roads: [{ x: 5, y: 6 }, { x: 5, y: 7 }, { x: 5, y: 8 }],
    };
    const cov = computeRadiusCoverage(layout, lk).get("s")!;
    // graine = (5,6) (route ortho-adjacente à l'emprise), dist 1 ; BFS jusqu'à streetRange 2
    // → routes atteintes {(5,6) d1, (5,7) d2} ; (5,8) d3 hors portée. Cases servies =
    // cases usables ortho-adjacentes à une route atteinte.
    expect(new Set(cov)).toEqual(new Set(["4,6", "6,6", "5,5", "5,7", "4,7", "6,7", "5,6", "5,8"]));
    expect(cov.has("5,9")).toBe(false); // au-delà : (5,8) n'est pas une route ATTEINTE
    expect(cov.has("4,5")).toBe(false); // adjacent au service mais aucune route atteinte adjacente
  });
});
const lookup = makeLookup(catalog);

function base(): Layout {
  return tileLayout(20, 20);
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

  it("pose diagonale (45°) : valide le DIAMANT en ½-tuile (scale=2)", () => {
    const dia = makeBuildingDef({ id: "dia", size: { w: 1, h: 1 }, needsRoad: false });
    const lk = makeLookup([dia]);
    const grid = { w: 10, h: 10, usable: new Array(100).fill(true), cellsPerTile: 2 };
    const l: Layout = { grid, buildings: [], fields: [], roads: [] };
    // 1×1 @45 en ½-tuile → croix de 5 cellules, toutes libres → pose OK
    expect(canPlace(l, lk, dia, 0, 0, 45)).toBe(true);
    // un occupant sur le centre du diamant → chevauchement → refus
    l.buildings.push({ uid: "o", defId: "dia", x: 0, y: 0, rotation: 45, locked: false });
    expect(canPlace(l, lk, dia, 0, 0, 45)).toBe(false);
    // hors-grille (le diamant déborde) → refus
    expect(canPlace(l, lk, dia, 9, 9, 45)).toBe(false);
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

describe("connexité au comptoir (rootedRoadSet)", () => {
  const kontor = makeBuildingDef({ id: "kontor", name: "Comptoir", size: { w: 2, h: 2 }, needsRoad: false, roadRoot: true });
  const lk = makeLookup([farm, kontor]);

  it("ne garde que les routes reliées au comptoir", () => {
    const l = base();
    l.buildings.push(placeBuilding("kontor", 0, 0, 0)); // emprise 0..1
    // réseau relié : routes (2,0)->(3,0)
    l.roads.push({ x: 2, y: 0 });
    l.roads.push({ x: 3, y: 0 });
    // route isolée loin
    l.roads.push({ x: 10, y: 10 });
    const { set, hasRoot } = rootedRoadSet(l, lk);
    expect(hasRoot).toBe(true);
    expect(set.has("2,0")).toBe(true);
    expect(set.has("3,0")).toBe(true);
    expect(set.has("10,10")).toBe(false); // isolée => exclue
  });

  it("validateLayout: route non reliée au comptoir = problème", () => {
    const l = base();
    l.buildings.push(placeBuilding("kontor", 0, 0, 0));
    l.roads.push({ x: 2, y: 0 }); // reliée au comptoir
    const farmDef = makeBuildingDef({ id: "f2", name: "F", size: { w: 3, h: 3 }, needsRoad: true });
    const lk2 = makeLookup([kontor, farmDef]);
    // ferme touchant une route ISOLÉE (5,5) non reliée
    const bIso = placeBuilding("f2", 6, 5, 0); // emprise x6..8 ; route (5,5) adjacente
    l.buildings.push(bIso);
    l.roads.push({ x: 5, y: 5 });
    const issues = validateLayout(l, lk2);
    expect(issues.get(bIso.uid)!.road).toBe(true); // route pas reliée au comptoir
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

describe("SP3 — 8-adjacence (coin) sur grille ½-tuile : routes diagonales", () => {
  const svc = makeBuildingDef({ id: "s8", size: { w: 1, h: 1 }, needsRoad: true });
  const lk = makeLookup([svc]);

  it("roadConnected : connexion au COIN acceptée en ½-tuile, refusée en tuile", () => {
    // ½-tuile : emprise 2×2 (4,4)..(5,5) ; route (6,6) = diagonale au coin de (5,5)
    const b = { uid: "b", defId: "s8", x: 4, y: 4, rotation: 0 as const, locked: false };
    const ht: Layout = {
      grid: { w: 12, h: 12, usable: new Array(144).fill(true), cellsPerTile: 2 },
      buildings: [b], fields: [], roads: [{ x: 6, y: 6 }],
    };
    expect(roadConnected(ht, lk, b)).toBe(true); // 8-adjacence
    // tuile : emprise 1×1 (4,4) ; route (5,5) en diagonale → 4-adjacence refuse
    const tile: Layout = {
      grid: { w: 12, h: 12, usable: new Array(144).fill(true) },
      buildings: [b], fields: [], roads: [{ x: 5, y: 5 }],
    };
    expect(roadConnected(tile, lk, b)).toBe(false);
  });

  it("streetCoverage : un run de route DIAGONAL est parcouru (½-tuile)", () => {
    const svcR = makeBuildingDef({ id: "sr", size: { w: 1, h: 1 }, needsRoad: true, radius: { kind: "service", range: 1 }, streetRange: 6 });
    const lkR = makeLookup([svcR]);
    // service en (0,0) (emprise 2×2) ; escalier diagonal de routes (2,2)→(5,5)
    const roads = [{ x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }];
    const l: Layout = {
      grid: { w: 16, h: 16, usable: new Array(256).fill(true), cellsPerTile: 2 },
      buildings: [{ uid: "s", defId: "sr", x: 0, y: 0, rotation: 0, locked: false }],
      fields: [], roads,
    };
    const cov = computeRadiusCoverage(l, lkR).get("s")!;
    // une cellule voisine du bout lointain (5,5) du run diagonal est couverte
    expect(cov.has("6,6") || cov.has("5,6") || cov.has("6,5")).toBe(true);
  });
});

describe("computeRadiusCoverage (distance le long des rues)", () => {
  const service = makeBuildingDef({
    id: "svc",
    name: "Service",
    size: { w: 1, h: 1 },
    needsRoad: true,
    radius: { kind: "service", range: 2 }, // euclidien faible
    streetRange: 5, // mais 5 cases le long des rues
  });
  const cov = makeLookup([service]);

  it("suit le réseau de routes, pas le disque euclidien", () => {
    const l = base();
    l.buildings.push({ uid: "s1", defId: "svc", x: 2, y: 2, rotation: 0, locked: false });
    for (let x = 2; x <= 12; x++) l.roads.push({ x, y: 3 }); // rue horizontale sous le bâtiment
    const map = computeRadiusCoverage(l, cov);
    const covered = map.get("s1")!;
    // (6,2) est loin en euclidien (>2) mais à 5 cases de rue → couvert
    expect(covered.has("6,2")).toBe(true);
    // (7,2) est à 6 cases de rue (> streetRange) → non couvert
    expect(covered.has("7,2")).toBe(false);
  });

  it("repli euclidien quand il n'y a pas de route", () => {
    const l = base();
    l.buildings.push({ uid: "s1", defId: "svc", x: 5, y: 5, rotation: 0, locked: false });
    const map = computeRadiusCoverage(l, cov);
    const covered = map.get("s1")!;
    expect(covered.size).toBeGreaterThan(0); // disque autour du bâtiment
    expect(covered.has("9,5")).toBe(false); // hors rayon euclidien (range 2)
  });
});
