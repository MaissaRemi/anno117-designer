import { economy, tierByGuid, upkeepOf, type BProd } from "./economy";

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
}

interface TierProfile {
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
}

// Débits homogènes en "par minute".
// cycleTime est en secondes ; NeedConsumptionRate est par minute et par résident.
const prodRatePerMin = (p: BProd, good: string): number => {
  const out = p.outputs.find((o) => o.good === good);
  if (!out || !p.cycleTime) return 0;
  return (out.amount / p.cycleTime) * 60;
};
const inputRatePerMin = (p: BProd, amount: number): number =>
  p.cycleTime ? (amount / p.cycleTime) * 60 : 0;

/**
 * Solveur point-fixe : population cible -> besoins (biens) -> bâtiments de
 * production -> main-d'œuvre requise -> population supplémentaire -> ... jusqu'à
 * convergence. Renvoie les comptes de bâtiments + le bilan.
 */
export function solve(targets: PopTarget[], opts: SolveOptions, extraDemand: ExtraDemand = {}): SolveResult {
  const housesPerService = opts.housesPerService ?? 30;
  const includeWorkforce = opts.includeWorkforce !== false;
  const targetMap: Record<string, number> = {};
  for (const t of targets) targetMap[t.tier] = (targetMap[t.tier] || 0) + t.pop;

  // Entretien (argent/min) pour produire 1 unité/min d'un bien, chaîne incluse.
  const upkeepMemo = new Map<string, number>();
  const upkeepPerUnit = (good: string, stack = new Set<string>()): number => {
    if (upkeepMemo.has(good)) return upkeepMemo.get(good)!;
    if (stack.has(good)) return 0;
    const producers = economy.producers[good];
    if (!producers?.length) return 0; // matière brute
    const d = producers[0];
    const p = economy.buildingProd[d];
    if (!p) return 0;
    const r = prodRatePerMin(p, good);
    if (r <= 0) return 0;
    let u = (1 / r) * upkeepOf(d);
    stack.add(good);
    for (const inp of p.inputs) {
      u += ((1 / r) * inputRatePerMin(p, inp.amount)) * upkeepPerUnit(inp.good, stack);
    }
    stack.delete(good);
    upkeepMemo.set(good, u);
    return u;
  };

  // Profil par tier : besoins retenus (tous, ou seulement les rentables si optimizeNeeds).
  const profiles = new Map<string, TierProfile>();
  for (const tier of economy.tiers) {
    const goods: { good: string | null; rate: number }[] = [];
    const services: { building: string | null }[] = [];
    let cap = 0;
    let money = 0;
    const keepGood = (g: typeof tier.goods[number]) =>
      !opts.optimizeNeeds || !g.good || g.money - g.rate * upkeepPerUnit(g.good) >= 0;
    const keepSvc = (s: typeof tier.services[number]) =>
      !opts.optimizeNeeds || s.money - (s.building ? upkeepOf(s.building) : 0) / housesPerService >= 0;
    for (const g of tier.goods) if (keepGood(g)) { goods.push({ good: g.good, rate: g.rate }); cap += g.pop; money += g.money; }
    for (const s of tier.services) if (keepSvc(s)) { services.push({ building: s.building }); cap += s.pop; money += s.money; }
    // garde-fou : capacité minimale -> sinon retombe sur tous les besoins
    if (cap < 1) {
      goods.length = 0; services.length = 0; cap = 0; money = 0;
      for (const g of tier.goods) { goods.push({ good: g.good, rate: g.rate }); cap += g.pop; money += g.money; }
      for (const s of tier.services) { services.push({ building: s.building }); cap += s.pop; money += s.money; }
    }
    if (!opts.optimizeNeeds) cap = opts.capacities[tier.guid] || cap || tierByGuid(tier.guid)?.capacityDefault || 10;
    profiles.set(tier.guid, { goods, services, cap: Math.max(1, cap), money });
  }
  const prof = (tier: string) => profiles.get(tier)!;

  // Production (fractionnaire) + demande de biens (par minute) pour une population donnée.
  const computeProduction = (popMap: Record<string, number>) => {
    const demand: Record<string, number> = { ...extraDemand }; // objectif de production exogène
    for (const tier of economy.tiers) {
      const p = popMap[tier.guid];
      if (!p) continue;
      const pr = prof(tier.guid);
      const houses = p / pr.cap; // NeedConsumptionRate est par MAISON
      for (const g of pr.goods) {
        if (!g.good) continue;
        demand[g.good] = (demand[g.good] || 0) + houses * g.rate;
      }
    }
    const counts: Record<string, number> = {};
    if (opts.includeProduction) {
      const stack = new Set<string>();
      const requireGood = (good: string, ratePerMin: number) => {
        if (ratePerMin <= 0 || stack.has(good)) return;
        const producers = economy.producers[good];
        if (!producers || !producers.length) return; // matière brute
        const defId = producers[0];
        const p = economy.buildingProd[defId];
        if (!p) return;
        const r = prodRatePerMin(p, good);
        if (r <= 0) return;
        const count = ratePerMin / r;
        counts[defId] = (counts[defId] || 0) + count;
        stack.add(good);
        for (const inp of p.inputs) requireGood(inp.good, count * inputRatePerMin(p, inp.amount));
        stack.delete(good);
      };
      for (const [good, rate] of Object.entries(demand)) requireGood(good, rate);
    }
    return { demand, counts };
  };

  let pop: Record<string, number> = { ...targetMap };
  let production: Record<string, number> = {};
  let goodsDemand: Record<string, number> = {};
  let iterations = 0;
  let converged = true;

  for (let iter = 0; iter < 200; iter++) {
    iterations = iter + 1;
    const { demand, counts } = computeProduction(pop);
    goodsDemand = demand;
    production = counts;

    if (!includeWorkforce) break; // pas de cascade : pop = cibles seulement

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
  };
}
