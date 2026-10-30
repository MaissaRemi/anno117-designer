import type { BuildingDef } from "./types";

/**
 * ENTREPÔT DE L'ÎLE, du bon monde.
 *
 * Albion ne nomme pas son entrepôt comme le Latium : ses trois niveaux portent le template
 * `Warehouse_Marsh` (« Warehouse Roman Celtic 01/02/03 ») là où le Latium utilise `Warehouse`.
 * Les deux appelants ne cherchaient que `Warehouse` : ils ne trouvaient donc JAMAIS la version
 * celtique et retombaient sur l'entrepôt romain, non constructible sur Albion. `prodPlan`
 * faisait pire encore, en codant `region === "Roman"` en dur quelle que soit l'île.
 *
 * Détecté par l'invariant `monde-unique` : « 11 bâtiment(s) d'un autre monde que l'île
 * (Entrepôt) » sur celtic_island_large_07, avec exploitations et production locale. Le même défaut
 * restait dans `prodlayout` (blueprints de la production de la commande) jusqu'au 30/10/2026.
 */
const WAREHOUSE_TPLS = ["Warehouse", "Warehouse_Marsh"];

/** Un entrepôt, de l'un ou l'autre monde. */
export const estEntrepot = (d: BuildingDef | undefined): boolean => WAREHOUSE_TPLS.includes(d?.template ?? "");

export function pickWarehouseDef(catalog: BuildingDef[], region?: string): BuildingDef | undefined {
  const all = catalog.filter(estEntrepot);
  // niveau 1 d'abord : le plus petit GUID du monde voulu
  const mine = all.filter((d) => !region || d.region === region).sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0));
  return mine[0] ?? all.sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0))[0];
}
