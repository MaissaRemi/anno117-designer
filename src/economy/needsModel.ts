import type { Tier } from "./economy";

/**
 * MODÈLE DE PALIER ET DE CAPACITÉ — la mécanique réelle d'Anno 117.
 *
 * Règle du jeu (`Residence7/UpgradeThreshold`, cf. GAME_MECHANICS.md §3, verdict [FICHIERS]) :
 * une résidence atteint un palier quand, **par catégorie de besoin**, la somme des
 * `SupplyWeight` des besoins **remplis** atteint le seuil de ce palier. Le sous-ensemble
 * est libre — les besoins sont donc SUBSTITUABLES.
 *
 * Et sa capacité vaut `Σ Population des NeedAttributes des besoins remplis` : elle n'est
 * PAS constante par palier, elle croît avec chaque besoin satisfait.
 *
 * Ce que faisait le code avant : un ET booléen sur TOUS les services du tier, et une
 * capacité constante lue dans `capacityDefault`. Deux conséquences mesurées sur une île
 * 320² visant les Patriciens :
 *  - il fallait couvrir les 12 types de service pour qu'une maison compte, alors que
 *    Public exige 15 points sur 34 disponibles et Wonders 12 sur 16 : ~30 % de l'île
 *    partait en services dont la moitié était superflue ;
 *  - le mode « seuils », qui écarte volontairement Temple et Bibliothèque, se retrouvait
 *    avec un masque insatisfiable → 0 maison au palier cible, par construction.
 *
 * Le modèle ci-dessous rend l'objectif CONTINU : chaque service supplémentaire qui couvre
 * une maison ajoute ses habitants, au lieu de tout jouer sur un franchissement de seuil.
 * C'est ce gradient qui rend le placement optimisable.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠ AMBIGUÏTÉ ASSUMÉE — `THRESHOLD_MEANS_REACH`
 * `UpgradeThreshold` est porté par la résidence du palier T. Deux lectures possibles :
 *   (a) « seuil pour ÊTRE T »  → le seuil des Patriciens (Wonders 12) rend l'Amphithéâtre
 *       obligatoire, ce qu'affirme GAME_MECHANICS.md §9 et §14 ;
 *   (b) « seuil pour QUITTER T » → atteindre Patricien n'exigerait que le seuil des Equites
 *       (Wonders 4 = Forum OU Bains), et le seuil des Patriciens serait une donnée morte.
 * Les deux lectures sont cohérentes avec les fichiers (les besoins étant cumulatifs).
 * On suit (a), la position documentée du projet. Le basculement tient en une constante ;
 * le test in-game qui tranche est décrit dans GAME_MECHANICS.md §13.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
const THRESHOLD_MEANS_REACH = true;

export interface TierReach {
  tier: Tier;
  /** rang dans la chaîne (0 = palier de base) */
  index: number;
  /** habitants de CETTE maison = Σ Population des besoins remplis */
  cap: number;
  /** argent/min de CETTE maison = Σ Money des besoins remplis */
  money: number;
}

export interface EvaluatorOptions {
  /** Les besoins en BIENS sont-ils satisfaits ? (île d'import : oui, tout est acheminé) */
  goodsMet?: boolean;
  /** Services pris en compte ; absent = tous. Un service hors de cet ensemble est ignoré
   *  partout : il ne compte ni pour les seuils ni pour la capacité. */
  relevant?: Set<string>;
}

export interface TierEvaluator {
  chain: Tier[];
  /** defId de service → numéro de bit dans le masque de couverture */
  bitOf: Map<string, number>;
  /** defId de service par numéro de bit */
  serviceIds: string[];
  /** Palier et capacité d'une maison, d'après le masque des services ACTIFS qui la couvrent. */
  evaluate(mask: number): TierReach;
  /** Palier et capacité de référence si TOUS les services du palier k sont couverts.
   *  Sert aux chemins de repli qui raisonnent par palier et non par maison. */
  reference(index: number): TierReach;
  /** Masque des services du palier `index` (utile aux moteurs pour cibler leur couverture). */
  maskOf(index: number): number;
  /**
   * Attributs COMPLETS d'une maison (Bonheur, Santé, Incendie…) pour ce masque de
   * couverture : biens supposés remplis + services qui la couvrent effectivement, au
   * palier réellement atteint. Mémoïsé comme `evaluate`.
   *
   * ⚠ Ce sont les mêmes valeurs que les effets de zone des bâtiments de service — ne
   * jamais y ajouter `buildingEffects` pour ces bâtiments (cf. economy/attributes.ts).
   */
  attrsOf(mask: number): Readonly<Record<string, number>>;
  /**
   * Maison PLAFONNÉE au palier `index` — le cœur de la cascade de main-d'œuvre.
   *
   * `evaluate` renvoie le MEILLEUR palier qu'un masque autorise ; ici on demande ce que
   * vaudrait la même maison laissée volontairement à un palier inférieur (ou d'une lignée
   * parallèle). C'est un état de jeu parfaitement légal : la montée de palier est un acte
   * MANUEL du joueur (`Upgradable/PossibleUpgrades`), pas un automatisme.
   *
   * `null` si le masque ne franchit pas les seuils de ce palier. Le palier de base fait
   * exception : il est toujours atteignable.
   */
  evaluateAt(index: number, mask: number): TierReach | null;
  /** Attributs de cette même maison plafonnée. */
  attrsAt(index: number, mask: number): Readonly<Record<string, number>>;
}

