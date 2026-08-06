import data from "../data/economy.generated.json";

export interface TierGood {
  good: string | null; // GUID produit
  rate: number; // par maison par minute
  needName: string | null;
  pop: number; // habitants accordés (Population)
  money: number; // argent accordé (Money)
  weight: number; // SupplyWeight : points apportés à la catégorie quand rempli
  category: string; // NeedCategoryType (Food/Fashion/Household/Wonders/Culture) ou "Public"
}
export interface TierService {
  need: string;
  building: string | null; // defId du bâtiment de service (g<guid>)
  pop: number;
  money: number;
  weight: number;
  category: string;
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
  // score SupplyWeight par catégorie requis pour MONTER au tier suivant
  // (mécanique d'upgrade réelle, cf. GAME_MECHANICS.md §3)
  upgradeThresholds: Record<string, number>;
}
export interface BProd {
  cycleTime: number | null;
  inputs: { good: string; amount: number }[];
  outputs: { good: string; amount: number }[];
  fertility?: string; // GUID Fertility/Deposit requis (sinon non constructible)
}

interface EconomyData {
  tiers: Tier[];
  producers: Record<string, string[]>; // goodGuid -> [defId]
  buildingProd: Record<string, BProd>;
  buildingWorkforce: Record<string, { tier: string; amount: number }[]>;
  buildingUpkeep: Record<string, number>; // defId -> entretien argent/min
  goodNames: Record<string, string>;
  goodPrices: Record<string, number>; // GUID -> BasePrice (valeur marchande de réf.)
  buildingRegion: Record<string, string>; // defId -> région ("Roman"/"Celtic")
  fertilities: Record<string, string>; // GUID Fertility/Deposit -> nom FR
}

/** Fertilités/gisements requis par la chaîne de production d'un bien (récursif). */
export function chainFertilities(good: string, region?: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (g: string) => {
    if (seen.has(g)) return;
    seen.add(g);
    const defId = pickProducer(g, region);
    if (!defId) return;
    const p = economy.buildingProd[defId];
    if (!p) return;
    if (p.fertility) out.add(p.fertility);
    for (const inp of p.inputs) walk(inp.good);
  };
  walk(good);
  return out;
}

export const economy = data as unknown as EconomyData;

export const tiers = economy.tiers;
export const upkeepOf = (defId: string): number => economy.buildingUpkeep[defId] || 0;
export const tierByGuid = (g: string): Tier | undefined => tiers.find((t) => t.guid === g);

/**
 * Chaîne résidentielle menant au tier-cible : tiers de MÊME région dont l'ensemble
 * de services est NICHÉ dans (⊆) celui du cible, du plus bas au cible. Les services
 * sont cumulatifs dans le jeu (Liberti ⊂ Plébéiens ⊂ Equites ⊂ Patriciens), donc une
 * maison sous-desservie retombe au tier le plus haut dont TOUS les services l'atteignent.
 * Base de l'accounting MIXTE (densité max sans gonfler la population au tier-cible).
 */
export function residentialChain(tierGuid: string): Tier[] {
  const target = tierByGuid(tierGuid);
  if (!target || !target.residenceId) return target ? [target] : [];
  const svcOf = (t: Tier): Set<string> =>
    new Set(t.services.map((s) => s.building).filter((b): b is string => !!b));
  const targetSvc = svcOf(target);
  return tiers
    .filter((t) => !!t.residenceId && t.region === target.region
      && t.capacityDefault <= target.capacityDefault
      && [...svcOf(t)].every((b) => targetSvc.has(b)))
    .sort((a, b) => a.capacityDefault - b.capacityDefault);
}
export const goodName = (g: string | null): string =>
  (g && economy.goodNames[g]) || g || "?";

/** Valeur marchande de référence d'un bien (BasePrice), 0 si inconnu. */
export const priceOf = (good: string | null): number =>
  (good && economy.goodPrices[good]) || 0;

/** Région d'un bâtiment ("Roman"/"Celtic"/undefined). */
export const regionOf = (defId: string): string | undefined =>
  economy.buildingRegion[defId];

/**
 * Producteur d'un bien. Si `region` fournie et qu'un producteur de cette région
 * existe, il est préféré ; sinon un producteur sans région (commun) ; sinon le 1er.
 */
export function pickProducer(good: string, region?: string): string | undefined {
  const list = economy.producers[good];
  if (!list || !list.length) return undefined;
  if (region) {
    const sameRegion = list.find((d) => regionOf(d) === region);
    if (sameRegion) return sameRegion;
    const common = list.find((d) => !regionOf(d));
    if (common) return common;
  }
  return list[0];
}
