import { describe, expect, it } from "vitest";
import { viableSubset, type Weighed } from "./viability";

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
