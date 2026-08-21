import type { BuildingDef, Layout, PlacedBuilding } from "../model/types";
import { balanceBasket, normalizeBasket, type Advisory, type Balance, type Basket } from "./basket";
import { buildChain, eco, type ChainResult } from "./chain";
import type { ExitPoint, ExitSide } from "./exit";
import { buildOrder, type Order } from "./lot";
import type { PackResult } from "./pack";
import { buildReport, type Report } from "./report";
import { searchBox, type BoxSpec } from "./search";
import { direUnmet, type PlanRefus } from "./unmet";

/**
 * BLUEPRINTS DE PRODUCTION — les deux portes du module.
 *
 * `planFromBasket` est la porte de fond : une commande LIBRE de bâtiments, posée
 * telle quelle. `planProductionLayout` en est un cas particulier — elle déplie une chaîne
 * en panier, puis passe par la même porte. Un seul chemin de placement, donc aucune
 * divergence possible entre les deux.
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

export interface BasketPlanOptions {
  /** Bord par lequel la route sortira rejoindre le comptoir de l'île. */
  exitSide: ExitSide;
  box?: BoxSpec;
}

export interface BasketPlan {
  layout: Layout;
  basket: Basket;
  balance: Balance;
  box: { w: number; h: number };
  tiles: { buildings: number; fields: number; roads: number };
  efficiency: number;
  /** Toujours vrai : un plan non servi sort en `PlanRefus`, jamais en `BasketPlan`. */
  served: true;
  exit: ExitPoint;
  advisories: Advisory[];
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
  const warehouse = pickWarehouse(catalog, lookup(basket.lines[0].defId)?.region);

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
    tiles: packed.tiles,
    efficiency: packed.efficiency,
    served: true,
    exit: packed.exit,
    advisories: packed.advisories,
  };
}

/**
 * Déplie une chaîne de production en panier, puis passe par `planFromBasket`.
 *
 * Le récapitulatif reste celui de la chaîne : elle a un bien CIBLE, ce qu'un panier libre
 * n'a pas. Les deux vues du même plan cohabitent donc, plutôt que d'en appauvrir une.
 *
 * `exitSide: "sud"` n'est pas arbitraire — l'épine du squelette longe l'entrepôt par en
 * dessous, donc c'est le bord que la voirie atteint au meilleur prix.
 *
 * Cette porte reste TOLÉRANTE : elle rend toujours un plan, et liste ses manques dans
 * `gaps`. Le verdict strict appartient à `planFromBasket`, où l'appelant a demandé un
 * refus chiffré. Les avoir confondus a fait afficher une erreur à la place du plan dans
 * l'onglet Production — trouvé dans le navigateur, comme le défaut de l'Amphithéâtre
 * avant lui, et pour la même raison : les tests partaient tous de la boulangerie.
 */
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
  const basket = normalizeBasket(order.items.map((i) => ({ defId: i.defId, count: i.placed })));

  const warehouse = pickWarehouse(catalog, eco.buildingRegion[targetDefId]);
  const packed = searchBox(
    {
      items: basket.lines.map((l) => ({ defId: l.defId, count: l.count })),
      warehouseDefId: warehouse.id,
      lookup,
    },
    { mode: "auto" },
    "sud",
  );

  const nom = (id: string) => lookup(id)?.name ?? id;
  const extras = packed.placements.filter((p) => p.defId === warehouse.id);

  return {
    layout: toLayout(packed),
    chain,
    order,
    report: buildReport(chain, order, lookup, [{ defId: warehouse.id, count: extras.length }]),
    box: { w: packed.w, h: packed.h },
    tiles: packed.tiles,
    efficiency: packed.efficiency,
    gaps: [...chain.gaps, ...packed.unmet.map((u) => direUnmet(u, nom))],
  };
}
