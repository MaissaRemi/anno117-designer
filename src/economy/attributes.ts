import { cityStatusAttrs, economy, effectOf, type Tier } from "./economy";

/**
 * BILAN D'ATTRIBUTS PAR MAISON.
 *
 * Une résidence porte un jeu d'attributs — Bonheur, Argent, Santé, Sécurité incendie,
 * Connaissance, Croyance, Prestige, Population — alimenté par trois sources :
 *
 *  1. **Ses besoins remplis.** Chaque `Need` satisfait apporte ses `NeedAttributes`.
 *     ⚠ Ces attributs sont EXACTEMENT ceux de l'effet de zone du bâtiment qui remplit le
 *     besoin : vérifié sur les 12 services des Patriciens, les deux tables coïncident
 *     ligne pour ligne. Les additionner reviendrait à compter deux fois. On ne retient
 *     donc, côté effets de zone, que les bâtiments qui NE remplissent PAS un besoin —
 *     ateliers de production, mines, institutions anti-incidents.
 *
 *  2. **Les effets de zone alentour** (cf. `economy.buildingEffects`). Portée euclidienne
 *     pour les ateliers, distance-rue pour les institutions. Les malus sont cumulables
 *     (trois mines côte à côte valent −6 en Santé), les bonus comptent une fois par type.
 *
 *  3. **Le rang de cité**, fonction de la population TOTALE de l'île, appliqué à toutes
 *     les maisons. C'est le terme qui domine : −18 en Bonheur à 260 000 habitants.
 *
 * Une maison est VIABLE si Bonheur, Argent, Santé et Sécurité incendie restent ≥ 0. En
 * dessous, le jeu déclenche émeutes, incendies et maladies (`CityStatus/IncidentInterval`).
 */

/** Attributs qui doivent rester positifs pour qu'une maison soit viable. */
export const VITAL_ATTRS = ["Happiness", "Money", "Health", "FireSafety"] as const;
export type VitalAttr = (typeof VITAL_ATTRS)[number];

export type Attrs = Record<string, number>;

export const addAttrs = (into: Attrs, from: Attrs | undefined, times = 1): Attrs => {
  if (!from) return into;
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v * times;
  return into;
};

/** La maison tient-elle ? Tous les attributs vitaux ≥ 0. */
export const isViable = (a: Attrs): boolean => VITAL_ATTRS.every((k) => (a[k] ?? 0) >= 0);

/** Attribut vital le plus déficitaire (celui qui bloque), ou null si tout va bien. */
export function worstAttr(a: Attrs): { attr: VitalAttr; value: number } | null {
  let worst: { attr: VitalAttr; value: number } | null = null;
  for (const k of VITAL_ATTRS) {
    const v = a[k] ?? 0;
    if (v < 0 && (!worst || v < worst.value)) worst = { attr: k, value: v };
  }
  return worst;
}

/**
 * Attributs apportés par les BESOINS remplis d'un palier, pour une maison dont les
 * services couvrants sont donnés. Les biens sont supposés acheminés (mode import).
 */
export function needAttrs(tier: Tier, coveringServices: ReadonlySet<string>, goodsMet = true): Attrs {
  const out: Attrs = {};
  if (goodsMet) for (const g of tier.goods) addAttrs(out, g.attrs);
  for (const s of tier.services) {
    if (s.building && coveringServices.has(s.building)) addAttrs(out, s.attrs);
  }
  return out;
}

/**
 * Contribution des effets de zone d'un ensemble de bâtiments couvrants, en EXCLUANT ceux
 * qui remplissent déjà un besoin du palier (sinon double comptage, cf. en-tête).
 *
 * `covering` associe à chaque defId le nombre de copies qui couvrent la maison — le compte
 * ne sert qu'aux effets cumulables ; les autres valent une fois quel qu'en soit le nombre.
 */
export function zoneAttrs(covering: ReadonlyMap<string, number>, needBuildings: ReadonlySet<string>): Attrs {
  const out: Attrs = {};
  for (const [defId, n] of covering) {
    if (needBuildings.has(defId)) continue; // déjà compté comme besoin
    const fx = effectOf(defId);
    if (!fx) continue;
    addAttrs(out, fx.attrs, fx.stackable ? n : 1);
  }
  return out;
}

