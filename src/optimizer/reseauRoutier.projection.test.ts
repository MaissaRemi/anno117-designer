import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef, Layout } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { computeRadiusCoverage, makeLookup, rootedRoadSet } from "../engine/rules";
import { cellKey, footprintCells } from "../engine/geometry";
import { planningRange } from "../engine/roads";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { catalogueDiagonal, centreDroit, grilleDiagonale, versDiagonalPoint } from "./cadreDiagonal";
import { coinDe, creerParcours, estLosange, idLosange, noeudsAuContact, parcourir, poserLosange, reseauVide, voisins } from "../engine/reseauRoutier";

/**
 * PROJECTION D'UN PLAN DIAGONAL DANS LE RÉSEAU COMMUN.
 *
 * Le plan diagonal est calculé par le moteur dans le repère tourné (`cadreDiagonal`), où un
 * losange est une case ordinaire. Reporté dans le réseau commun — ses routes en losanges sur
 * les coins de la grille droite —, il doit donner exactement ce que l'analyseur trouve dans le
 * repère tourné : même réseau relié au comptoir, mêmes cases servies par chaque service. C'est
 * ce qui valide les arêtes losange–losange et le raccordement par un côté d'un bâtiment
 * diagonal sur un vrai plan.
 */
const catalog = rawCatalog as unknown as BuildingDef[];
const PATRICIENS = "1498";

describe("un plan diagonal projeté dans le réseau commun", () => {
  it("roman_island_small_06 : même réseau enraciné, mêmes couvertures que dans son repère", () => {
    const droite = downscaleGrid(buildIslandGrid("roman_island_small_06")!);
    const { grid: dg, cadre } = grilleDiagonale(droite);
    const lookupD = makeLookup(catalogueDiagonal(catalog));
    const plan = planIslandImport({
      catalog: catalogueDiagonal(catalog), grid: dg, tierGuid: PATRICIENS, coverageFloor: 0.8, roadType: "pavee",
    });
    expect(plan.roads.length).toBeGreaterThan(100);
    const D: Layout = { grid: dg, buildings: plan.buildings, roads: plan.roads, fields: plan.fields, roadType: plan.roadType };

    const reseau = reseauVide(droite.w, droite.h);
    const versId = (c: number, r: number): number => {
      const { X, Y } = centreDroit(cadre, c, r);
      if (X < 0 || Y < 0 || X > droite.w || Y > droite.h) throw new Error(`case diagonale (${c}, ${r}) hors de l'île`);
      return idLosange(reseau, X, Y);
    };
    const versCle = (id: number): string => {
      const { X, Y } = coinDe(reseau, id);
      const p = versDiagonalPoint(cadre, X, Y);
      return cellKey(p.c, p.r);
    };
    for (const r of plan.roads) { const { X, Y } = coinDe(reseau, versId(r.x, r.y)); poserLosange(reseau, X, Y); }
    const emprise = (b: (typeof plan.buildings)[number]): number[] => {
      const d = lookupD(b.defId)!;
      return footprintCells(d, b.x, b.y, b.rotation, 1).map((c) => versId(c.x, c.y));
    };
    const p = creerParcours(reseau);

    // réseau relié au comptoir
    const { set: racine, hasRoot } = rootedRoadSet(D, lookupD);
    expect(hasRoot).toBe(true);
    const sources: number[] = [];
    for (const b of plan.buildings) {
      if (!lookupD(b.defId)?.roadRoot) continue;
      for (const id of emprise(b)) voisins(reseau, id, (n) => sources.push(n));
    }
    parcourir(reseau, p, sources);
    expect(new Set(p.atteints.map(versCle))).toEqual(racine);

    // cases servies par chaque service à portée-rue
    const couvertures = computeRadiusCoverage(D, lookupD);
    let services = 0;
    for (const b of plan.buildings) {
      const d = lookupD(b.defId)!;
      if (!d.radius || !d.streetRange) continue;
      const fp = new Set(emprise(b));
      const depart: number[] = [];
      for (const id of fp) voisins(reseau, id, (n) => { if (!fp.has(n)) depart.push(n); });
      parcourir(reseau, p, depart, planningRange(d, D.roadType));
      const servies = new Set<string>();
      for (const id of p.atteints) {
        noeudsAuContact(reseau, id, (n) => {
          if (!estLosange(reseau, n)) return; // le repère tourné ne connaît que des losanges
          const k = versCle(n);
          const [c, r] = k.split(",").map(Number);
          if (c >= 0 && r >= 0 && c < dg.w && r < dg.h && dg.usable[r * dg.w + c]) servies.add(k);
        });
      }
      expect(servies, `${d.name} en (${b.x}, ${b.y})`).toEqual(couvertures.get(b.uid));
      services++;
    }
    expect(services).toBeGreaterThan(10);
  }, 120_000);
});
