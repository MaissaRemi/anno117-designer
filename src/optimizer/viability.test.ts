import { describe, expect, it } from "vitest";
import { populationEffective, severiteVitale, viableSubset, type Weighed } from "./viability";

// ═══ LE GARDE-FOU RESTE STRICT ═════════════════════════════════════════════════════════
//
// Le VERDICT du plan livré tolère un déficit sous le plancher de bruit du modèle
// (`BRUIT_VITAL`, cf. `islandPlan.ts`). Le GARDE-FOU, lui, ne le tolère pas : il rase les
// maisons jusqu'au retour à zéro, et seule la tolérance demandée par le joueur ouvre une
// marge. Les deux ne doivent jamais être confondus — sans quoi un plancher destiné au
// jugement se mettrait à décider quelles maisons restent debout.
//
// Fixture en arithmétique pure : 200 maisons de capacité 1, donc 200 habitants, sous le
// premier échelon de l'échelle de rang romaine — aucun malus de rang, le bilan de l'île se
// réduit à la somme des attributs.
const maisons = (n: number, fire: number): Weighed[] =>
  Array.from({ length: n }, (_, i) => ({
    cap: 1,
    key: i,
    attrs: { Happiness: 10, Money: 10, Health: 10, FireSafety: fire },
  }));

describe("viableSubset — le garde-fou ignore le plancher de bruit", () => {
  it("à tolérance nulle, −0,03/maison est rasé jusqu'au bout, jamais toléré", () => {
    // Le déficit porte sur CHAQUE maison : aucun sous-ensemble non vide n'est à l'équilibre,
    // le seul point fixe strict est l'ensemble vide. Si le plancher du verdict fuyait
    // jusqu'ici, les 200 maisons tiendraient — c'est exactement ce que ce test interdit.
    expect(viableSubset(maisons(200, -0.03), "Roman").length).toBe(0);
  });

  it("seule la tolérance DEMANDÉE ouvre la marge", () => {
    expect(viableSubset(maisons(200, -0.03), "Roman", { tolerance: 0.05 }).length).toBe(200);
  });

  it("un bilan positif n'est pas touché", () => {
    expect(viableSubset(maisons(200, 2), "Roman").length).toBe(200);
  });
});

// ═══ LE CLASSEMENT CESSE D'ÊTRE BINAIRE ════════════════════════════════════════════════
//
// Le drapeau `viable`, classé avant la population, transformait un écart de trois centièmes
// de point par maison en effondrement d'un facteur quatre. Le plancher de bruit n'était qu'un
// pare-feu : il reste un seuil DUR, et une île livrée n'en est qu'à 11 %.
describe("populationEffective — escompte continu du risque", () => {
  const sain = { Happiness: 3637, Money: 46414, Health: 2883, FireSafety: 12 };
  const bruit = { Happiness: 3637, Money: 46414, Health: 2883, FireSafety: -21 };

  it("un plan sain n'est pas pénalisé d'un seul habitant", () => {
    expect(populationEffective(20_904, sain, 625)).toBe(20_904);
  });

  it("un déficit dans la bande de bruit ne coûte rien non plus", () => {
    // −21 sur 625 maisons = −0,034/maison, sous le plancher de 0,05
    expect(populationEffective(20_904, bruit, 625)).toBe(20_904);
  });

  it("LA FALAISE EST SUPPRIMÉE : le cas mesuré de medium_05", () => {
    // Avant : Patriciens (20 904 hab, FireSafety −21) était écarté par `viable=false`, et
    // autoTier retombait sur Plébéiens (4 992 hab, bilan sain). Le classement doit désormais
    // retenir le premier — c'est un MEILLEUR plan, pas un plan dangereux.
    const patriciens = populationEffective(20_904, bruit, 625);
    const plebeiens = populationEffective(4_992, sain, 416);
    expect(patriciens).toBeGreaterThan(plebeiens);
  });

  it("un plan VRAIMENT mauvais ne gagne pas en logeant plus", () => {
    // −1 point par maison : au-delà de tout rattrapage. Il ne reste que 5 % de la population
    // effective (l'escompte s'annule à `SEVERITE_INGERABLE` + la bande, soit 1,05), et c'est
    // la propriété qui compte : DIX FOIS plus peuplé, il perd quand même contre un plan sain.
    const enFeu = { Happiness: 100, Money: 100, Health: 100, FireSafety: -625 };
    expect(populationEffective(50_000, enFeu, 625)).toBeCloseTo(2_500, 0);
    expect(populationEffective(50_000, enFeu, 625)).toBeLessThan(populationEffective(4_992, sain, 416));
  });

  it("au-dela de l'ingerable, la population effective est NULLE", () => {
    const ruine = { FireSafety: -2 * 625 }; // −2/maison
    expect(populationEffective(50_000, ruine, 625)).toBe(0);
  });

  it("l'escompte est CONTINU : pas de nouveau seuil dur", () => {
    // juste au-delà de la bande, la pénalité est infinitésimale — c'est tout l'intérêt
    const aPeine = { FireSafety: -0.06 * 1000 }; // −0,06/maison sur 1000 maisons
    const p = populationEffective(10_000, aPeine, 1000);
    expect(p).toBeGreaterThan(9_800); // ~−1 %, pas −75 %
    expect(p).toBeLessThan(10_000);
  });

  it("la tolérance du joueur décale la bande, elle ne la remplace pas", () => {
    const gros = { FireSafety: -500 }; // −0,5/maison sur 1000
    expect(populationEffective(10_000, gros, 1000)).toBeLessThan(6_000);
    expect(populationEffective(10_000, gros, 1000, 1)).toBe(10_000); // toléré : aucun escompte
  });
});

describe("severiteVitale", () => {
  it("rend 0 sur un bilan sain et le pire déficit par maison sinon", () => {
    expect(severiteVitale({ FireSafety: 10, Money: 5 }, 100)).toBe(0);
    expect(severiteVitale({ FireSafety: -50, Money: -10 }, 100)).toBeCloseTo(0.5, 6);
  });

  it("sans maison, un déficit est inrattrapable", () => {
    expect(severiteVitale({ FireSafety: -1 }, 0)).toBe(Infinity);
    expect(severiteVitale({}, 0)).toBe(0);
  });
});
