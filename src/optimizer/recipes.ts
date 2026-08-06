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
  /** Fraction d'île supposée en voirie (pour l'estimation seulement). Défaut 0,22. */
  roadShare?: number;
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
  const roadShare = opts.roadShare ?? 0.22;
  const target = chain[chain.length - 1];
  if (!target) return [];

  // services du palier cible, groupés par catégorie, avec leur poids
  const byCat = new Map<string, { id: string; weight: number }[]>();
  const defOf = new Map<string, BuildingDef>();
  for (const s of target.services) {
    if (!s.building) continue;
    const d = lookup(s.building);
    if (!d || !(d.streetRange || d.radius?.range)) continue;
    defOf.set(s.building, d);
    const arr = byCat.get(s.category) ?? [];
    arr.push({ id: s.building, weight: s.weight || 0 });
    byCat.set(s.category, arr);
  }
  const allIds = [...defOf.keys()];
  if (!allIds.length) return [];

  // produit cartésien des sous-ensembles minimaux, catégorie par catégorie
  let combos: string[][] = [[]];
  for (const [cat, items] of byCat) {
    const threshold = target.upgradeThresholds?.[cat] ?? 0;
    const subsets = minimalSubsets(items, threshold);
    const usable = subsets.length ? subsets : [items.map((i) => i.id)]; // seuil hors d'atteinte
    const next: string[][] = [];
    for (const base of combos) for (const s of usable) next.push([...base, ...s]);
    combos = next;
    if (combos.length > 4096) break; // borne dure, on garde ce qui est déjà énuméré
  }
  if (!combos.length) combos = [allIds];

  const ev = compileTierEvaluator(chain, { goodsMet: true });
  const scored = combos.map((ids): Recipe => {
    const tax = ids.reduce((s, id) => s + landTax(defOf.get(id)!), 0);
    let mask = 0;
    for (const id of ids) {
      const b = ev.bitOf.get(id);
      if (b !== undefined) mask |= 1 << b;
    }
    const cap = ev.evaluate(mask).cap;
    // estimation : le sol restant après voirie et services, divisé par l'emprise d'une
    // résidence, fois la capacité. Grossier — c'est un PRÉ-TRI, le moteur tranche.
    const free = Math.max(0, 1 - roadShare - tax);
    return { serviceIds: ids, landTax: tax, cap, estimate: (free / 9) * cap };
  });

  // tri déterministe : estimation décroissante, puis taxe croissante, puis clé stable
  scored.sort((a, b) =>
    b.estimate - a.estimate || a.landTax - b.landTax
    || a.serviceIds.join(",").localeCompare(b.serviceIds.join(",")));

  // dédoublonnage (deux catégories peuvent proposer le même sous-ensemble via un service
  // partagé) puis troncature
  const seen = new Set<string>();
  const out: Recipe[] = [];
  for (const r of scored) {
    const key = [...r.serviceIds].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, serviceIds: [...r.serviceIds].sort() });
    if (out.length >= keep) break;
  }
  return out;
}
