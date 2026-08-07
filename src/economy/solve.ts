import { economy, pickProducer, priceOf, tierByGuid, upkeepOf, worldOf, type BProd } from "./economy";

/** Maisons couvertes par défaut par un bâtiment de service (rayon d'influence). */
const DEFAULT_HOUSES_PER_SERVICE = 30;

export interface PopTarget {
  tier: string; // GUID
  pop: number;
}

export interface SolveOptions {
  includeProduction: boolean; // explose les chaînes de production
  includeServices: boolean; // besoins biens+services (true) ou biens seuls (false)
  capacities: Record<string, number>; // tier -> capacité/maison
  housesPerService?: number; // maisons couvertes par un bâtiment de service
  includeWorkforce?: boolean; // cascade main-d'œuvre -> résidents (défaut true)
  optimizeNeeds?: boolean; // ne remplir que les besoins rentables (max économie)
  /** Sélection des besoins (mécanique d'upgrade réelle, GAME_MECHANICS.md §3) :
   *  - "all" (défaut) : tous les besoins remplis (max bonus/argent par maison)
   *  - "thresholds" : sous-ensemble le MOINS CHER atteignant les seuils d'upgrade
   *    par catégorie (SupplyWeight) — moins d'infrastructure, plus de maisons. */
  needSelection?: "all" | "thresholds";
  /** Région de l'ÎLE (Roman/Celtic) : préférence de producteur pour les biens
   *  exogènes (objectif de production) — évite une chaîne celtique sur île romaine. */
  region?: string;
  /** Q1 (à confirmer EN JEU, GAME_MECHANICS test #4) : la conso est-elle par MAISON
   *  (défaut, hypothèse [WEB]) ou par HABITANT ? Si "resident", la demande de biens
   *  est multipliée par la capacité/maison. Prêt à flipper une fois validé en jeu. */
  consumptionUnit?: "house" | "resident";
}

export interface TierProfile {
  goods: { good: string | null; rate: number }[];
  services: { building: string | null }[];
  cap: number; // habitants/maison (Σ Population des besoins retenus)
  money: number; // argent/maison (Σ Money des besoins retenus)
}

/** Demande exogène de biens (GUID -> unités/min), ex: objectif de production. */
export type ExtraDemand = Record<string, number>;

export interface SolveResult {
  populationByTier: Record<string, number>;
  residencesByTier: Record<string, number>;
  productionCounts: Record<string, number>; // defId -> nb
  serviceCounts: Record<string, number>; // defId -> nb
  goodsPerMin: Record<string, number>; // demande (GUID -> /min)
  items: { defId: string; qty: number }[]; // pour l'optimiseur
  iterations: number;
  converged: boolean; // false => cascade main-d'œuvre instable, résultat = besoins directs
  money: { gross: number; upkeep: number; net: number }; // argent/min (taxe - entretien)
  // valeur marchande des biens produits (Σ débit × BasePrice) — potentiel de vente,
  // NON inclus dans `net` (dépend des décisions de commerce du joueur).
  marketValue: number;
  // matières premières SANS producteur dans la chaîne → à IMPORTER (GUID -> /min) +
  // coût d'achat (Σ /min × BasePrice, approximation). Avant : silencieusement gratuites.
  imports: Record<string, number>;
  importCost: number;
}

// Débits homogènes en "par minute".
// cycleTime est en secondes ; NeedConsumptionRate est par minute et par résident.
export const prodRatePerMin = (p: BProd, good: string): number => {
  const out = p.outputs.find((o) => o.good === good);
  if (!out || !p.cycleTime) return 0;
  return (out.amount / p.cycleTime) * 60;
};
export const inputRatePerMin = (p: BProd, amount: number): number =>
  p.cycleTime ? (amount / p.cycleTime) * 60 : 0;

// Entretien (argent/min) pour produire 1 unité/min d'un bien, chaîne incluse.
// Memo module-level : ne dépend que des données statiques de l'économie.
const upkeepMemo = new Map<string, number>();
const upkeepPerUnit = (good: string, region?: string, stack = new Set<string>()): number => {
  const key = `${good}|${region ?? ""}`;
  if (upkeepMemo.has(key)) return upkeepMemo.get(key)!;
  if (stack.has(good)) return 0;
  const d = pickProducer(good, region);
  if (!d) return 0; // matière brute
  const p = economy.buildingProd[d];
  if (!p) return 0;
  const r = prodRatePerMin(p, good);
  if (r <= 0) return 0;
  let u = (1 / r) * upkeepOf(d);
  stack.add(good);
  for (const inp of p.inputs) {
    u += ((1 / r) * inputRatePerMin(p, inp.amount)) * upkeepPerUnit(inp.good, region, stack);
  }
  stack.delete(good);
  upkeepMemo.set(key, u);
  return u;
};

