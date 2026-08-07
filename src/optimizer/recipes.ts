import type { Tier } from "../economy/economy";
import { compileTierEvaluator } from "../economy/needsModel";
import type { BuildingDef } from "../model/types";
import type { DefLookup } from "../engine/rules";

/**
 * CHOIX DE LA RECETTE DE SERVICES.
 *
 * Les catégories de besoins sont pures : Public et Wonders sont couvertes à 100 % par des
 * SERVICES, Food/Fashion/Household/Culture à 100 % par des BIENS (acheminés, donc acquis en
 * mode import). Choisir un plan revient donc à choisir, pour chaque catégorie-service, un
 * sous-ensemble de bâtiments dont les `SupplyWeight` franchissent le seuil du palier.
 *
 * Chez les Patriciens : Public 15 sur 34 disponibles, Wonders 12 sur 16. `Temple(8) +
 * Bibliothèque(8) = 16` suffit pour Public — contre les 9 types que posait le moteur.
 *
 * COMBIEN ÇA VAUT : mesuré sur celtic_island_large_07 (46 967 tuiles, eau routée),
 * 12 types = 212 copies = 30,2 % du sol → 49 385 habitants ; 4 types = 21 copies = 9,5 %
 * du sol → 73 313 habitants. **×1,48.** Aucun autre levier du projet n'en approche : la
 * géométrie routière plafonne à +3 %.
 *
 * COMMENT ON CHOISIT : surtout pas avec un modèle analytique. La « taxe foncière »
 * τ = emprise / (2·(portée − pas du peigne)²), c'est-à-dire la fraction d'île mangée par le
 * lattice d'un type, est un bon PRÉ-FILTRE mais un mauvais sélecteur : confrontée au moteur
 * réel sur 24 recettes, sa corrélation de rang n'est que de 0,45 et elle classe 10ᵉ la
 * recette gagnante. Deux raisons : le moteur pose plus de copies que le pavage idéal, et
 * surtout le routage d'eau INVERSE le classement (chaque citerne coûte 10 u, une conduite
 * et un corridor réservé). Échanger Forum contre Bains, à capacité identique, vaut +5 %.
 *
 * D'où l'architecture : énumérer les recettes minimales, présélectionner par τ, puis
 * TRANCHER en faisant tourner le vrai moteur. Un plan complet coûtant 80 à 400 ms, une
 * poignée d'évaluations tient dans le budget — sans approximation ni garantie à démontrer,
 * et de façon parfaitement déterministe.
 */

/** Pas du peigne horizontal supposé pour l'estimation de portée effective (résidences 3×3). */
const COMB_STEP = 7;

export interface Recipe {
  /** defId des services de la recette. */
  serviceIds: string[];
  /** Fraction d'île estimée consommée par les lattices de ces services (0..1). */
  landTax: number;
  /** Capacité/maison si tous ces services couvrent la maison. */
  cap: number;
  /** Population estimée — sert UNIQUEMENT au pré-tri, jamais à la décision. */
  estimate: number;
  /** Variante AUGMENTÉE d'un filet de repli : volontairement non minimale. */
  fallback?: boolean;
}

/**
 * Taxe foncière d'un service : fraction d'île qu'occupent ses copies quand il pave l'île.
 * Un pavage en diamants L1 de rayon r couvre 2r² par copie, d'où `copies ≈ terre / 2r²`
 * et `sol occupé ≈ copies × emprise` — le facteur `terre` s'annule.
 */
export function landTax(def: BuildingDef, combStep = COMB_STEP): number {
  const range = def.streetRange || def.radius?.range || 0;
  const r = Math.max(8, range - combStep);
  const area = def.size.w * def.size.h;
  // `unique` (Colisée) : un seul exemplaire, pas un lattice — coût rapporté à une île type.
  if (def.unique) return area / 46967;
  return area / (2 * r * r);
}

/** Sous-ensembles MINIMAUX PAR INCLUSION dont la somme des poids atteint `target`. */
function minimalSubsets(items: { id: string; weight: number }[], target: number): string[][] {
  const n = items.length;
  if (n === 0 || target <= 0) return [[]];
  if (n > 20) return []; // garde-fou : l'énumération exhaustive n'a plus de sens
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += items[i].weight;
    if (sum < target) continue;
    // minimal ssi retirer n'importe quel membre fait repasser sous le seuil
    let minimal = true;
    for (let i = 0; i < n && minimal; i++) {
      if (mask & (1 << i) && sum - items[i].weight >= target) minimal = false;
    }
    if (!minimal) continue;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) ids.push(items[i].id);
    out.push(ids);
  }
  return out;
}

