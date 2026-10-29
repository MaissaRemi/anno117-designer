import { describe, expect, it } from "vitest";
import { copiesEnTrop } from "./doublons";

describe("copiesEnTrop", () => {
  it("retire une copie dont toutes les maisons sont vues ailleurs", () => {
    // copie 1 voit {1,2}, couvertes aussi par 0 et 2
    expect(copiesEnTrop([[0, 1], [1, 2], [2, 3]], 4)).toEqual([1]);
  });

  it("ne retire pas deux copies qui ne sont redondantes qu'ensemble", () => {
    // 0 et 1 voient exactement les mêmes maisons : une seule des deux part
    expect(copiesEnTrop([[0, 1], [0, 1]], 2)).toHaveLength(1);
  });

  it("garde toujours une copie, même inutile", () => {
    expect(copiesEnTrop([[], []], 0)).toEqual([0]);
    expect(copiesEnTrop([[]], 0)).toEqual([]);
  });

  it("aucune maison ne perd sa couverture", () => {
    const vues = [[0, 1, 2], [2, 3], [3, 4, 5], [1, 2, 3, 4], [5]];
    const parties = new Set(copiesEnTrop(vues, 6));
    const restantes = vues.filter((_, k) => !parties.has(k));
    for (let m = 0; m < 6; m++) expect(restantes.some((v) => v.includes(m))).toBe(true);
  });
});
