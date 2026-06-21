import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeLookup } from "../engine/rules";
import { makeGrid } from "../model/factories";
import type { BuildingDef, Layout, PlacedBuilding } from "../model/types";
import { economy } from "./economy";
import { analyzeCoverage } from "./coverage";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

// tier réel ayant une résidence + au moins un service à rayon
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.some((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)),
)!;
const marche = tier.services.find((s) => s.building && (lookup(s.building!)?.streetRange || lookup(s.building!)?.radius?.range))!.building!;

function place(defId: string, x: number, y: number): PlacedBuilding {
  return { uid: `${defId}_${x}_${y}`, defId, x, y, rotation: 0, locked: false };
}

describe("analyzeCoverage", () => {
  it("résidence dans le rayon du service → 100 % couverte pour ce service", () => {
    const grid = makeGrid(80, 80);
    const layout: Layout = {
      grid,
      buildings: [place(tier.residenceId!, 0, 0), place(marche, 4, 4)], // collés (euclidien, pas de routes)
      roads: [],
      fields: [],
    };
    const rep = analyzeCoverage(layout, lookup);
    const s = rep.services.find((x) => x.serviceId === marche)!;
    expect(s.housesRequiring).toBe(1);
    expect(s.pct).toBe(100);
    expect(s.uncovered.length).toBe(0);
  });

  it("résidence hors rayon → service non couvert, cases listées", () => {
    const grid = makeGrid(120, 120);
    const layout: Layout = {
      grid,
      buildings: [place(tier.residenceId!, 0, 0), place(marche, 110, 110)], // très loin
      roads: [],
      fields: [],
    };
    const rep = analyzeCoverage(layout, lookup);
    const s = rep.services.find((x) => x.serviceId === marche)!;
    expect(s.pct).toBe(0);
    expect(s.uncovered.length).toBeGreaterThan(0);
    expect(rep.housesFullyCovered).toBe(0);
  });

  it("rapport cohérent : housesTotal = résidences posées", () => {
    const grid = makeGrid(40, 40);
    const layout: Layout = {
      grid,
      buildings: [place(tier.residenceId!, 0, 0), place(tier.residenceId!, 10, 10)],
      roads: [],
      fields: [],
    };
    const rep = analyzeCoverage(layout, lookup);
    expect(rep.housesTotal).toBe(2);
  });

  it("fork euclidien vs distance-rue : sans route adjacente, le mode rue ne couvre pas", () => {
    // service avec une VRAIE portée-rue (sinon le fork n'existe pas)
    const streetSvc = tier.services.find((s) => s.building && (lookup(s.building)!.streetRange ?? 0) > 0)?.building;
    if (!streetSvc) return; // tier sans service street-range → fork non applicable
    const grid = makeGrid(80, 80);
    // résidence collée au service (euclidien proche) mais SEULE route loin (non adjacente)
    const layout: Layout = {
      grid,
      buildings: [place(tier.residenceId!, 0, 0), place(streetSvc, 0, 4)],
      roads: [{ x: 70, y: 70 }], // roads.size>0 → mode rue, mais aucune route près du service
      fields: [],
    };
    const street = analyzeCoverage(layout, lookup).services.find((s) => s.serviceId === streetSvc)!;
    const eucl = analyzeCoverage(layout, lookup, { euclidean: true }).services.find((s) => s.serviceId === streetSvc)!;
    expect(street.pct).toBe(0); // distance-rue : pas de route atteinte adjacente → non couvert
    expect(eucl.pct).toBe(100); // euclidien forcé : dans le rayon → couvert
  });

  it("raccordement partiel : une copie de service INACTIVE ne couvre pas", () => {
    const grid = makeGrid(80, 80);
    const layout: Layout = {
      grid,
      buildings: [
        { ...place(tier.residenceId!, 0, 0), uid: "house1" },
        { ...place(marche, 0, 4), uid: "svc1" }, // unique copie, couvre la maison (euclidien)
      ],
      roads: [],
      fields: [],
    };
    const req = new Set([marche]);
    const active = analyzeCoverage(layout, lookup, { requiredServices: req });
    const inactive = analyzeCoverage(layout, lookup, { requiredServices: req, inactiveBuildings: new Set(["svc1"]) });
    expect(active.housesFullyCovered).toBe(1);
    expect(inactive.housesFullyCovered).toBe(0); // seule copie inactive → maison non couverte
  });

  it("B4 — requiredServices scope le statut pleinement-couverte au sous-ensemble retenu", () => {
    const grid = makeGrid(80, 80);
    // résidence + UN seul service (marché) collé = couvert ; les autres services du
    // tier ne sont PAS posés
    const layout: Layout = {
      grid,
      buildings: [place(tier.residenceId!, 0, 0), place(marche, 4, 4)],
      roads: [],
      fields: [],
    };
    const full = analyzeCoverage(layout, lookup).housesFullyCovered;
    const scoped = analyzeCoverage(layout, lookup, { requiredServices: new Set([marche]) }).housesFullyCovered;
    // scopé au seul marché (couvert) → la maison est pleinement couverte
    expect(scoped).toBe(1);
    // restreindre les exigences ne peut PAS diminuer le compte (full exige plus de services)
    expect(scoped).toBeGreaterThanOrEqual(full);
    // si le service retenu n'est PAS couvert → 0 maison pleine (même scopé)
    const farLayout: Layout = { ...layout, buildings: [place(tier.residenceId!, 0, 0), place(marche, 75, 75)] };
    expect(analyzeCoverage(farLayout, lookup, { requiredServices: new Set([marche]) }).housesFullyCovered).toBe(0);
  });
});