export interface RecipeOptions {
  /** Nombre de recettes conservées après pré-tri par estimation. Défaut 8. */
  keep?: number;
  /** Fraction d'île supposée en voirie (pour l'estimation seulement). Défaut 0,20. */
  roadShare?: number;
  /** Nombre de recettes AUGMENTÉES d'un filet de repli (cf. `fallbackAugment`). Défaut 2. */
  keepFallback?: number;
}

/** Sous-ensembles minimaux d'UN palier, sans tri ni scoring. */
function minimalRecipesFor(tier: Tier, lookup: DefLookup): string[][] {
  const byCat = new Map<string, { id: string; weight: number }[]>();
  for (const s of tier.services) {
    if (!s.building) continue;
    const d = lookup(s.building);
    if (!d || !(d.streetRange || d.radius?.range)) continue;
    const arr = byCat.get(s.category) ?? [];
    arr.push({ id: s.building, weight: s.weight || 0 });
    byCat.set(s.category, arr);
  }
  let combos: string[][] = [[]];
  for (const [cat, items] of byCat) {
    const threshold = tier.upgradeThresholds?.[cat] ?? 0;
    const subsets = minimalSubsets(items, threshold);
    const usable = subsets.length ? subsets : [items.map((i) => i.id)];
    const next: string[][] = [];
    for (const base of combos) for (const s of usable) next.push([...base, ...s]);
    combos = next;
    if (combos.length > 4096) break;
  }
  return combos;
}

/**
 * Recettes candidates pour un palier cible, triées par population ESTIMÉE décroissante.
 *
 * Un service sans portée exploitable ou absent du catalogue est ignoré : sa catégorie
 * retombe alors sur le sous-ensemble atteignable, et si le seuil devient hors d'atteinte on
 * renvoie la recette « tous les services disponibles » — best-effort plutôt qu'échec.
 */
export function candidateRecipes(
  chain: Tier[],
  lookup: DefLookup,
  opts: RecipeOptions = {},
): Recipe[] {
  const keep = Math.max(1, opts.keep ?? 8);
  const keepFallback = Math.max(0, opts.keepFallback ?? 2);
  const roadShare = opts.roadShare ?? 0.20;
  const target = chain[chain.length - 1];
  if (!target) return [];

  const defOf = new Map<string, BuildingDef>();
  for (const t of chain) {
    for (const s of t.services) {
      if (!s.building || defOf.has(s.building)) continue;
      const d = lookup(s.building);
      if (d && (d.streetRange || d.radius?.range)) defOf.set(s.building, d);
    }
  }
  if (!defOf.size) return [];

  const combos = minimalRecipesFor(target, lookup);
  const ev = compileTierEvaluator(chain, { goodsMet: true });
  const score = (ids: string[]): Recipe => {
    const tax = ids.reduce((s, id) => s + (defOf.has(id) ? landTax(defOf.get(id)!) : 0), 0);
    let mask = 0;
    for (const id of ids) {
      const b = ev.bitOf.get(id);
      if (b !== undefined) mask |= 1 << b;
    }
    const cap = ev.evaluate(mask).cap;
    // estimation : le sol restant après voirie et services, divisé par l'emprise d'une
    // résidence, fois la capacité. Grossier — c'est un PRÉ-TRI, le moteur tranche.
    const free = Math.max(0, 1 - roadShare - tax);
    return { serviceIds: [...ids].sort(), landTax: tax, cap, estimate: (free / 9) * cap };
  };

  const scored = (combos.length ? combos : [[...defOf.keys()]]).map(score);
  // tri déterministe : estimation décroissante, puis taxe croissante, puis clé stable
  scored.sort((a, b) =>
    b.estimate - a.estimate || a.landTax - b.landTax
    || a.serviceIds.join(",").localeCompare(b.serviceIds.join(",")));

  const seen = new Set<string>();
  const out: Recipe[] = [];
  const push = (r: Recipe): boolean => {
    const key = r.serviceIds.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(r);
    return true;
  };
  for (const r of scored) {
    if (out.length >= keep) break;
    push(r);
  }

  // --- FILET DE REPLI ---------------------------------------------------------------
  // Le piège que masque une recette maigre : les paliers INTERMÉDIAIRES ont leur propre
  // liste de services. Temple, Bibliothèque et Amphithéâtre n'appartiennent qu'à celle des
  // Patriciens — une maison hors de leur portée ne retombe donc pas chez les Equites
  // (capacité ~24) mais tout en bas de la chaîne (capacité 4). Mesuré : 672 maisons
  // « ratées » ne pesaient que 2 688 habitants au lieu de ~16 000.
  //
  // On ajoute donc des variantes AUGMENTÉES du filet minimal de l'avant-dernier palier :
  // quelques bâtiments de plus, mais toute maison hors du cœur atteint alors le palier
  // intermédiaire. Mesuré : +61 % sur une île continentale, +13 % sur une très grande.
  // Ces variantes sont poussées de force, jamais triées : l'estimation ne voit pas ce gain
  // (elle raisonne sur la capacité du palier cible, pas sur celle des maisons ratées).
  const fallbackTier = chain[chain.length - 2];
  if (keepFallback > 0 && fallbackTier) {
    const nets = minimalRecipesFor(fallbackTier, lookup).map(score)
      .sort((a, b) => a.landTax - b.landTax || a.serviceIds.join(",").localeCompare(b.serviceIds.join(",")));
    const net = nets[0];
    if (net) {
      for (const base of out.slice(0, keepFallback)) {
        push({ ...score([...new Set([...base.serviceIds, ...net.serviceIds])]), fallback: true });
      }
    }
  }
  return out;
}

