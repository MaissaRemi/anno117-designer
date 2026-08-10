import { eco, goodName, ratePerMin, type ChainResult, type Lookup } from "./chain";
import { toNumber } from "./frac";
import type { Order } from "./lot";

/**
 * RÉCAPITULATIF CHIFFRÉ.
 *
 * Pas de ligne « coût de construction » : `economy.generated.json` porte `buildingUpkeep`
 * mais aucun prix de pose. Une case absente vaut mieux qu'un chiffre inventé.
 */

export interface ReportBuilding {
  defId: string;
  name: string;
  count: number;
  /** 1 = pleinement employé. Vaut 1 pour ce qui n'est pas dans la chaîne (entrepôts). */
  utilisation: number;
}

export interface ReportWorkforce {
  tier: string;
  name: string;
  amount: number;
}

export interface ReportImport {
  good: string;
  name: string;
  ratePerMin: number;
  costPerMin: number;
}

export interface Report {
  buildings: ReportBuilding[];
  upkeep: number;
  workforce: ReportWorkforce[];
  production: { good: string; name: string; ratePerMin: number };
  marketValuePerMin: number;
  imports: ReportImport[];
  importCostPerMin: number;
}

const tierName = (guid: string): string =>
  eco.tiers.find((t) => t.guid === guid)?.name ?? guid;

export function buildReport(
  chain: ChainResult,
  order: Order,
  lookup: Lookup,
  extra: { defId: string; count: number }[],
): Report {
  const buildings: ReportBuilding[] = [];
  const counts = new Map<string, number>();

  for (const it of order.items) {
    buildings.push({
      defId: it.defId,
      name: lookup(it.defId)?.name ?? it.defId,
      count: it.placed,
      utilisation: it.utilisation,
    });
    counts.set(it.defId, it.placed);
  }
  for (const e of extra) {
    buildings.push({ defId: e.defId, name: lookup(e.defId)?.name ?? e.defId, count: e.count, utilisation: 1 });
    counts.set(e.defId, (counts.get(e.defId) ?? 0) + e.count);
  }

  let upkeep = 0;
  const wf = new Map<string, number>();
  for (const [defId, n] of counts) {
    upkeep += (eco.buildingUpkeep[defId] ?? 0) * n;
    for (const w of eco.buildingWorkforce[defId] ?? []) {
      wf.set(w.tier, (wf.get(w.tier) ?? 0) + w.amount * n);
    }
  }

  const target = chain.nodes[0];
  const rate = target
    ? toNumber(target.exact) * toNumber(ratePerMin(eco.buildingProd[target.defId], chain.targetGood))
    : 0;

  const imports = chain.imports.map((i) => ({
    good: i.good,
    name: goodName(i.good),
    ratePerMin: i.ratePerMin,
    costPerMin: i.ratePerMin * (eco.goodPrices[i.good] ?? 0),
  }));

  return {
    buildings,
    upkeep: Math.round(upkeep),
    workforce: [...wf.entries()]
      .map(([tier, amount]) => ({ tier, name: tierName(tier), amount: Math.ceil(amount) }))
      .sort((a, b) => a.tier.localeCompare(b.tier)),
    production: { good: chain.targetGood, name: goodName(chain.targetGood), ratePerMin: rate },
    marketValuePerMin: rate * (eco.goodPrices[chain.targetGood] ?? 0),
    imports,
    importCostPerMin: Math.round(imports.reduce((s, i) => s + i.costPerMin, 0)),
  };
}