/** Bilan complet d'une maison : besoins + effets de zone + rang de cité. */
export function houseAttrs(opts: {
  tier: Tier;
  coveringServices: ReadonlySet<string>;
  /** defId → nombre de copies couvrantes (ateliers, mines, institutions). */
  zone?: ReadonlyMap<string, number>;
  /** Population TOTALE de l'île — pilote le rang de cité. */
  population: number;
  region?: string;
  goodsMet?: boolean;
}): Attrs {
  const needBuildings = new Set(
    opts.tier.services.map((s) => s.building).filter((b): b is string => !!b),
  );
  const out = needAttrs(opts.tier, opts.coveringServices, opts.goodsMet);
  if (opts.zone) addAttrs(out, zoneAttrs(opts.zone, needBuildings));
  addAttrs(out, cityStatusAttrs(opts.population, opts.region ?? opts.tier.region));
  return out;
}

/**
 * Institutions anti-incidents (Vigiles, Medicus, Préfecture et leurs versions Mini).
 * Elles ne sont PAS des besoins de palier — l'optimiseur ne les posait donc jamais — mais
 * ce sont les seuls bâtiments dont l'effet de zone corrige directement les attributs que le
 * rang de cité dégrade. Portée le long des rues.
 */
export function institutionDefs(region?: string): { defId: string; attrs: Attrs; range: number; uniqueType?: string }[] {
  const out: { defId: string; attrs: Attrs; range: number; uniqueType?: string }[] = [];
  for (const [defId, fx] of Object.entries(economy.buildingEffects ?? {})) {
    if (fx.scope !== "street") continue;
    // uniquement du bénéfice sur les attributs vitaux, et hors besoins de palier
    const helps = VITAL_ATTRS.some((k) => (fx.attrs[k] ?? 0) > 0);
    if (!helps) continue;
    if (economy.tiers.some((t) => t.services.some((s) => s.building === defId))) continue;
    const reg = economy.buildingRegion?.[defId];
    if (region && reg && reg !== region) continue;
    out.push({ defId, attrs: fx.attrs, range: fx.range });
  }
  // tri déterministe : le plus utile d'abord (somme des gains vitaux), puis defId
  const gain = (a: Attrs) => VITAL_ATTRS.reduce((s, k) => s + Math.max(0, a[k] ?? 0), 0);
  return out.sort((a, b) => gain(b.attrs) - gain(a.attrs) || a.defId.localeCompare(b.defId));
}

/** `UniqueType` que partagent les seize autels de dieux. */
export const SHRINE_TYPE = "Shrine";

/**
 * DIVINITÉ TUTÉLAIRE — un seul dieu par île.
 *
 * « Chaque île a un dieu tutélaire que vénère sa population » : c'est un choix d'interface,
 * et il commande quel autel y est constructible. Les seize autels (huit divinités × deux
 * régions) partagent en outre le quota `UniqueType=Shrine`. Poser les autels de six dieux
 * différents, comme le faisait le planificateur, n'a donc aucun équivalent en jeu.
 *
 * Le choix ne se fait PAS sur la somme des gains : seul l'attribut LIMITANT compte. Mesuré
 * sur roman_island_medium_01, où la sécurité incendie est le goulot, Vulcain (🔥+2) et
 * Neptune (🔥+1 💰+1) valent des milliers d'habitants, tandis que Cérès, Epona, Cernunnos et
 * Mercure-Lug n'en valent exactement aucun.
 *
 * @param deficit  manque par attribut vital, ≥ 0 (0 = cet attribut n'est pas contraignant)
 */
export function pickPatron(
  candidates: { defId: string; attrs: Attrs; range: number; uniqueType?: string }[],
  deficit: Record<string, number>,
): string | undefined {
  const shrines = candidates.filter((c) => c.uniqueType === SHRINE_TYPE);
  if (!shrines.length) return undefined;
  const score = (a: Attrs) =>
    VITAL_ATTRS.reduce((s, k) => s + Math.max(0, deficit[k] ?? 0) * Math.max(0, a[k] ?? 0), 0);
  // à égalité (aucun déficit connu), on retombe sur le gain vital brut puis sur le defId :
  // le résultat reste déterministe.
  const gain = (a: Attrs) => VITAL_ATTRS.reduce((s, k) => s + Math.max(0, a[k] ?? 0), 0);
  return [...shrines].sort((a, b) =>
    score(b.attrs) - score(a.attrs) || gain(b.attrs) - gain(a.attrs) || a.defId.localeCompare(b.defId),
  )[0]?.defId;
}
