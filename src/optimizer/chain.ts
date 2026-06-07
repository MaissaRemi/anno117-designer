import type { BuildingDef } from "../model/types";
import type { RequestItem } from "./types";

/** Débit (par seconde) d'un produit pour une définition. */
function rate(amount: number, cycleTime: number | null): number {
  return amount / (cycleTime && cycleTime > 0 ? cycleTime : 60);
}

/** Carte produit (nom) -> bâtiment producteur (préférence région du root). */
export function buildProducerMap(catalog: BuildingDef[], preferRegion?: string): Map<string, BuildingDef> {
  const map = new Map<string, BuildingDef>();
  for (const def of catalog) {
    if (!def.production) continue;
    for (const o of def.production.outputs) {
      const existing = map.get(o.good);
      if (!existing) {
        map.set(o.good, def);
      } else if (preferRegion && def.region === preferRegion && existing.region !== preferRegion) {
        map.set(o.good, def); // remplace par la variante de la bonne région
      }
    }
  }
  return map;
}

/**
 * Explose la chaîne de production : combien de chaque bâtiment pour `count`
 * exemplaires du bâtiment final, en équilibrant les débits (ratios 100%).
 * Les entrées sans producteur (matières brutes) stoppent la récursion.
 */
export function computeChain(
  catalog: BuildingDef[],
  rootId: string,
  count: number,
): RequestItem[] {
  const defMap = new Map(catalog.map((d) => [d.id, d]));
  const root = defMap.get(rootId);
  if (!root) return [];
  const producers = buildProducerMap(catalog, root.region);
  const counts = new Map<string, number>();

  const add = (defId: string, n: number, depth: number): void => {
    counts.set(defId, (counts.get(defId) ?? 0) + n);
    if (depth <= 0) return;
    const def = defMap.get(defId);
    if (!def?.production) return;
    for (const inp of def.production.inputs) {
      const pdef = producers.get(inp.good);
      if (!pdef || pdef.id === defId || !pdef.production) continue;
      const out = pdef.production.outputs.find((o) => o.good === inp.good);
      if (!out) continue;
      const consume = n * rate(inp.amount, def.production.cycleTime);
      const produce = rate(out.amount, pdef.production.cycleTime);
      if (produce <= 0) continue;
      add(pdef.id, consume / produce, depth - 1);
    }
  };

  add(rootId, count, 20);

  return [...counts.entries()].map(([defId, c]) => ({ defId, qty: Math.max(1, Math.ceil(c)) }));
}

/** Fusionne des items (somme les quantités par defId). */
export function mergeItems(a: RequestItem[], b: RequestItem[]): RequestItem[] {
  const m = new Map<string, number>();
  for (const it of [...a, ...b]) m.set(it.defId, (m.get(it.defId) ?? 0) + it.qty);
  return [...m.entries()].map(([defId, qty]) => ({ defId, qty }));
}
