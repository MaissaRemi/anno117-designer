import rawEconomy from "../data/economy.generated.json";
import type { BuildingDef } from "../model/types";
import { addF, divF, frac, mulF, toNumber, type Frac } from "./frac";

/**
 * ARBRE DE CHAÎNE — la seule porte de ce module vers les données économiques.
 *
 * Deux indexations coexistent dans le projet et ne doivent jamais se croiser :
 * `economy.buildingProd` désigne les biens par GUID (`2137` = Pain), le catalogue par nom
 * d'affichage. Ici c'est le GUID qui fait foi ; le catalogue n'est consulté que pour la
 * géométrie et le `slotType`.
 */

interface RawProd {
  cycleTime: number;
  inputs: { good: string; amount: number }[];
  outputs: { good: string; amount: number }[];
}

interface RawEconomy {
  producers: Record<string, string[]>;
  buildingProd: Record<string, RawProd>;
  buildingWorkforce: Record<string, { tier: string; amount: number }[]>;
  buildingUpkeep: Record<string, number>;
  buildingRegion: Record<string, string>;
  goodNames: Record<string, string>;
  goodPrices: Record<string, number>;
  tiers: { guid: string; name: string }[];
}

export const eco = rawEconomy as unknown as RawEconomy;

export type Lookup = (id: string) => BuildingDef | undefined;

export interface ChainNode {
  defId: string;
  /** GUID du bien que ce bâtiment fournit à la chaîne. */
  good: string;
  /** Compte EXACT, en rationnel. Jamais arrondi avant l'affichage. */
  exact: Frac;
  /** Débit d'UNE copie, en unités par minute. */
  ratePerMin: Frac;
  /** Profondeur dans l'arbre (0 = bâtiment cible). */
  depth: number;
}

export type ImportReason = "demandé" | "sans-producteur" | "cycle";

export interface ChainImport {
  good: string;
  ratePerMin: number;
  reason: ImportReason;
}

export interface ChainBlocked {
  defId: string;
  slotType: string;
  good: string;
}

export interface ChainResult {
  targetDefId: string;
  targetGood: string;
  nodes: ChainNode[];
  imports: ChainImport[];
  /** Producteurs exigeant un emplacement de terrain — non posables hors terrain. */
  blocked: ChainBlocked[];
  gaps: string[];
}

/** Débit d'un bâtiment pour un bien, en unités par minute. */
export const ratePerMin = (p: RawProd, good: string): Frac => {
  const out = p.outputs.find((o) => o.good === good);
  if (!out || !p.cycleTime) return frac(0);
  return frac(out.amount * 60, p.cycleTime);
};

/** Producteur d'un bien, en préférant la région demandée. */
export function pickProducer(good: string, region?: string): string | undefined {
  const list = eco.producers[good] ?? [];
  if (!list.length) return undefined;
  return (region ? list.find((id) => eco.buildingRegion[id] === region) : undefined) ?? list[0];
}

export const goodName = (good: string): string => eco.goodNames[good] ?? good;

/**
 * Le bâtiment produit-il réellement quelque chose ?
 *
 * `buildingProd` ne suffit pas : SEPT entrées y ont des intrants et AUCUNE sortie — les
 * phases de construction de l'Amphithéâtre, qui consomment des biens sans rien rendre.
 * Comme « Amphithéâtre : arène » ouvre la liste alphabétique romaine, c'était la cible par
 * défaut de l'interface. Un seul prédicat sert au filtre de la vue et au garde-fou de
 * `buildChain`, pour que les deux ne puissent pas diverger.
 */
export const isProducer = (defId: string): boolean =>
  (eco.buildingProd[defId]?.outputs?.length ?? 0) > 0;

export function buildChain(
  targetDefId: string,
  count: number,
  lookup: Lookup,
  imported: ReadonlySet<string> = new Set(),
): ChainResult {
  if (!isProducer(targetDefId)) throw new Error(`${targetDefId} ne produit rien.`);
  const targetProd = eco.buildingProd[targetDefId];
  const targetGood = targetProd.outputs[0].good;
  const region = eco.buildingRegion[targetDefId];

  const gaps: string[] = [];
  const blocked: ChainBlocked[] = [];
  const order: string[] = [];
  const acc = new Map<string, ChainNode>();
  const impAcc = new Map<string, ChainImport>();

  const addImport = (good: string, rate: number, reason: ImportReason) => {
    const cur = impAcc.get(good);
    if (cur) cur.ratePerMin += rate;
    else impAcc.set(good, { good, ratePerMin: rate, reason });
  };

  const visit = (defId: string, good: string, copies: Frac, depth: number, stack: Set<string>) => {
    const p = eco.buildingProd[defId];
    if (!p) return;
    const seen = acc.get(defId);
    if (seen) {
      seen.exact = addF(seen.exact, copies);
      seen.depth = Math.max(seen.depth, depth);
    } else {
      acc.set(defId, { defId, good, exact: copies, ratePerMin: ratePerMin(p, good), depth });
      order.push(defId);
      const def = lookup(defId);
      if (def?.slotType) {
        blocked.push({ defId, slotType: def.slotType, good });
        gaps.push(
          `${def.name} : exige un emplacement « ${def.slotType} », impossible hors terrain — `
          + `marquer « ${goodName(good)} » comme importé`,
        );
      }
    }
    stack.add(defId);
    for (const inp of p.inputs) {
      const need = mulF(copies, frac(inp.amount * 60, p.cycleTime));
      const rate = toNumber(need);
      if (rate <= 0) continue;
      if (imported.has(inp.good)) {
        addImport(inp.good, rate, "demandé");
        continue;
      }
      const src = pickProducer(inp.good, region);
      if (!src) {
        addImport(inp.good, rate, "sans-producteur");
        continue;
      }
      if (stack.has(src)) {
        addImport(inp.good, rate, "cycle");
        gaps.push(`Cycle de production sur ${goodName(inp.good)} — intrant traité comme importé`);
        continue;
      }
      const r = ratePerMin(eco.buildingProd[src], inp.good);
      if (r.n <= 0) {
        addImport(inp.good, rate, "sans-producteur");
        continue;
      }
      visit(src, inp.good, divF(need, r), depth + 1, stack);
    }
    stack.delete(defId);
  };

  visit(targetDefId, targetGood, frac(count), 0, new Set());

  return {
    targetDefId,
    targetGood,
    nodes: order.map((id) => acc.get(id)!),
    imports: [...impAcc.values()],
    blocked,
    gaps,
  };
}
