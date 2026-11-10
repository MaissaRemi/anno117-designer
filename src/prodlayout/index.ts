import type { BuildingDef, Layout, PlacedBuilding } from "../model/types";
import { balanceBasket, type Advisory, type Balance, type Basket } from "./basket";
import type { ExitPoint, ExitSide } from "./exit";
import type { PackResult } from "./pack";
import { searchBox, type BoxSpec } from "./search";
import { direUnmet, type PlanRefus } from "./unmet";
import { pickWarehouseDef } from "../model/entrepot";

/**
 * BLUEPRINTS DE PRODUCTION — la porte du module.
 *
 * `planFromBasket` pose une commande LIBRE de bâtiments, telle quelle. C'est elle que la
 * production de la commande (`commande/production.ts`) appelle, lot par lot. L'ancienne porte
 * `planProductionLayout` (une chaîne dépliée, pour l'onglet Production hors île) a été retirée
 * avec l'onglet, le 30/10/2026, au profit de l'île de production.
 *
 * Le résultat porte un `Layout` STANDARD, en grille TUILE (`cellsPerTile` absent) : c'est
 * ce qui permet à `src/render/draw.ts` et `exportImage.ts` de le dessiner sans adaptateur.
 */

export interface BasketPlanOptions {
  /** Bord par lequel la route sortira rejoindre le comptoir de l'île. */
  exitSide: ExitSide;
  box?: BoxSpec;
  /**
   * Région de l'île : fixe l'entrepôt. Sans elle, la région du premier bâtiment du panier — or
   * un bâtiment commun aux deux mondes n'en a pas, et l'entrepôt romain se retrouvait en Albion.
   */
  region?: string;
}

export interface BasketPlan {
  layout: Layout;
  basket: Basket;
  balance: Balance;
  box: { w: number; h: number };
  /** Coin de `box` dans la boîte demandée (cf. `PackResult.origine`). */
  origine: { x: number; y: number };
  tiles: { buildings: number; fields: number; roads: number };
  efficiency: number;
  /** Toujours vrai : un plan non servi sort en `PlanRefus`, jamais en `BasketPlan`. */
  served: true;
  exit: ExitPoint;
  advisories: Advisory[];
}

/** Entrepôt canonique de la région : plus petit GUID, templates des deux mondes (`model/entrepot.ts`). */
export function pickWarehouse(catalog: BuildingDef[], region?: string): BuildingDef {
  const found = pickWarehouseDef(catalog, region);
  if (!found) throw new Error("Aucun entrepôt dans le catalogue.");
  return found;
}

/** Grille TUILE portant le masque réel du plan — plus de `usable` rempli de `true`. */
function toLayout(packed: PackResult): Layout {
  const buildings: PlacedBuilding[] = packed.placements.map((p) => ({
    uid: p.uid, defId: p.defId, x: p.x, y: p.y, rotation: p.rot, locked: false,
  }));
  return {
    grid: { w: packed.w, h: packed.h, usable: [...packed.usable] },
    buildings,
    fields: packed.fields.map((f) => ({
      x: f.x, y: f.y, ownerUid: f.ownerUid, fieldType: f.fieldType,
    })),
    roads: packed.roads.map((r) => ({ x: r.x, y: r.y, gen: true })),
  };
}

/**
 * Pose une commande libre de bâtiments : le plus petit plan ENTIÈREMENT servi, avec une
 * sortie de route sur le bord demandé.
 *
 * Rend un `PlanRefus` chiffré plutôt qu'un plan dégradé. C'est la leçon de la falaise du
 * verdict : un plan effondré livré comme sain ne se voit pas, et coûte d'autant plus cher
 * qu'il a l'air d'aller bien.
 */
export function planFromBasket(
  catalog: BuildingDef[],
  basket: Basket,
  opts: BasketPlanOptions,
): BasketPlan | PlanRefus {
  if (!basket.lines.length) {
    return { refuse: true, raison: "Le panier est vide.", nonServis: [] };
  }
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const lookup = (id: string) => byId.get(id);
  const nom = (id: string) => lookup(id)?.name ?? id;
  const warehouse = pickWarehouse(catalog, opts.region ?? basket.lines.map((l) => lookup(l.defId)?.region).find(Boolean));

  const packed = searchBox(
    {
      items: basket.lines.map((l) => ({ defId: l.defId, count: l.count })),
      warehouseDefId: warehouse.id,
      lookup,
    },
    opts.box ?? { mode: "auto" },
    opts.exitSide,
  );

  if (!packed.served || !packed.exit) {
    return {
      refuse: true,
      raison: packed.unmet.map((u) => direUnmet(u, nom)).join(" · ") || "Plan non servi.",
      nonServis: packed.unmet,
    };
  }

  return {
    layout: toLayout(packed),
    basket,
    balance: balanceBasket(basket, lookup),
    box: { w: packed.w, h: packed.h },
    origine: packed.origine,
    tiles: packed.tiles,
    efficiency: packed.efficiency,
    served: true,
    exit: packed.exit,
    advisories: packed.advisories,
  };
}
