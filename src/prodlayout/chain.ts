import rawEconomy from "../data/economy.generated.json";
import type { BuildingDef } from "../model/types";
import { frac, type Frac } from "./frac";

/**
 * DONNÉES DE CHAÎNE — la seule porte de ce module vers les données économiques.
 *
 * Deux indexations coexistent dans le projet et ne doivent jamais se croiser :
 * `economy.buildingProd` désigne les biens par GUID (`2137` = Pain), le catalogue par nom
 * d'affichage. Ici c'est le GUID qui fait foi ; le catalogue n'est consulté que pour la
 * géométrie et le `slotType`.
 *
 * L'arbre de chaîne (`buildChain`) a été retiré avec l'onglet Production, le 30/10/2026 : les
 * chaînes d'un objectif de production se déroulent dans `economy/solve.ts`.
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
 * défaut de l'interface.
 */
export const isProducer = (defId: string): boolean =>
  (eco.buildingProd[defId]?.outputs?.length ?? 0) > 0;
