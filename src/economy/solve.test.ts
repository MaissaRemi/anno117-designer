import { describe, expect, it } from "vitest";
import { economy, pickProducer, priceOf, regionOf, tiers } from "./economy";
import { buildTierProfile, solve } from "./solve";

const liberti = tiers.find((t) => /liberti/i.test(t.name)) ?? tiers[0];

describe("buildTierProfile (seuils d'upgrade)", () => {
  const tier = economy.tiers.find((t) => t.name === "Equites")!;

  it("mode seuils : sous-ensemble atteignant chaque seuil de catégorie", () => {
    const p = buildTierProfile(tier.guid, { needSelection: "thresholds" });
    const all = buildTierProfile(tier.guid, { needSelection: "all" });
    // moins (ou autant) de besoins que le mode complet
    expect(p.goods.length + p.services.length).toBeLessThanOrEqual(all.goods.length + all.services.length);
    expect(p.goods.length + p.services.length).toBeGreaterThan(0);
    // chaque catégorie à seuil atteint son score (SupplyWeight des retenus)
    const keptGoods = new Set(p.goods.map((g) => g.good));
    const keptSvc = new Set(p.services.map((s) => s.building));
    for (const [cat, target] of Object.entries(tier.upgradeThresholds)) {
      let score = 0;
      for (const g of tier.goods) if (g.category === cat && keptGoods.has(g.good)) score += g.weight;
      for (const s of tier.services) if (s.category === cat && keptSvc.has(s.building)) score += s.weight;
      expect(score, `catégorie ${cat}`).toBeGreaterThanOrEqual(target);
    }
  });

  it("capacité = Σ Population des besoins retenus (≤ capacité complète)", () => {
    const p = buildTierProfile(tier.guid, { needSelection: "thresholds" });
    expect(p.cap).toBeGreaterThanOrEqual(1);
    expect(p.cap).toBeLessThanOrEqual(tier.capacityDefault);
  });
});

describe("solve (économie)", () => {
  it("loge la population cible et converge", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: true,
      includeServices: true,
      capacities: {},
    });
    expect(r.populationByTier[liberti.guid]).toBeGreaterThanOrEqual(1000);
    expect(r.residencesByTier[liberti.guid]).toBeGreaterThan(0);
    expect(r.converged).toBe(true); // cascade stable (taux par maison)
    expect(r.iterations).toBeLessThan(50);
    expect(r.populationByTier[liberti.guid]).toBeLessThan(1_000_000);
    expect(r.items.length).toBeGreaterThan(0);
  });

  it("génère des bâtiments de production quand includeProduction", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: true,
      includeServices: false,
      capacities: {},
    });
    expect(Object.keys(r.productionCounts).length).toBeGreaterThan(0);
  });

  it("sans production : pas de cascade, pop = cible", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: false,
      includeServices: true,
      capacities: {},
    });
    expect(Object.keys(r.productionCounts).length).toBe(0);
    expect(r.populationByTier[liberti.guid]).toBe(1000);
  });

  it("optimizeNeeds (max éco) ne dégrade jamais le net", () => {
    const pat = tiers.find((t) => /atricien/i.test(t.name)) ?? liberti;
    const base = { includeProduction: true, includeServices: true, capacities: {} };
    const all = solve([{ tier: pat.guid, pop: 1000 }], { ...base, optimizeNeeds: false });
    const opt = solve([{ tier: pat.guid, pop: 1000 }], { ...base, optimizeNeeds: true });
    expect(opt.money.net).toBeGreaterThanOrEqual(all.money.net);
  });

  it("la capacité influe sur le nombre de résidences", () => {
    const a = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: false,
      includeServices: false,
      capacities: { [liberti.guid]: 10 },
    });
    const b = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: false,
      includeServices: false,
      capacities: { [liberti.guid]: 50 },
    });
    expect(a.residencesByTier[liberti.guid]).toBe(100);
    expect(b.residencesByTier[liberti.guid]).toBe(20);
  });

  it("expose la valeur marchande des biens (Σ débit × BasePrice)", () => {
    const r = solve([{ tier: liberti.guid, pop: 1000 }], {
      includeProduction: true,
      includeServices: false,
      capacities: {},
    });
    expect(r.marketValue).toBeGreaterThan(0);
    // recalcul indépendant à partir de la demande exposée
    let expected = 0;
    for (const [good, rate] of Object.entries(r.goodsPerMin)) expected += rate * priceOf(good);
    expect(r.marketValue).toBe(Math.round(expected));
  });
});

describe("pickProducer (préférence région)", () => {
  it("préfère un producteur de la région demandée quand il existe", () => {
    // cherche un bien produit par 2 régions différentes (cas réel des données)
    let tested = false;
    for (const [good, defs] of Object.entries(economy.producers)) {
      const regions = new Set(defs.map((d) => regionOf(d)).filter(Boolean));
      if (regions.size < 2) continue;
      for (const region of regions) {
        const chosen = pickProducer(good, region as string);
        expect(chosen).toBeDefined();
        expect(regionOf(chosen!)).toBe(region);
      }
      tested = true;
      break;
    }
    // au moins un bien multi-région doit exister dans les données du jeu
    expect(tested).toBe(true);
  });

  it("I3 — matières premières sans producteur → imports + importCost cohérent", () => {
    let foundPaid = false;
    for (const g of Object.keys(economy.producers).slice(0, 60)) {
      const r = solve([], { includeProduction: true, includeServices: false, capacities: {} }, { [g]: 10 });
      // invariant : importCost = Σ débit_import × BasePrice (arrondi)
      const expected = Math.round(Object.entries(r.imports).reduce((s, [ig, rate]) => s + rate * priceOf(ig), 0));
      expect(r.importCost).toBe(expected);
      if (r.importCost > 0) foundPaid = true;
    }
    // au moins une chaîne bottoms-out sur une matière première à importer (≠ gratuit)
    expect(foundPaid).toBe(true);
  });
});
