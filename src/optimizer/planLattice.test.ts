import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { islands, decodeMask } from "../data/islands";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { planLattice } from "./planLattice";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const svcTypes = (t: (typeof economy.tiers)[number]) =>
  new Set(t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).map((s) => s.building)).size;
// tier le plus riche en services (Patriciens, 11 types avec wonders) = cas dur
const tierRich = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => svcTypes(b) - svcTypes(a))[0]!;

const sumTiers = (tc: Record<string, number>) => Object.values(tc).reduce((a, b) => a + b, 0);

function realIsland(id: string): GridShape {
  const isl = islands.find((i) => i.id === id)!;
  const mask = decodeMask(isl.mask, isl.size.w, isl.size.h);
  const grid = makeGrid(isl.size.w, isl.size.h, false);
  for (let i = 0; i < mask.length; i++) grid.usable[i] = mask[i];
  return grid;
}

describe("planLattice (clusters co-localisés + gros gain-prunés)", () => {
  it("densité max : remplit les slots, accounting mixte cohérent, cœur au tier-cible", () => {
    const W = 128, R = 55;
    const grid = makeGrid(W, W, false);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
      if ((x - W / 2) ** 2 + (y - W / 2) ** 2 <= R * R) grid.usable[y * W + x] = true;
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    expect(r.houses).toBeGreaterThan(50);
    // invariant accounting mixte : Σ tiers = maisons ; fullyCovered = maisons au tier-cible
    expect(sumTiers(r.tierCounts)).toBe(r.houses);
    expect(r.fullyCovered).toBe(r.tierCounts[tierRich.guid] ?? 0);
    expect(r.fullyCovered).toBeLessThanOrEqual(r.houses);
    expect(r.fullyCovered).toBeGreaterThan(0); // le cœur du disque atteint le tier-cible
  });

  it("tous les types requis posés >= 1 fois", () => {
    const grid = makeGrid(120, 120);
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    const required = [...new Set(tierRich.services.map((s) => s.building).filter((b): b is string => !!b))]
      .filter((b) => { const d = lookup(b); return !!d && !!(d.streetRange || d.radius?.range); });
    for (const id of required) expect(r.servicesPlaced[id] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("pas de chevauchement, rien sur l'eau, maisons accès route", () => {
    const grid = realIsland("roman_island_medium_01");
    const W = grid.w;
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8 });
    const occ = new Set<string>();
    for (const b of r.buildings) {
      const d = lookup(b.defId)!;
      const w = b.rotation === 90 || b.rotation === 270 ? d.size.h : d.size.w;
      const h = b.rotation === 90 || b.rotation === 270 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = `${b.x + i},${b.y + j}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
        expect(grid.usable[(b.y + j) * W + (b.x + i)]).toBe(true);
      }
    }
    for (const rd of r.roads) expect(grid.usable[rd.y * W + rd.x]).toBe(true);
    // accès route des maisons
    const roads = new Set(r.roads.map((t) => `${t.x},${t.y}`));
    const resDef = lookup(tierRich.residenceId!)!;
    for (const b of r.buildings.filter((b) => b.defId === tierRich.residenceId)) {
      let touch = false;
      for (let j = -1; j <= resDef.size.h && !touch; j++) for (let i = -1; i <= resDef.size.w && !touch; i++) {
        const edge = (i >= 0 && i < resDef.size.w) !== (j >= 0 && j < resDef.size.h);
        if (edge && roads.has(`${b.x + i},${b.y + j}`)) touch = true;
      }
      expect(touch).toBe(true);
    }
  });

  it("régression île RÉELLE (medium_01, T4, floor 0.8) : densité max + ratio + accounting", () => {
    // `viabilityGate: false` — ce test mesure la DENSITÉ du pavage, pas la viabilité. Sans
    // institutions ni réseau d'eau (la grille brute n'a ni slots ni routage), le bilan
    // d'attributs est forcément déficitaire et la porte de viabilité élaguerait des maisons
    // pour une raison étrangère à ce qu'on veut vérifier ici.
    const grid = realIsland("roman_island_medium_01");
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 0.8, viabilityGate: false });
    expect(r.houses).toBeGreaterThanOrEqual(200); // districtPlan : 51 (ancien bug confetti)
    // invariant accounting mixte
    expect(sumTiers(r.tierCounts)).toBe(r.houses);
    expect(r.fullyCovered).toBe(r.tierCounts[tierRich.guid] ?? 0);
    // densité : la terre est massivement remplie de maisons (ratio maisons/services haut —
    // la densité mixte remplit désormais les poches auparavant laissées vides)
    const svc = Object.values(r.servicesPlaced).reduce((a, b) => a + b, 0);
    expect(r.houses / svc).toBeGreaterThanOrEqual(2.5);
  });

  it("floor 1 : densité max, cœur au tier-cible, accounting cohérent", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planLattice(grid, tierRich.guid, lookup, { coverageFloor: 1 });
    expect(r.houses).toBeGreaterThan(80);
    expect(r.fullyCovered).toBeGreaterThan(0); // le cœur couvert par tous les services
    expect(sumTiers(r.tierCounts)).toBe(r.houses);
  });

  it("I5 — déterministe : même île + tier → sortie identique (snapshot de régression)", () => {
    const grid = realIsland("roman_island_medium_01");
    const fingerprint = (g: GridShape) => {
      const r = planLattice(g, tierRich.guid, lookup, { coverageFloor: 0.8 });
      const blds = r.buildings.map((b) => `${b.defId}@${b.x},${b.y},${b.rotation}`).sort().join("|");
      return { houses: r.houses, fullyCovered: r.fullyCovered, blds, roads: r.roads.length };
    };
    const a = fingerprint(grid);
    const b = fingerprint(realIsland("roman_island_medium_01"));
    expect(a.houses).toBe(b.houses);
    expect(a.fullyCovered).toBe(b.fullyCovered);
    expect(a.roads).toBe(b.roads);
    expect(a.blds).toBe(b.blds); // positions exactes reproductibles (greedy déterministe)
  });
});
