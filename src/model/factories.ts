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

export function emptyLayout(w = 40, h = 40): Layout {
  return { grid: makeGrid(w, h), buildings: [], fields: [], roads: [] };
}

export function makeBuildingDef(partial: Partial<BuildingDef> = {}): BuildingDef {
  return {
    id: partial.id ?? uid("def"),
    name: partial.name ?? "Nouveau bâtiment",
    category: partial.category ?? "production",
    size: partial.size ?? { w: 3, h: 3 },
    rotatable: partial.rotatable ?? true,
    needsRoad: partial.needsRoad ?? true,
    radius: partial.radius,
    field: partial.field,
    color: partial.color ?? "#8d6e63",
    // champs optionnels (extraction jeu) préservés
    guid: partial.guid,
    nameInternal: partial.nameInternal,
    region: partial.region,
    icon: partial.icon,
    streetRange: partial.streetRange,
    production: partial.production,
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
