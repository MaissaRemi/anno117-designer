import { describe, expect, it } from "vitest";
import { makeBuildingDef } from "../model/factories";
import type { GridShape } from "../model/types";
import { partieEauPosee } from "./geometry";
import { terrainConvient } from "./rules";

// La Cabane de pêcheur du jeu : 8 × 3, les 7 colonnes de droite dans l'eau, 1 à quai.
const pecheur = makeBuildingDef({ id: "pecheur", size: { w: 8, h: 3 }, placement: "water", partieEau: { x: 1, y: 0, w: 7, h: 3 } });

/** 20 × 10 : terre x < 10, eau constructible x ≥ 10. */
function cote(): GridShape {
  const w = 20, h = 10;
  return {
    w, h,
    usable: Array.from({ length: w * h }, (_, c) => c % w < 10),
    water: Array.from({ length: w * h }, (_, c) => c % w >= 10),
  };
}

describe("bâtiments côtiers : à cheval sur la terre et l'eau", () => {
  it("la partie dans l'eau suit la rotation", () => {
    expect(partieEauPosee(pecheur, 0)).toEqual({ x: 1, y: 0, w: 7, h: 3 });
    expect(partieEauPosee(pecheur, 180)).toEqual({ x: 0, y: 0, w: 7, h: 3 });
    expect(partieEauPosee(pecheur, 90)).toEqual({ x: 0, y: 1, w: 3, h: 7 });
    expect(partieEauPosee(pecheur, 270)).toEqual({ x: 0, y: 0, w: 3, h: 7 });
    expect(partieEauPosee(pecheur, 45)).toBeUndefined();
  });

  it("se pose quai à terre, le reste dans l'eau — et nulle part ailleurs", () => {
    const g = cote();
    expect(terrainConvient(g, pecheur, 9, 2, 0, 1)).toBe(true); // quai en x = 9, eau de 10 à 16
    expect(terrainConvient(g, pecheur, 10, 2, 0, 1)).toBe(false); // tout dans l'eau : pas de quai
    expect(terrainConvient(g, pecheur, 2, 2, 0, 1)).toBe(false); // tout à terre
    expect(terrainConvient(g, pecheur, 9, 2, 180, 1)).toBe(false); // retourné, l'eau serait à terre
  });
});
