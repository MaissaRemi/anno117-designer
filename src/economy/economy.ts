import data from "../data/economy.generated.json";

export interface TierGood {
  good: string | null; // GUID produit
  rate: number; // par maison par minute
  needName: string | null;
  pop: number; // habitants accordés (Population)
  money: number; // argent accordé (Money)
  weight: number; // SupplyWeight : points apportés à la catégorie quand rempli
  category: string; // NeedCategoryType (Food/Fashion/Household/Wonders/Culture) ou "Public"
  /** NeedAttributes COMPLETS du besoin (Bonheur, Santé, Incendie, Croyance…). Identiques à
   *  l'effet de zone du bâtiment qui le remplit — ne jamais additionner les deux. */
  attrs?: Record<string, number>;
}
export interface TierService {
  need: string;
  building: string | null; // defId du bâtiment de service (g<guid>)
  pop: number;
  money: number;
  weight: number;
  category: string;
  /** NeedAttributes complets — cf. `TierGood.attrs`. */
  attrs?: Record<string, number>;
}
export interface Tier {
  guid: string;
  name: string;
  region: string;
  workforce: string | null; // GUID bien-workforce fourni
  factor: number; // workforce par résident
  residenceId: string | null;
  /**
   * Résidences vers lesquelles celle-ci peut MONTER (`Upgradable/PossibleUpgrades`). C'est un
   * ARBRE, pas une chaîne : en Albion les Tourbiers se hissent SOIT vers les Forgerons
   * (lignée native) SOIT vers les Mercators (romanisée).
   */
  upgradesTo: string[];
  capacityDefault: number; // habitants max/maison = Σ Population des besoins
  /** Rang dans la lignée de sa région, 1-based, dérivé de la capacité. Comparé à `minTier`. */
  rank?: number;
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

/**
 * EFFET DE ZONE d'un bâtiment (cf. GAME_MECHANICS.md §2). Chaîne dans les fichiers du jeu :
 * `Building/FunctionalEffects` → asset `Effect` (`EffectScope`) → `BuildingBuff` dont
 * `BuildingUpgrade/AdditionalAttributes` porte les deltas appliqués aux résidences à portée.
 *
 * Deux portées de nature DIFFÉRENTE :
 *  - `radius` : distance EUCLIDIENNE (`RadiusDistance`) — c'est celle des ateliers et des
 *    mines. `RadiusDistance` n'est donc pas une simple prévisualisation d'interface.
 *  - `street` : distance le long des rues (`StreetDistance`) — services et institutions.
 *
 * `stackable` : plusieurs copies cumulent leur effet sur la même maison (c'est le cas des
 * malus — trois mines côte à côte valent −6 en Santé), sinon l'effet ne compte qu'une fois.
 */
/** Un effet, tel que résolu depuis les assets du jeu. */
export interface ResolvedEffect {
  effect: string;
  /** `Radius`, `StreetDistance`, `Area`, `ObjectsInArea`, `ObjectsInMeta`, `Meta`… */
  scope: string | null;
  attrs: Record<string, number>;
  stackable: boolean;
  /** Pools visés. `43097` = tous les bâtiments à attributs, sans restriction. */
  targets: string[];
  /**
   * EFFETS GREFFÉS sur les cibles, au lieu d'attributs directs.
   *
   * Un buff peut poser un effet sur ce qu'il touche plutôt que de modifier ses attributs
   * (`BuildingUpgrade/AdditionalFunctionalEffect`). C'est par là que passe l'effet dominant de
   * Vulcain : il greffe sur CHAQUE FONDERIE un rayon Population +1 / Incendie +2 /
   * Connaissance +1 / Prestige +1, sans consommer de permis d'autel.
   */
  grants?: ResolvedEffect[];
}

/**
 * DIVINITÉ TUTÉLAIRE — une par île, choisie par le joueur.
 *
 * Ce n'est pas un bâtiment : c'est un choix d'île qui ouvre trois étages de bonus, dont aucun
 * n'était extrait jusqu'ici. Les effets LOCAUX portent sur l'île et montent par paliers de
 * dévotion (`milestones` : [dévotion, échelle]). L'effet DOMINANT porte sur l'empire entier et
 * s'active au-delà de `religion.dominantThreshold`.
 *
 * Sept des huit dominants n'ont aucun buff porteur d'attributs de résidence — ils touchent les
 * navires, les troupes, le stockage ou débloquent des bâtiments, hors du modèle d'attributs.
 * Le huitième, Vulcain, est celui qui compte ici : voir `ResolvedEffect.grants`.
 */
export interface Patron {
  id: string;
  name: string;
  /** Autel emblématique de ce dieu (`ShrineEffectIcon`), préfixé `g`. */
  shrineDefId: string | null;
  /** Pool de TOUS les autels de ce dieu. */
  shrinePool: string | null;
  wonder: string | null;
  local: (ResolvedEffect & { milestones: [number, number][] })[];
  dominant: ResolvedEffect[];
}

export interface BuildingEffect {
  scope: "radius" | "street";
  range: number;
  /** Delta par attribut : Population, Money, Happiness, Health, FireSafety, Knowledge… */
  attrs: Record<string, number>;
  stackable: boolean;
  /**
   * PALIER MINIMUM SERVI, 1-based, absent si l'effet ne restreint rien.
   *
   * Un effet de zone ne vise pas toutes les résidences : il cible un pool, et les pools publics
   * du jeu sont nommés « Public Attribute Buff Tier N ». Un bâtiment de palier N sert le palier
   * N ET TOUS CEUX AU-DESSUS — un service de Plébéiens profite aussi aux Equites et aux
   * Patriciens, cumulativement — mais PAS les paliers en dessous.
   *
   * Le champ `<Targets>` était ignoré par l'extraction, si bien que le moteur créditait le
   * Temple (palier 4) ou les Bains (palier 3) même à une maison de Liberti. À comparer au
   * `rank` du palier atteint par la maison.
   */
  minTier?: number;
}

/**
 * PALIER DE RANG DE CITÉ (`EconomyFeature7/CityStatusFeature`). Le rang d'une ville est
 * déterminé par sa POPULATION TOTALE, et chaque rang applique des deltas d'attributs à
 * TOUTES ses résidences : malus croissants en Bonheur, Santé et Sécurité incendie, bonus
 * en Croyance, Connaissance et Prestige.
 *
 * C'est une contrainte de fond qu'aucun plan ne peut ignorer : à 40 000 habitants on est
 * déjà à −15 Bonheur, −12 Santé, −7,5 Incendie sur chaque maison. Ces malus doivent être
 * compensés par les services et les ateliers à effet positif.
 */
export interface CityStatusStep {
  /** Population totale à partir de laquelle ce rang s'applique. */
  population: number;
  /**
   * Effets du rang, par CULTURE de population (`Roman`, `RomanCeltic`, `Celtic`). En Latium
   * les trois sont identiques — une seule culture y vit. En Albion elles divergent : au
   * dernier rang, −10,6 Bonheur pour un Romain, −17,4 pour un romanisé, −12,6 pour un natif.
   */
  attrs: Record<string, Record<string, number>>;
}

interface EconomyData {
  tiers: Tier[];
  /** defId → effet de zone, quand le bâtiment en porte un (140 bâtiments). */
  buildingEffects: Record<string, BuildingEffect>;
  /** région → échelle des rangs de cité, par population croissante. */
  cityStatus: Record<string, CityStatusStep[]>;
  producers: Record<string, string[]>; // goodGuid -> [defId]
  buildingProd: Record<string, BProd>;
  buildingWorkforce: Record<string, { tier: string; amount: number }[]>;
  /**
   * defId → bien de main-d'œuvre → quantités OFFERTES par difficulté, plus le prélèvement
   * propre du bâtiment (`cost`). Seuls les comptoirs en portent : c'est la main-d'œuvre
   * disponible sur une île avant la moindre maison.
   */
  workforceGrants: Record<string, Record<string, { plenty?: number; medium?: number; spare?: number; cost?: number }>>;
  /**
   * RÈGLES D'UNICITÉ par `UniqueType` (asset `UniqueBuildingConfig`, GUID 81160). Le plafond
   * porte sur un TYPE, pas sur un bâtiment — les seize autels de dieux partagent `Shrine`.
   * Deux mécanismes de nature différente, qui peuvent se cumuler :
   *  - `allowed` : plafond DUR, immuable (Monument01 et Headquarter valent 1) ;
   *  - `permit` : chaque exemplaire consomme un PERMIS, état de partie que le joueur
   *    augmente par la recherche. Le nombre détenu n'est PAS dans les fichiers.
   */
  uniqueTypes: Record<string, { scope: string; allowed?: number; permit?: string }>;
  buildingUpkeep: Record<string, number>; // defId -> entretien argent/min
  goodNames: Record<string, string>;
  goodPrices: Record<string, number>; // GUID -> BasePrice (valeur marchande de réf.)
  buildingRegion: Record<string, string>; // defId -> région ("Roman"/"Celtic")
  fertilities: Record<string, string>; // GUID Fertility/Deposit -> nom FR
  /** Les huit divinités tutélaires. Voir `Patron`. */
  patrons?: Patron[];
  /** Seuils de dévotion (`ReligionBalancing`). */
  religion?: { dominantThreshold?: number; wonderThreshold?: number; shrineThreshold?: number };
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
// Index plutôt que balayage : la cascade de main-d'œuvre l'appelle dans ses boucles chaudes,
// une fois par parcelle et par option.
const tierIndex = new Map(tiers.map((t) => [t.guid, t] as const));
export const tierByGuid = (g: string): Tier | undefined => tierIndex.get(g);

/** Paliers dont on peut monter DIRECTEMENT vers `t`, d'après le graphe déclaré par le jeu. */
const parentsOf = (t: Tier): Tier[] =>
  t.residenceId ? tiers.filter((p) => p.upgradesTo?.includes(t.residenceId!)) : [];
/** Paliers vers lesquels `t` peut monter directement. */
const childrenOf = (t: Tier): Tier[] =>
  (t.upgradesTo ?? []).map((r) => tiers.find((x) => x.residenceId === r)).filter((x): x is Tier => !!x);

/**
 * Chaîne résidentielle menant au tier-cible : ses ANCÊTRES dans le graphe de montée, du plus
 * bas à la cible. Une maison sous-desservie retombe au meilleur palier de cette chaîne dont
 * elle franchit les seuils — base de l'accounting MIXTE.
 *
 * Le graphe est déclaré par le jeu (`Upgradable/PossibleUpgrades`). L'ordre en était déduit
 * auparavant de la capacité et de l'inclusion des services, ce qui marchait tant que la
 * lignée était unique — mais l'Albion en a deux, et « le palier de capacité juste inférieure »
 * y désigne volontiers un palier de l'AUTRE lignée.
 */
export function residentialChain(tierGuid: string): Tier[] {
  const target = tierByGuid(tierGuid);
  if (!target || !target.residenceId) return target ? [target] : [];
  const out = new Map<string, Tier>([[target.guid, target]]);
  const stack = [target];
  while (stack.length) {
    for (const p of parentsOf(stack.pop()!)) {
      if (p.residenceId && !out.has(p.guid)) { out.set(p.guid, p); stack.push(p); }
    }
  }
  return [...out.values()].sort((a, b) => a.capacityDefault - b.capacityDefault);
}

/**
 * CHAÎNE ÉTENDUE — la chaîne résidentielle, plus les LIGNÉES PARALLÈLES du même monde.
 *
 * L'Albion porte deux échelles de population qui divergent dès le premier palier : la native
 * (Tourbiers → Forgerons → Aldermen) et la romanisée (Tourbiers → Mercators → Nobles). Les
 * services de l'une ne sont pas inclus dans ceux de l'autre, si bien que `residentialChain`
 * les sépare — une île visant les Nobles ne pouvait héberger ni Forgeron ni Alderman.
 *
 * C'est bloquant pour la cascade de main-d'œuvre : **21 biens celtiques n'ont de producteur
 * que dans la lignée native** (Bière g5570, Fromage g6586, Bronze g5470, Minerai de cuivre
 * g5290, Granite g41811…), et les carrières de granite comme les mines d'étain réclament des
 * Forgerons. Sans eux, ces bâtiments ne peuvent jamais être armés.
 *
 * Les paliers ajoutés ne sont ATTEIGNABLES que si le plan pose les services qui leur
 * manquent — un seul pour les Forgerons (l'Aire récréative), quelques-uns pour les Aldermen.
 * On ne tranche pas ici : la complétion de recette (`unlockWorkerTiers`) les propose en
 * variante, et c'est le moteur qui décide si le sol dépensé les vaut. Sans ces services, ces
 * paliers restent simplement hors d'atteinte et ne coûtent rien.
 *
 * En Latium la chaîne est déjà emboîtée : le résultat y est identique à `residentialChain`.
 */
export function residentialChainExtended(tierGuid: string): Tier[] {
  const target = tierByGuid(tierGuid);
  if (!target?.residenceId) return residentialChain(tierGuid);
  const out = new Map(residentialChain(tierGuid).map((t) => [t.guid, t] as const));
  const stack = [...out.values()];
  while (stack.length) {
    for (const c of childrenOf(stack.pop()!)) {
      // borné par la cible : on n'héberge pas un palier plus dense qu'elle
      if (!out.has(c.guid) && c.residenceId && c.capacityDefault <= target.capacityDefault) {
        out.set(c.guid, c); stack.push(c);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.capacityDefault - b.capacityDefault);
}

export const goodName = (g: string | null): string =>
  (g && economy.goodNames[g]) || g || "?";

/** Valeur marchande de référence d'un bien (BasePrice), 0 si inconnu. */
export const priceOf = (good: string | null): number =>
  (good && economy.goodPrices[good]) || 0;

/** Effet de zone d'un bâtiment, ou undefined s'il n'en porte pas. */
export const effectOf = (defId: string): BuildingEffect | undefined =>
  economy.buildingEffects?.[defId];

/**
 * Malus/bonus de RANG DE CITÉ pour une population donnée, appliqués à chaque résidence.
 * Renvoie le dernier palier dont le seuil est atteint.
 */
export function cityStatusAttrs(population: number, region = "Roman"): Record<string, number> {
  let attrs: Record<string, number> = {};
  for (const step of cityStatusLadder(region)) {
    if (population < step.population) break;
    attrs = step.attrs;
  }
  return attrs;
}

/**
 * MONDE d'une culture de population. Le Latium n'accueille que la culture romaine ; l'Albion
 * en accueille DEUX — la native (`Celtic` : Tourbiers, Forgerons, Aldermen) et la romanisée
 * (`RomanCeltic` : Mercators, Nobles), issue de la romanisation des bâtiments. Les bâtiments
 * et les îles, eux, ne connaissent que ces deux mondes.
 */
export const worldOf = (region: string): string => (region === "Roman" ? "Roman" : "Celtic");

/**
 * Échelle des rangs de cité telle que la subit une CULTURE donnée : les seuils de population
 * viennent du MONDE (40 rangs jusqu'à 260 000 habitants en Latium, 25 jusqu'à 47 500 en
 * Albion), les effets de la culture.
 */
export function cityStatusLadder(region = "Roman"): { population: number; attrs: Record<string, number> }[] {
  const rows = economy.cityStatus?.[worldOf(region)] ?? [];
  return rows.map((s) => ({
    population: s.population,
    attrs: s.attrs?.[region] ?? s.attrs?.Roman ?? {},
  }));
}

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

/**
 * Producteur CONSTRUCTIBLE dans un monde donné, ou `undefined`. Contrairement à
 * `pickProducer`, ne retombe JAMAIS sur l'autre monde.
 *
 * Le repli de `pickProducer` est acceptable pour estimer un entretien, mais pas pour POSER
 * un bâtiment : mesuré avant correction, il plaçait 12 ateliers romains sur une île celtique
 * (savonnerie g3189, tissage g3191, pressoir à olives g4831) et 6 ateliers celtiques sur une
 * île romaine. En jeu ces bâtiments ne sont pas constructibles là — et ils réclamaient
 * 32 Plébéiens et 24 Equites d'une main-d'œuvre qu'Albion ne peut pas fournir.
 */
export function pickProducerInWorld(good: string, world: string): string | undefined {
  const list = economy.producers[good];
  if (!list || !list.length) return undefined;
  return list.find((d) => {
    const r = regionOf(d);
    return !r || worldOf(r) === world;
  });
}
