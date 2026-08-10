import type { ChainResult } from "./chain";
import { commonMultiplier, toNumber, type Frac } from "./frac";

/**
 * DU RATIO EXACT AU PLAN POSABLE.
 *
 * On ne pose pas un demi-moulin : le compte exact s'arrondit au supérieur, et l'écart
 * devient une SOUS-UTILISATION qu'il faut afficher. Le lot parfait — le PPCM des
 * dénominateurs — est le plus petit multiple de la commande où cet écart disparaît.
 */

export interface OrderItem {
  defId: string;
  exact: Frac;
  /** Copies effectivement posées : `ceil(exact)`. */
  placed: number;
  /** Part de la capacité posée réellement employée, dans ]0..1]. */
  utilisation: number;
}

export interface Order {
  items: OrderItem[];
  /** Multiplicateur de la commande annulant tout gaspillage. 1 = déjà parfait. */
  perfectMultiplier: number;
}

export function buildOrder(chain: ChainResult): Order {
  const items = chain.nodes.map((n) => {
    const exactN = toNumber(n.exact);
    const placed = Math.ceil(exactN);
    return { defId: n.defId, exact: n.exact, placed, utilisation: placed > 0 ? exactN / placed : 0 };
  });
  return { items, perfectMultiplier: commonMultiplier(chain.nodes.map((n) => n.exact)) };
}
