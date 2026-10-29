import { describe, expect, it } from "vitest";
import { choisirPlansContrastes, type PlanComparable } from "./plansAuChoix";
import { scaleResultToHalfTile } from "./halfTileAdapter";

const plan = (residents: number, fullyCovered: number, feu: number, net: number, houses = 100): PlanComparable => ({
  residents, houses, fullyCovered, money: { net }, feasible: true,
  attrsTotal: { Happiness: 100, Money: 100, Health: 100, FireSafety: feu * houses },
});

describe("plans au choix", () => {
  it("un plan battu partout par un autre n'est jamais proposé", () => {
    const reco = plan(1000, 90, 1, 500);
    const domine = plan(900, 80, 0.5, 400);
    expect(choisirPlansContrastes(reco, [reco, domine]).map((c) => c.plan)).toEqual([reco]);
  });

  it("chaque alternative l'emporte nettement sur un critère, et le dit", () => {
    const reco = plan(1000, 90, 0, 500); // sain
    const peuple = plan(1100, 92, -1.7, 520); // +10 % d'habitants, déficit
    const proche = plan(1003, 90, -0.1, 501); // pareil à 1 % près : pas un vrai choix
    const choix = choisirPlansContrastes(reco, [reco, peuple, proche]);
    expect(choix.map((c) => c.plan)).toEqual([reco, peuple]);
    expect(choix[0].atouts).toEqual(["bilan"]);
    expect(choix[1].atouts).toEqual(expect.arrayContaining(["habitants", "maisons", "argent"]));
  });

  it("trois plans au plus, le recommandé en tête", () => {
    const reco = plan(1000, 100, 0, 500);
    const c = [reco, plan(1200, 90, -2, 400), plan(900, 130, -1, 400), plan(950, 95, -0.5, 900)];
    const choix = choisirPlansContrastes(reco, c);
    expect(choix).toHaveLength(3);
    expect(choix[0].plan).toBe(reco);
  });

  it("les alternatives sont reprojetées en demi-cases avec le plan recommandé", () => {
    const tuile = { buildings: [{ uid: "a", defId: "g1", x: 3, y: 4, rotation: 0 as const, locked: false }], roads: [], fields: [] };
    const r = scaleResultToHalfTile({ ...tuile, alternatives: [tuile] }, true);
    expect(r.buildings[0]).toMatchObject({ x: 6, y: 8 });
    expect(r.alternatives[0].buildings[0]).toMatchObject({ x: 6, y: 8 });
  });
});
