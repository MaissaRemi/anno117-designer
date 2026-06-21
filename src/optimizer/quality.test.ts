import { describe, expect, it } from "vitest";
import { makeBuildingDef, makeGrid } from "../model/factories";
import { footprintCells } from "../engine/geometry";
import { makeLookup, validateLayout } from "../engine/rules";
import { anneal } from "./anneal";
import { DEFAULT_WEIGHTS, type OptimizeRequest, type RequestItem } from "./types";
import type { Layout } from "../model/types";

const house = makeBuildingDef({ id: "house", name: "Maison", size: { w: 3, h: 3 }, needsRoad: true });
const farm = makeBuildingDef({
  id: "farm", name: "Ferme", size: { w: 3, h: 3 }, needsRoad: false,
  field: { tiles: 9, fieldType: "ble" },
});
const depot = makeBuildingDef({ id: "depot", name: "Comptoir", size: { w: 3, h: 3 }, needsRoad: false, roadRoot: true });
const cat = [house, farm, depot];
const lookup = makeLookup(cat);

function solveLayout(
  items: RequestItem[], w: number, h: number, ms = 1500,
  locked: Layout["buildings"] = [], opts: { seed?: number; maxIters?: number } = {},
) {
  const grid = makeGrid(w, h);
  const req: OptimizeRequest = {
    catalog: cat, grid, lockedBuildings: locked, existingRoads: [], existingFields: [],
    items, weights: { ...DEFAULT_WEIGHTS }, timeMs: ms, seed: opts.seed, maxIters: opts.maxIters,
  };
  const { out, scored } = anneal(req);
  const layout: Layout = {
    grid,
    buildings: [...locked, ...out.buildings],
    roads: out.roads,
    fields: out.fields,
  };
  return { out, scored, layout, grid, usable: grid.usable.filter(Boolean).length };
}

describe("qualité optimiseur — la sortie remplit son rôle", () => {
  it("produit une disposition VALIDE (pas de chevauchement, route reliée, champs OK)", () => {
    // comptoir verrouillé = racine du réseau routier
    const locked = [{ uid: "kontor", defId: "depot", x: 0, y: 0, rotation: 0 as const, locked: true }];
    const { out, layout } = solveLayout([{ defId: "house", qty: 40 }], 24, 24, 500, locked);
    expect(out.buildings.length).toBeGreaterThan(0);
    const issues = validateLayout(layout, lookup);
    // CHAQUE bâtiment posé par l'optimiseur doit être valide in-game
    for (const b of out.buildings) {
      const i = issues.get(b.uid)!;
      expect(i.overlap).toBe(false); // dans la grille, sans chevauchement
      expect(i.road).toBe(false); // relié au réseau routier racine (comptoir)
      if (i.field) expect(i.field.ok).toBe(true);
    }
  });

  it("aucune route gaspillée pour des bâtiments sans accès route", () => {
    const { out } = solveLayout([{ defId: "farm", qty: 30 }], 30, 30, 500);
    expect(out.buildings.length).toBe(30);
    expect(out.roads.length).toBe(0); // fermes needsRoad=false → 0 route
    // champs corrects (9 cases par ferme)
    expect(out.fields.length).toBe(30 * 9);
  });

  it("atteint l'optimum de topologie (peigne) pour des maisons uniformes", () => {
    // grille 30×30, maisons 3×3 needsRoad. Peigne : rangée route toutes les 4 lignes,
    // ~9 maisons/rangée (épine prend 1 colonne) × ~7 rangées ≈ 63.
    const { out } = solveLayout([{ defId: "house", qty: 200 }], 30, 30, 0, [], { maxIters: 1200 });
    const W = 30, period = 4, perRow = Math.floor((W - 1) / 3), rows = Math.floor(W / period);
    const comb = perRow * rows; // borne théorique du peigne mono-orientation
    // DÉTERMINISTE (seed+maxIters) : plus de tolérance liée au temps machine
    expect(out.buildings.length).toBeGreaterThanOrEqual(Math.floor(comb * 0.9));
  });

  it("ne dépasse jamais la borne d'aire (cases bâties ≤ aire utilisable)", () => {
    const { out, usable } = solveLayout([{ defId: "house", qty: 500 }], 20, 20, 400);
    let cells = 0;
    for (const b of out.buildings) cells += footprintCells(house, b.x, b.y, b.rotation).length;
    expect(cells + out.roads.length).toBeLessThanOrEqual(usable);
  });

  it("place tous les bâtiments demandés quand l'espace le permet", () => {
    const { out } = solveLayout([{ defId: "house", qty: 12 }], 40, 40, 400);
    expect(out.buildings.length).toBe(12); // espace large → 100 % placés
  });

  it("reproductible : même (seed, maxIters) → sortie identique (déterminisme I1)", () => {
    const items = [{ defId: "house", qty: 60 }, { defId: "farm", qty: 20 }];
    const a = solveLayout(items, 28, 28, 0, [], { seed: 7, maxIters: 600 });
    const b = solveLayout(items, 28, 28, 0, [], { seed: 7, maxIters: 600 });
    expect(a.scored.score).toBe(b.scored.score);
    expect(a.out.buildings.length).toBe(b.out.buildings.length);
    const pos = (o: typeof a) => o.out.buildings.map((x) => `${x.x},${x.y}`).sort().join("|");
    expect(pos(a)).toBe(pos(b)); // positions exactes reproductibles
  });
});
