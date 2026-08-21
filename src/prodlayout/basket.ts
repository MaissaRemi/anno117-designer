import { eco, goodName, type Lookup } from "./chain";
import { addF, frac, mulF, subF, type Frac } from "./frac";

/**
 * LE PANIER — ce que l'utilisateur a choisi, littéralement.
 *
 * À la différence de `chain.ts`, rien n'est déduit : le panier ne remonte aucun arbre et
 * n'ajoute aucun producteur. Il constate. C'est `complete.ts` qui propose les ajouts, et
 * c'est un geste explicite de l'utilisateur, jamais un effet de bord du plan.
 */

export interface BasketLine {
  defId: string;
  count: number;
}

export interface Basket {
  lines: BasketLine[];
}

/** Un débit de bien, en unités par minute, exact. */
export interface GoodFlow {
  good: string;
  name: string;
  ratePerMin: Frac;
}

/** Ce que le module ne peut pas vérifier hors terrain — signalé, jamais bloquant. */
export interface Advisory {
  defId: string;
  slotType: string;
}

export interface Balance {
  produced: GoodFlow[];
  consumed: GoodFlow[];
  surplus: GoodFlow[];
  deficits: GoodFlow[];
  advisories: Advisory[];
}

/**
 * Panier canonique : doublons fusionnés, comptes tronqués à l'entier, comptes ≤ 0
 * écartés, ordre total par defId. L'ordre total n'est pas cosmétique — c'est lui qui rend
 * deux paniers saisis dans un ordre différent rigoureusement identiques, donc leurs plans
 * comparables.
 */
export function normalizeBasket(lines: readonly BasketLine[]): Basket {
  const acc = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isFinite(l.count)) continue;
    acc.set(l.defId, (acc.get(l.defId) ?? 0) + Math.trunc(l.count));
  }
  return {
    lines: [...acc.entries()]
      .filter(([, n]) => n > 0)
      .map(([defId, count]) => ({ defId, count }))
      .sort((a, b) => a.defId.localeCompare(b.defId)),
  };
}

const flowsOf = (m: Map<string, Frac>): GoodFlow[] =>
  [...m.entries()]
    .map(([good, ratePerMin]) => ({ good, name: goodName(good), ratePerMin }))
    .sort((a, b) => a.good.localeCompare(b.good));

/** Production moins consommation, bien par bien, en rationnels exacts. */
export function balanceBasket(basket: Basket, lookup: Lookup): Balance {
  const prod = new Map<string, Frac>();
  const cons = new Map<string, Frac>();
  const advisories: Advisory[] = [];

  const bump = (m: Map<string, Frac>, good: string, f: Frac) =>
    m.set(good, addF(m.get(good) ?? frac(0), f));

  for (const line of basket.lines) {
    const slotType = lookup(line.defId)?.slotType;
    if (slotType) advisories.push({ defId: line.defId, slotType });
    const p = eco.buildingProd[line.defId];
    if (!p?.cycleTime) continue;
    const n = frac(line.count);
    for (const o of p.outputs) bump(prod, o.good, mulF(n, frac(o.amount * 60, p.cycleTime)));
    for (const i of p.inputs) bump(cons, i.good, mulF(n, frac(i.amount * 60, p.cycleTime)));
  }

  const surplus = new Map<string, Frac>();
  const deficits = new Map<string, Frac>();
  for (const g of new Set([...prod.keys(), ...cons.keys()])) {
    const d = subF(prod.get(g) ?? frac(0), cons.get(g) ?? frac(0));
    if (d.n > 0) surplus.set(g, d);
    else if (d.n < 0) deficits.set(g, mulF(d, frac(-1)));
  }

  return {
    produced: flowsOf(prod),
    consumed: flowsOf(cons),
    surplus: flowsOf(surplus),
    deficits: flowsOf(deficits),
    advisories: advisories.sort((a, b) => a.defId.localeCompare(b.defId)),
  };
}
