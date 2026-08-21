import { balanceBasket, normalizeBasket, type Basket, type BasketLine } from "./basket";
import { eco, pickProducer, ratePerMin, type Lookup } from "./chain";
import { divF, toNumber } from "./frac";

/**
 * COMPLÉTER LE PANIER — un geste explicite, jamais un effet de bord.
 *
 * Point fixe et non passe unique : ajouter un moulin crée un besoin de blé, qui appelle
 * une ferme, qui n'appelle plus rien. La boucle s'arrête sur trois conditions — plus de
 * déficit, plus rien à ajouter, ou le panier ne bouge plus — et un plafond de passes
 * borne les chaînes cycliques, que `chain.ts` connaît déjà et traite en imports.
 */

const PASSES_MAX = 24;

/** Région dominante du panier, pour choisir un producteur du bon monde. */
function regionOf(basket: Basket, lookup: Lookup): string | undefined {
  const n = new Map<string, number>();
  for (const l of basket.lines) {
    const r = lookup(l.defId)?.region;
    if (r) n.set(r, (n.get(r) ?? 0) + l.count);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function completeBasket(
  basket: Basket,
  lookup: Lookup,
  imported: ReadonlySet<string> = new Set(),
): Basket {
  let cur = normalizeBasket(basket.lines);
  for (let pass = 0; pass < PASSES_MAX; pass++) {
    const ouverts = balanceBasket(cur, lookup).deficits.filter((d) => !imported.has(d.good));
    if (!ouverts.length) return cur;

    const region = regionOf(cur, lookup);
    const ajouts: BasketLine[] = [];
    for (const d of ouverts) {
      const src = pickProducer(d.good, region);
      if (!src) continue; // aucun producteur : le bien s'importera, rien à ajouter
      const r = ratePerMin(eco.buildingProd[src], d.good);
      if (r.n <= 0) continue;
      ajouts.push({ defId: src, count: Math.ceil(toNumber(divF(d.ratePerMin, r))) });
    }
    if (!ajouts.length) return cur;

    const suivant = normalizeBasket([...cur.lines, ...ajouts]);
    if (JSON.stringify(suivant) === JSON.stringify(cur)) return cur;
    cur = suivant;
  }
  return cur;
}
