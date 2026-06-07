import data from "../data/economy.generated.json";

export interface TierGood {
  good: string | null; // GUID produit
  rate: number; // par résident par seconde
  needName: string | null;
}
export interface TierService {
  need: string;
  building: string | null; // defId du bâtiment de service (g<guid>)
}
export interface Tier {
  guid: string;
  name: string;
  region: string;
  workforce: string | null; // GUID bien-workforce fourni
  factor: number; // workforce par résident
  residenceId: string | null;
  capacityDefault: number; // habitants max/maison = Σ Population des besoins
  perHouse: Record<string, number>; // attributs/maison pleine (Money, Happiness, …)
  goods: TierGood[];
  services: TierService[];
}
export interface BProd {
  cycleTime: number | null;
  inputs: { good: string; amount: number }[];
  outputs: { good: string; amount: number }[];
}

interface EconomyData {
  tiers: Tier[];
  producers: Record<string, string[]>; // goodGuid -> [defId]
  buildingProd: Record<string, BProd>;
  buildingWorkforce: Record<string, { tier: string; amount: number }[]>;
  goodNames: Record<string, string>;
}

export const economy = data as unknown as EconomyData;

export const tiers = economy.tiers;
export const tierByGuid = (g: string): Tier | undefined => tiers.find((t) => t.guid === g);
export const goodName = (g: string | null): string =>
  (g && economy.goodNames[g]) || g || "?";

/** Producteur d'un bien (préférence région). */
export function pickProducer(good: string, region?: string): string | undefined {
  const list = economy.producers[good];
  if (!list || !list.length) return undefined;
  if (region) {
    // economy ne stocke pas la région du bâtiment : on prend le 1er (heuristique)
    return list[0];
  }
  return list[0];
}
