import type { ExitSide } from "./exit";
import { better, expandCopies, tryBox, usefulArea, type PackInput, type PackResult } from "./pack";

/**
 * LE CHOIX DE LA BOÎTE.
 *
 * Deux régimes. En boîte imposée il n'y a rien à chercher : une tentative, servie ou
 * refusée en chiffrant. En mode `auto`, un balayage de candidates donne un premier plan
 * servi, puis une DESCENTE PAR PAS DE 1 le rétrécit tant que le service tient.
 *
 * C'est la descente qui rend l'invariant de minimalité vérifiable. « Retirer une ligne ou
 * une colonne casse le service » est une phrase que le test peut exécuter ; « la meilleure
 * des vingt-quatre candidates » ne dit rien du tout.
 */

export type BoxSpec =
  | { mode: "auto" }
  | { mode: "taille"; w: number; h: number }
  | { mode: "forme"; w: number; h: number; usable: readonly boolean[] };

const RATIOS: [number, number][] = [[1, 1], [4, 3], [3, 2], [2, 1]];
const INFLATIONS = [1.15, 1.3, 1.5, 1.8, 2.2, 2.8];

export function searchBox(input: PackInput, box: BoxSpec, exitSide: ExitSide): PackResult {
  if (box.mode !== "auto") {
    return tryBox(input, box.w, box.h, exitSide, box.mode === "forme" ? box.usable : undefined);
  }

  const wh = input.lookup(input.warehouseDefId);
  if (!wh) throw new Error(`Entrepôt introuvable : ${input.warehouseDefId}`);
  const area = usefulArea(expandCopies(input), wh);

  let best: PackResult | null = null;
  for (const inflation of INFLATIONS) {
    for (const [rw, rh] of RATIOS) {
      const unit = Math.sqrt((area * inflation) / (rw * rh));
      const w = Math.max(wh.size.w + 2, Math.ceil(unit * rw));
      const h = Math.max(wh.size.h + 3, Math.ceil(unit * rh));
      const r = tryBox(input, w, h, exitSide);
      if (!best || better(r, best)) best = r;
    }
  }
  if (!best) throw new Error("Aucune boîte candidate n'a pu être essayée.");
  return best.served ? descendre(input, best, exitSide) : best;
}

/**
 * Rétrécit d'une ligne ou d'une colonne tant que le plan reste servi.
 *
 * Le placeur étant glouton, rétrécir n'est pas monotone : une boîte plus petite peut
 * réussir là où une plus grande échouait, parce que l'ordre de balayage change. On
 * s'arrête donc au premier palier où NI la largeur NI la hauteur ne peuvent céder — c'est
 * un minimum local au pas de 1, et c'est exactement ce que l'invariant affirme.
 */
function descendre(input: PackInput, depart: PackResult, exitSide: ExitSide): PackResult {
  let cur = depart;
  for (let garde = 0; garde < 200; garde++) {
    let avance = false;
    for (const [dw, dh] of [[1, 0], [0, 1]] as const) {
      const w = cur.w - dw;
      const h = cur.h - dh;
      if (w < 1 || h < 1) continue;
      const essai = tryBox(input, w, h, exitSide);
      if (essai.served) {
        cur = essai;
        avance = true;
        break;
      }
    }
    if (!avance) return cur;
  }
  return cur;
}
