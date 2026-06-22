import type { BuildingDef, GridShape, Layout, PlacedBuilding, Rotation } from "./types";

let counter = 0;
/** Identifiant unique court (suffisant côté client). */
export function uid(prefix = "u"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function makeGrid(w: number, h: number, usable = true): GridShape {
  return { w, h, usable: new Array(w * h).fill(usable) };
}

/**
 * Layout vide pour l'éditeur : grille ½-tuile (cellsPerTile=2) afin que la
 * construction 45° soit possible d'emblée (cf. geometry.ts). Dimensions par défaut
 * 80×80 cellules = 40×40 tuiles. NB : `makeGrid` seul reste en TUILES (optimiseur/tests).
 */
export function emptyLayout(w = 80, h = 80): Layout {
  return { grid: { ...makeGrid(w, h), cellsPerTile: 2 }, buildings: [], fields: [], roads: [] };
}

/**
 * Redimensionne une grille en PRÉSERVANT le terrain : re-clippe les masques
 * par-case (usable/water/rivers) et filtre les slots hors limites, en gardant
 * l'île d'origine. Les nouvelles cases sont constructibles (usable=true) et non-eau.
 */
export function resizeGridShape(g: GridShape, w: number, h: number): GridShape {
  const clip = (src: boolean[] | undefined, fill: boolean): boolean[] | undefined => {
    if (!src) return undefined;
    const out = new Array(w * h).fill(fill);
    for (let y = 0; y < Math.min(h, g.h); y++)
      for (let x = 0; x < Math.min(w, g.w); x++) out[y * w + x] = src[y * g.w + x];
    return out;
  };
  return {
    w,
    h,
    usable: clip(g.usable, true)!,
    water: clip(g.water, false),
    rivers: clip(g.rivers, false),
    slots: g.slots?.filter((s) => s.x < w && s.y < h),
    islandId: g.islandId,
    cellsPerTile: g.cellsPerTile,
  };
}

export function makeBuildingDef(partial: Partial<BuildingDef> = {}): BuildingDef {
  // valeurs par défaut + spread du partiel : AUCUN champ optionnel ne peut être
  // oublié (transporterRange/template/freeArea/unique/placement/… passent tout seuls).
  return {
    id: uid("def"),
    name: "Nouveau bâtiment",
    category: "production",
    size: { w: 3, h: 3 },
    rotatable: true,
    needsRoad: true,
    color: "#8d6e63",
    ...partial,
  };
}

export function placeBuilding(
  defId: string,
  x: number,
  y: number,
  rotation: Rotation = 0,
  locked = false,
): PlacedBuilding {
  return { uid: uid("b"), defId, x, y, rotation, locked };
}