interface CompiledTier {
  tier: Tier;
  /** score de besoins-BIENS par index de catégorie (constant : les biens sont importés) */
  goodsScore: Float64Array;
  goodsCap: number;
  goodsMoney: number;
  services: { bit: number; cat: number; weight: number; pop: number; money: number }[];
  /** seuils par index de catégorie ; -1 = pas de seuil */
  thresholds: Float64Array;
  /** masque de tous les services du palier (référence) */
  fullMask: number;
}

/**
 * Compile un évaluateur pour une chaîne résidentielle donnée. À faire UNE fois par plan :
 * `evaluate` est ensuite appelé une fois par emplacement de maison (des milliers de fois),
 * et mémoïse par masque — au plus 2^n entrées, n = nombre de types de service (≤ 12 en jeu).
 */
export function compileTierEvaluator(chain: Tier[], opts: EvaluatorOptions = {}): TierEvaluator {
  const goodsMet = opts.goodsMet !== false;
  const relevant = opts.relevant;

  // index de bit par service, index par catégorie
  const bitOf = new Map<string, number>();
  const serviceIds: string[] = [];
  const catIndex = new Map<string, number>();
  const catOf = (c: string): number => {
    let i = catIndex.get(c);
    if (i === undefined) { i = catIndex.size; catIndex.set(c, i); }
    return i;
  };
  for (const t of chain) {
    for (const s of t.services) {
      if (!s.building || (relevant && !relevant.has(s.building))) continue;
      if (!bitOf.has(s.building)) { bitOf.set(s.building, serviceIds.length); serviceIds.push(s.building); }
      catOf(s.category);
    }
    for (const g of t.goods) catOf(g.category);
    for (const c of Object.keys(t.upgradeThresholds || {})) catOf(c);
  }
  const nCat = Math.max(1, catIndex.size);

  const compiled: CompiledTier[] = chain.map((tier) => {
    const goodsScore = new Float64Array(nCat);
    let goodsCap = 0, goodsMoney = 0;
    if (goodsMet) {
      for (const g of tier.goods) {
        goodsScore[catOf(g.category)] += g.weight || 0;
        goodsCap += g.pop || 0;
        goodsMoney += g.money || 0;
      }
    }
    const services: CompiledTier["services"] = [];
    let fullMask = 0;
    for (const s of tier.services) {
      if (!s.building) continue;
      const bit = bitOf.get(s.building);
      if (bit === undefined) continue; // écarté par `relevant`
      services.push({ bit, cat: catOf(s.category), weight: s.weight || 0, pop: s.pop || 0, money: s.money || 0 });
      fullMask |= 1 << bit;
    }
    const thresholds = new Float64Array(nCat).fill(-1);
    for (const [c, v] of Object.entries(tier.upgradeThresholds || {})) thresholds[catOf(c)] = v;
    return { tier, goodsScore, goodsCap, goodsMoney, services, thresholds, fullMask };
  });

  const score = new Float64Array(nCat);
  const evalTier = (ct: CompiledTier, mask: number): { ok: boolean; cap: number; money: number } => {
    score.set(ct.goodsScore);
    let cap = ct.goodsCap, money = ct.goodsMoney;
    for (const s of ct.services) {
      if (!(mask & (1 << s.bit))) continue;
      score[s.cat] += s.weight;
      cap += s.pop;
      money += s.money;
    }
    let ok = true;
    for (let c = 0; c < nCat; c++) {
      const t = ct.thresholds[c];
      if (t >= 0 && score[c] < t) { ok = false; break; }
    }
    return { ok, cap, money };
  };

  const base = (): TierReach => {
    const ct = compiled[0];
    const r = evalTier(ct, 0);
    return { tier: ct.tier, index: 0, cap: Math.max(1, Math.round(r.cap)), money: r.money };
  };

  const compute = (mask: number): TierReach => {
    for (let k = chain.length - 1; k >= 0; k--) {
      const ct = compiled[k];
      // lecture (b) de l'ambiguïté : le seuil du palier k−1 conditionne l'accès au palier k
      const gate = THRESHOLD_MEANS_REACH ? ct : compiled[Math.max(0, k - 1)];
      const g = evalTier(gate, mask);
      if (!g.ok) continue;
      const r = THRESHOLD_MEANS_REACH ? g : evalTier(ct, mask);
      return { tier: ct.tier, index: k, cap: Math.max(1, Math.round(r.cap)), money: r.money };
    }
    return base();
  };

  /** Comme `compute`, mais pour UN palier imposé. `null` = seuils non franchis. */
  const computeAt = (k: number, mask: number): TierReach | null => {
    const ct = compiled[k];
    const gate = THRESHOLD_MEANS_REACH ? ct : compiled[Math.max(0, k - 1)];
    const g = evalTier(gate, mask);
    if (!g.ok) return k === 0 ? base() : null; // le palier de base ne se refuse pas
    const r = THRESHOLD_MEANS_REACH ? g : evalTier(ct, mask);
    return { tier: ct.tier, index: k, cap: Math.max(1, Math.round(r.cap)), money: r.money };
  };

  // attributs complets pour un masque, au palier atteint
  const computeAttrs = (mask: number, forced?: number): Record<string, number> => {
    const t = forced !== undefined ? chain[forced] : evaluateMask(mask).tier;
    const acc: Record<string, number> = {};
    const add = (from: Record<string, number> | undefined) => {
      if (!from) return;
      for (const [k, v] of Object.entries(from)) acc[k] = (acc[k] ?? 0) + v;
    };
    if (goodsMet) for (const g of t.goods) add(g.attrs);
    for (const s of t.services) {
      if (!s.building) continue;
      const b = bitOf.get(s.building);
      if (b !== undefined && (mask & (1 << b))) add(s.attrs);
    }
    return acc;
  };

  // MÉMOÏSATION PAR MASQUE, en tables CREUSES.
  //
  // C'étaient des tableaux DENSES de 2^n entrées par palier, sous un garde-fou
  // `MAX_CACHED_BITS = 20` qui coupait purement le cache au-delà. Deux défauts : les tables
  // étaient occupées à 0,26 % (4 à 42 masques réellement vus, pour un million d'entrées
  // allouées d'un coup — ~42 Mo dans le worker au dernier palier autorisé), et le garde-fou
  // rendait les plans à plus de vingt types de service brutalement lents au lieu de
  // simplement les mémoïser. Une `Map` n'alloue que ce qui est vu, et supprime les deux.
  //
  // ⚠ Les caches PLAFONNÉS sont indexés [palier][masque], jamais par le seul masque : deux
  // maisons au même masque mais plafonnées différemment n'ont ni la même capacité ni les
  // mêmes attributs. Partager le cache ferait silencieusement mentir toute la cascade.
  const cache = new Map<number, TierReach>();
  const attrCache = new Map<number, Record<string, number>>();
  const capCache: Map<number, TierReach | null>[] = chain.map(() => new Map());
  const capAttrCache: Map<number, Record<string, number>>[] = chain.map(() => new Map());

  const evaluateMask = (mask: number): TierReach => {
    let hit = cache.get(mask);
    if (!hit) cache.set(mask, hit = compute(mask));
    return hit;
  };

  return {
    chain,
    bitOf,
    serviceIds,
    evaluate: evaluateMask,
    attrsOf(mask: number): Readonly<Record<string, number>> {
      let hit = attrCache.get(mask);
      if (!hit) attrCache.set(mask, hit = computeAttrs(mask));
      return hit;
    },
    evaluateAt(index: number, mask: number): TierReach | null {
      const k = Math.max(0, Math.min(chain.length - 1, index));
      const row = capCache[k];
      // `has`, pas la valeur : `computeAt` rend légitimement `null` (seuils non franchis),
      // et le tester par fausseté recalculerait ce cas à chaque appel.
      if (row.has(mask)) return row.get(mask)!;
      const v = computeAt(k, mask);
      row.set(mask, v);
      return v;
    },
    attrsAt(index: number, mask: number): Readonly<Record<string, number>> {
      const k = Math.max(0, Math.min(chain.length - 1, index));
      const row = capAttrCache[k];
      let hit = row.get(mask);
      if (!hit) row.set(mask, hit = computeAttrs(mask, k));
      return hit;
    },
    reference(index: number): TierReach {
      const k = Math.max(0, Math.min(chain.length - 1, index));
      const ct = compiled[k];
      const r = evalTier(ct, ct.fullMask);
      return { tier: ct.tier, index: k, cap: Math.max(1, Math.round(r.cap)), money: r.money };
    },
    maskOf(index: number): number {
      const k = Math.max(0, Math.min(chain.length - 1, index));
      return compiled[k].fullMask;
    },
  };
}
