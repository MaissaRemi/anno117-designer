import type { BuildingDef, Layout, PlacedBuilding } from "../model/types";
import { buildChain, eco, type ChainResult } from "./chain";
import { buildOrder, type Order } from "./lot";
import { packBlueprint, type PackResult } from "./pack";
import { buildReport, type Report } from "./report";

/**
 * BLUEPRINTS DE PRODUCTION — la seule porte d'entrée du module.
 *
 * Le résultat porte un `Layout` STANDARD, en grille TUILE (`cellsPerTile` absent) : c'est
 * ce qui permet à `src/render/draw.ts` et `exportImage.ts` de le dessiner sans adaptateur.
 */

export interface LayoutPlan {
  layout: Layout;
  chain: ChainResult;
  order: Order;
  report: Report;
  box: { w: number; h: number };
  tiles: { buildings: number; fields: number; roads: number };
  efficiency: number;
  gaps: string[];
}

export interface PlanOptions {
  /** GUID des biens que l'utilisateur choisit d'importer plutôt que de produire. */
  imported?: ReadonlySet<string>;
}

/** Entrepôt canonique de la région : template `Warehouse`, plus petit GUID. */
export function pickWarehouse(catalog: BuildingDef[], region?: string): BuildingDef {
  const all = catalog
    .filter((d) => d.template === "Warehouse")
    .sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0));
  const found = (region ? all.find((d) => d.region === region) : undefined) ?? all[0];
  if (!found) throw new Error("Aucun entrepôt dans le catalogue.");
  return found;
}

export function planProductionLayout(
  catalog: BuildingDef[],
  targetDefId: string,
  count: number,
  opts: PlanOptions = {},
): LayoutPlan {
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const lookup = (id: string) => byId.get(id);

  const chain = buildChain(targetDefId, count, lookup, opts.imported);
  const order = buildOrder(chain);
  const warehouse = pickWarehouse(catalog, eco.buildingRegion[targetDefId]);

  const packed: PackResult = packBlueprint({
    items: order.items.map((i) => ({ defId: i.defId, count: i.placed })),
    warehouseDefId: warehouse.id,
    lookup,
  });

  const buildings: PlacedBuilding[] = packed.placements.map((p) => ({
    uid: p.uid, defId: p.defId, x: p.x, y: p.y, rotation: p.rot, locked: false,
  }));

  const layout: Layout = {
    grid: { w: packed.w, h: packed.h, usable: new Array(packed.w * packed.h).fill(true) },
    buildings,
    fields: packed.fields.map((f) => ({ x: f.x, y: f.y, ownerUid: f.ownerUid, fieldType: f.fieldType })),
    roads: packed.roads.map((r) => ({ x: r.x, y: r.y, gen: true })),
  };

  const extras = packed.placements.filter((p) => p.defId === warehouse.id);
  const report = buildReport(chain, order, lookup, [{ defId: warehouse.id, count: extras.length }]);

  return {
    layout,
    chain,
    order,
    report,
    box: { w: packed.w, h: packed.h },
    tiles: packed.tiles,
    efficiency: packed.efficiency,
    gaps: [...chain.gaps, ...packed.gaps],
  };
}