export interface TierProfileOptions {
  optimizeNeeds?: boolean;
  needSelection?: "all" | "thresholds";
  housesPerService?: number;
  capacityOverride?: number;
}

/**
 * Besoins RETENUS d'un tier (partagé solveur ↔ planificateur d'île) :
 * - "thresholds" : par catégorie, sous-ensemble coût/poids minimal atteignant le
 *   seuil d'upgrade (SupplyWeight) — mécanique réelle du jeu (GAME_MECHANICS.md §3).
 * - sinon : tous les besoins, ou les rentables si optimizeNeeds.
 */
export function buildTierProfile(tierGuid: string, o: TierProfileOptions = {}): TierProfile {
  const tier = tierByGuid(tierGuid);
  if (!tier) return { goods: [], services: [], cap: 1, money: 0 };
  const housesPerService = o.housesPerService ?? DEFAULT_HOUSES_PER_SERVICE;
  const goods: { good: string | null; rate: number }[] = [];
  const services: { building: string | null }[] = [];
  let cap = 0;
  let money = 0;
  const thresholds = tier.upgradeThresholds || {};
  if (o.needSelection === "thresholds" && Object.keys(thresholds).length) {
    // par catégorie : trier coût/poids croissant, prendre jusqu'au seuil
    type Cand = { kind: "good" | "svc"; idx: number; weight: number; cost: number };
    const byCat = new Map<string, Cand[]>();
    tier.goods.forEach((g, idx) => {
      const cost = g.good ? g.rate * upkeepPerUnit(g.good, worldOf(tier.region)) : 0;
      const arr = byCat.get(g.category) ?? [];
      arr.push({ kind: "good", idx, weight: g.weight || 1, cost });
      byCat.set(g.category, arr);
    });
    tier.services.forEach((s, idx) => {
      const cost = (s.building ? upkeepOf(s.building) : 0) / housesPerService;
      const arr = byCat.get(s.category) ?? [];
      arr.push({ kind: "svc", idx, weight: s.weight || 1, cost });
      byCat.set(s.category, arr);
    });
    const keepG = new Set<number>(), keepS = new Set<number>();
    for (const [cat, target] of Object.entries(thresholds)) {
      const list = (byCat.get(cat) ?? []).sort((a, b) => a.cost / a.weight - b.cost / b.weight);
      let score = 0;
      for (const c of list) {
        if (score >= target) break;
        score += c.weight;
        (c.kind === "good" ? keepG : keepS).add(c.idx);
      }
      // score < target possible (catégorie incomplète) → best-effort, tout pris
    }
    tier.goods.forEach((g, i) => { if (keepG.has(i)) { goods.push({ good: g.good, rate: g.rate }); cap += g.pop; money += g.money; } });
    tier.services.forEach((s, i) => { if (keepS.has(i)) { services.push({ building: s.building }); cap += s.pop; money += s.money; } });
  } else {
    const keepGood = (g: typeof tier.goods[number]) =>
      !o.optimizeNeeds || !g.good || g.money - g.rate * upkeepPerUnit(g.good, worldOf(tier.region)) >= 0;
    const keepSvc = (s: typeof tier.services[number]) =>
      !o.optimizeNeeds || s.money - (s.building ? upkeepOf(s.building) : 0) / housesPerService >= 0;
    for (const g of tier.goods) if (keepGood(g)) { goods.push({ good: g.good, rate: g.rate }); cap += g.pop; money += g.money; }
    for (const s of tier.services) if (keepSvc(s)) { services.push({ building: s.building }); cap += s.pop; money += s.money; }
  }
  // garde-fou : capacité minimale -> sinon retombe sur tous les besoins
  if (cap < 1) {
    goods.length = 0; services.length = 0; cap = 0; money = 0;
    for (const g of tier.goods) { goods.push({ good: g.good, rate: g.rate }); cap += g.pop; money += g.money; }
    for (const s of tier.services) { services.push({ building: s.building }); cap += s.pop; money += s.money; }
  }
  if (!o.optimizeNeeds && o.needSelection !== "thresholds")
    cap = o.capacityOverride || cap || tier.capacityDefault || 10;
  return { goods, services, cap: Math.max(1, cap), money };
}

/**
 * Solveur point-fixe : population cible -> besoins (biens) -> bâtiments de
 * production -> main-d'œuvre requise -> population supplémentaire -> ... jusqu'à
 * convergence. Renvoie les comptes de bâtiments + le bilan.
 */