/**
 * Complète une recette pour que les paliers OUVRIERS de la chaîne restent atteignables.
 *
 * Les listes de services d'Anno sont emboîtées — celles des Plébéiens sont incluses dans
 * celles des Equites, elles-mêmes dans celles des Patriciens — mais les SCORES ne le sont
 * pas : chaque palier ne compte que les services de sa propre liste. Une recette optimisée
 * pour la cible peut donc ne garder que les services lourds (aqueduc 4, thermes 4), qui
 * donnent Public 8 aux Equites et Public 0 aux Plébéiens.
 *
 * Sans cette complétion, la cascade de main-d'œuvre n'a aucun candidat : mesuré sur
 * roman_island_medium_01, le vivier contenait 799 Liberti, 688 Equites, 617 Patriciens et
 * ZÉRO Plébéien, alors que 16 unités de main-d'œuvre plébéienne étaient réclamées.
 *
 * On ajoute le minimum : pour chaque palier déficitaire, ses propres services par poids
 * décroissant jusqu'à franchir le seuil. Ces services servent aussi au palier cible, dont
 * la liste les contient — le surcoût de sol est donc partiellement récupéré.
 */
export function unlockWorkerTiers(serviceIds: string[] | undefined, chain: Tier[]): string[] | undefined {
  if (!serviceIds) return serviceIds; // recette complète : rien à compléter
  const keep = new Set(serviceIds);
  for (const tier of chain.slice(0, -1)) { // la cible est déjà servie par construction
    const score: Record<string, number> = {};
    for (const s of tier.services) {
      if (s.building && keep.has(s.building)) score[s.category] = (score[s.category] ?? 0) + (s.weight ?? 0);
    }
    for (const [cat, need] of Object.entries(tier.upgradeThresholds || {})) {
      // Les catégories de BIENS sont couvertes par l'import (hypothèse `goodsMet`) : seules
      // les catégories alimentées par des services peuvent manquer.
      const pool = tier.services
        .filter((s) => s.category === cat && s.building && !keep.has(s.building))
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
      if (!pool.length) continue;
      let have = score[cat] ?? 0;
      const fromGoods = tier.goods.filter((g) => g.category === cat).reduce((a, g) => a + (g.weight ?? 0), 0);
      have += fromGoods;
      for (const s of pool) {
        if (have >= need) break;
        keep.add(s.building!);
        have += s.weight ?? 0;
      }
    }
  }
  return [...keep];
}
