import { chainFertilities, economy } from "./economy";

/** Ressources déclarées d'une île (saisie utilisateur — fertilités par-partie dans le jeu). */
export interface ResourceProfile {
  fertilities: string[]; // GUIDs Fertility/Deposit présents (naturels + miniers)
  mountainSlots: number; // nb de slots montagne exploitables (capacité minière)
}

export const emptyProfile = (): ResourceProfile => ({ fertilities: [], mountainSlots: 0 });

/** Fertilités requises par la chaîne de `good` mais ABSENTES du profil. */
export function missingFertilities(good: string, p: ResourceProfile, region?: string): string[] {
  const have = new Set(p.fertilities);
  return [...chainFertilities(good, region)].filter((f) => !have.has(f));
}

/** Le bien est-il produisible sur ce profil (toutes ses fertilités présentes) ? */
export function canProduce(good: string, p: ResourceProfile, region?: string): boolean {
  return missingFertilities(good, p, region).length === 0;
}

/** Ensemble des biens AYANT UN PRODUCTEUR et produisibles avec ce profil. */
export function producibleGoods(p: ResourceProfile, region?: string): Set<string> {
  const out = new Set<string>();
  for (const good of Object.keys(economy.producers)) {
    if (canProduce(good, p, region)) out.add(good);
  }
  return out;
}
