import { makeLookup } from "../engine/rules";
import { decode, makeDecoder, type DecodeOutput } from "./greedy";
import { scoreDecode, type Scored } from "./score";
import type { OptimizeRequest } from "./types";

export interface AnnealOutput {
  out: DecodeOutput;
  scored: Scored;
  iters: number;
}

type OnProgress = (iter: number, best: number, placed: number, requested: number) => void;

/** Ordre initial : items développés, gros bâtiments d'abord (meilleur packing). */
function initialOrder(req: OptimizeRequest): string[] {
  const lookup = makeLookup(req.catalog);
  const order: string[] = [];
  for (const it of req.items) for (let i = 0; i < it.qty; i++) order.push(it.defId);
  order.sort((a, b) => area(b) - area(a));
  function area(id: string): number {
    const d = lookup(id);
    if (!d) return 0;
    return d.size.w * d.size.h + (d.field?.tiles ?? 0);
  }
  return order;
}

export function anneal(req: OptimizeRequest, onProgress?: OnProgress): AnnealOutput {
  const dec = makeDecoder(req);
  const requested = req.items.reduce((s, it) => s + it.qty, 0);
  const bandMod = dec.band + 1;

  let order = initialOrder(req);
  let bandOffset = 0;
  let curOut = decode(req, dec, order, bandOffset);
  let cur = scoreDecode(req, curOut);

  let bestOut = curOut;
  let best = cur;

  const start = Date.now();
  const budget = Math.max(200, req.timeMs);
  let iter = 0;

  while (Date.now() - start < budget) {
    iter++;
    const t = (Date.now() - start) / budget; // 0..1
    const temp = Math.max(0.01, 1 - t) * 5; // refroidissement linéaire

    const nOrder = order.slice();
    let nOffset = bandOffset;
    const move = Math.random();
    if (move < 0.2) {
      // décalage vertical de départ
      nOffset = Math.floor(Math.random() * bandMod);
    } else if (move < 0.5 && nOrder.length >= 3) {
      // inversion d'un segment : réordonne des groupes entiers (meilleur regroupement
      // par hauteur d'étagère que de simples échanges)
      let i = (Math.random() * nOrder.length) | 0;
      let j = (Math.random() * nOrder.length) | 0;
      if (i > j) [i, j] = [j, i];
      while (i < j) {
        [nOrder[i], nOrder[j]] = [nOrder[j], nOrder[i]];
        i++;
        j--;
      }
    } else if (move < 0.75 && nOrder.length >= 2) {
      // déplacement d'un élément (insertion ailleurs)
      const from = (Math.random() * nOrder.length) | 0;
      const to = (Math.random() * nOrder.length) | 0;
      const [it] = nOrder.splice(from, 1);
      nOrder.splice(to, 0, it);
    } else if (nOrder.length >= 2) {
      // échange simple de deux éléments
      const i = (Math.random() * nOrder.length) | 0;
      let j = (Math.random() * nOrder.length) | 0;
      if (i === j) j = (j + 1) % nOrder.length;
      [nOrder[i], nOrder[j]] = [nOrder[j], nOrder[i]];
    }

    const nOut = decode(req, dec, nOrder, nOffset);
    const ns = scoreDecode(req, nOut);
    const d = ns.score - cur.score;
    if (d > 0 || Math.random() < Math.exp(d / temp)) {
      order = nOrder;
      bandOffset = nOffset;
      curOut = nOut;
      cur = ns;
      if (ns.score > best.score) {
        best = ns;
        bestOut = nOut;
      }
    }

    if (onProgress && iter % 50 === 0) onProgress(iter, best.score, best.placed, requested);
  }

  return { out: bestOut, scored: best, iters: iter };
}