export function solve(targets: PopTarget[], opts: SolveOptions, extraDemand: ExtraDemand = {}): SolveResult {
  const housesPerService = opts.housesPerService ?? DEFAULT_HOUSES_PER_SERVICE;
  const includeWorkforce = opts.includeWorkforce !== false;
  const targetMap: Record<string, number> = {};
  for (const t of targets) targetMap[t.tier] = (targetMap[t.tier] || 0) + t.pop;

  // Profil par tier : besoins retenus — tous, rentables (optimizeNeeds), ou
  // sous-ensemble le moins cher atteignant les seuils d'upgrade (needSelection).
  const needMode = opts.needSelection ?? "all";
  const profiles = new Map<string, TierProfile>();
  for (const tier of economy.tiers) {
    profiles.set(tier.guid, buildTierProfile(tier.guid, {
      optimizeNeeds: opts.optimizeNeeds,
      needSelection: needMode,
      housesPerService,
      capacityOverride: opts.capacities[tier.guid],
    }));
  }
  const prof = (tier: string) => profiles.get(tier)!;

  // Production (fractionnaire) + demande de biens (par minute) pour une population donnée.
  const computeProduction = (popMap: Record<string, number>) => {
    const demand: Record<string, number> = { ...extraDemand }; // objectif de production exogène
    // préférence régionale par bien (région du tier qui le consomme ; "" si mixte/exogène).
    const demandRegion: Record<string, string> = {};
    const noteRegion = (good: string, region: string) => {
      if (!(good in demandRegion)) demandRegion[good] = region;
      else if (demandRegion[good] !== region) demandRegion[good] = ""; // consommé par 2 régions
    };
    // biens exogènes (objectif de prod) : préfèrent la région de l'île si fournie
    for (const g of Object.keys(extraDemand)) noteRegion(g, opts.region ?? "");
    for (const tier of economy.tiers) {
      const p = popMap[tier.guid];
      if (!p) continue;
      const pr = prof(tier.guid);
      const houses = p / pr.cap; // NeedConsumptionRate est par MAISON (hypothèse défaut)
      // Q1 : si la conso s'avère par HABITANT en jeu, on consomme `p` (population) au
      // lieu de `houses` — un seul point de bascule, le reste de la cascade suit.
      const consumers = opts.consumptionUnit === "resident" ? p : houses;
      for (const g of pr.goods) {
        if (!g.good) continue;
        demand[g.good] = (demand[g.good] || 0) + consumers * g.rate;
        noteRegion(g.good, worldOf(tier.region));
      }
    }
    const counts: Record<string, number> = {};
    const imports: Record<string, number> = {};
    if (opts.includeProduction) {
      const stack = new Set<string>();
      const requireGood = (good: string, ratePerMin: number, region?: string) => {
        if (ratePerMin <= 0 || stack.has(good)) return;
        const defId = pickProducer(good, region);
        if (!defId) { imports[good] = (imports[good] || 0) + ratePerMin; return; } // matière brute → import
        const p = economy.buildingProd[defId];
        if (!p) return;
        const r = prodRatePerMin(p, good);
        if (r <= 0) return;
        const count = ratePerMin / r;
        counts[defId] = (counts[defId] || 0) + count;
        stack.add(good);
        for (const inp of p.inputs) requireGood(inp.good, count * inputRatePerMin(p, inp.amount), region);
        stack.delete(good);
      };
      for (const [good, rate] of Object.entries(demand)) {
        const region = demandRegion[good] || undefined;
        requireGood(good, rate, region);
      }
    }
    return { demand, counts, imports };
  };

  let pop: Record<string, number> = { ...targetMap };
  let production: Record<string, number> = {};
  let goodsDemand: Record<string, number> = {};
  let goodsImports: Record<string, number> = {};
  let iterations = 0;
  let converged = true;

  for (let iter = 0; iter < 200; iter++) {
    iterations = iter + 1;
    const { demand, counts, imports } = computeProduction(pop);
    goodsDemand = demand;
    production = counts;
    goodsImports = imports;

    if (!includeWorkforce) break; // pas de cascade : pop = cibles seulement

    // B6 (À CONFIRMER EN JEU — GAME_MECHANICS) : ici la cascade FAIT MONTER la pop pour
    // satisfaire 100% de la main-d'œuvre. Si le jeu DÉGRADE la prod quand la M.O. manque
    // (au lieu d'invoquer des résidents), basculer ici en mode "derate" : garder pop =
    // cibles, calculer ratio = min(1, fournie/demandée) par tier, et scaler counts/
    // goodsPerMin/marketValue par ce ratio (seuil 10% = WorkforceThresholdInPercent).
    // Les 3 branches sont pré-spécifiées dans .claude/ROADMAP.md (Phase 6).
    // main-d'œuvre consommée par tier -> population requise
    const wfConsumed: Record<string, number> = {};
    for (const [defId, count] of Object.entries(counts)) {
      const wf = economy.buildingWorkforce[defId];
      if (!wf) continue;
      for (const w of wf) wfConsumed[w.tier] = (wfConsumed[w.tier] || 0) + count * w.amount;
    }
    const next: Record<string, number> = { ...targetMap };
    for (const tier of economy.tiers) {
      const fromWf = tier.factor > 0 ? (wfConsumed[tier.guid] || 0) / tier.factor : 0;
      next[tier.guid] = Math.max(targetMap[tier.guid] || 0, fromWf);
    }
    let stable = true;
    let diverge = false;
    for (const tier of economy.tiers) {
      const nv = next[tier.guid] || 0;
      const ov = pop[tier.guid] || 0;
      if (Math.abs(nv - ov) > Math.max(0.5, 0.001 * Math.max(nv, ov))) stable = false;
      if (nv > 2_000_000) diverge = true;
    }
    pop = next;
    if (stable) break;
    if (diverge || iter === 199) {
      // cascade instable : repli sur les besoins DIRECTS (population = cible)
      converged = false;
      pop = { ...targetMap };
      const direct = computeProduction(pop);
      goodsDemand = direct.demand;
      production = direct.counts;
      goodsImports = direct.imports; // sinon manifeste d'import périmé (dernière itér divergée)
      break;
    }
  }

  // résidences
  const residencesByTier: Record<string, number> = {};
  for (const tier of economy.tiers) {
    const p = pop[tier.guid] || 0;
    if (p > 0 && tier.residenceId) residencesByTier[tier.guid] = Math.ceil(p / prof(tier.guid).cap);
  }

  // services : bâtiments d'influence par besoin de service (retenus)
  const serviceCounts: Record<string, number> = {};
  if (opts.includeServices) {
    const resUsing: Record<string, number> = {};
    for (const tier of economy.tiers) {
      const res = residencesByTier[tier.guid] || 0;
      if (!res) continue;
      for (const s of prof(tier.guid).services) {
        if (s.building) resUsing[s.building] = (resUsing[s.building] || 0) + res;
      }
    }
    for (const [defId, res] of Object.entries(resUsing)) {
      serviceCounts[defId] = Math.max(1, Math.ceil(res / housesPerService));
    }
  }

  // production arrondie
  const productionCounts: Record<string, number> = {};
  for (const [defId, c] of Object.entries(production)) productionCounts[defId] = Math.ceil(c);

  // items pour l'optimiseur
  const items: { defId: string; qty: number }[] = [];
  for (const tier of economy.tiers) {
    const r = residencesByTier[tier.guid];
    if (r && tier.residenceId) items.push({ defId: tier.residenceId, qty: r });
  }
  for (const [defId, c] of Object.entries(productionCounts)) items.push({ defId, qty: c });
  for (const [defId, c] of Object.entries(serviceCounts)) items.push({ defId, qty: c });

  // argent/min : taxe des résidences − entretien des bâtiments
  let gross = 0;
  let upkeep = 0;
  for (const tier of economy.tiers) {
    const res = residencesByTier[tier.guid] || 0;
    gross += res * prof(tier.guid).money; // taxe = Money des besoins retenus
    if (tier.residenceId) upkeep += res * upkeepOf(tier.residenceId);
  }
  for (const [defId, c] of Object.entries(productionCounts)) upkeep += c * upkeepOf(defId);
  for (const [defId, c] of Object.entries(serviceCounts)) upkeep += c * upkeepOf(defId);

  // valeur marchande des biens demandés (potentiel de vente, hors net)
  let marketValue = 0;
  for (const [good, rate] of Object.entries(goodsDemand)) marketValue += rate * priceOf(good);
  // coût d'achat des matières premières importées (BasePrice ≈ prix d'achat PNJ, approx.)
  let importCost = 0;
  for (const [good, rate] of Object.entries(goodsImports)) importCost += rate * priceOf(good);

  return {
    populationByTier: pop,
    residencesByTier,
    productionCounts,
    serviceCounts,
    goodsPerMin: goodsDemand,
    items,
    iterations,
    converged,
    money: { gross: Math.round(gross), upkeep: Math.round(upkeep), net: Math.round(gross - upkeep) },
    marketValue: Math.round(marketValue),
    imports: goodsImports,
    importCost: Math.round(importCost),
  };
}
