import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { economy, residentialChain } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { compileTierEvaluator } from "../economy/needsModel";
import { candidateRecipes, landTax } from "./recipes";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const t4 = economy.tiers.find((t) => t.name === "Patriciens")!;
const chain = residentialChain(t4.guid);

describe("candidateRecipes", () => {
  const recipes = candidateRecipes(chain, lookup, { keep: 12 });

  it("produit des recettes STRICTEMENT plus maigres que « tous les services »", () => {
    expect(recipes.length).toBeGreaterThan(0);
    const allServices = t4.services.filter((s) => s.building).length;
    for (const r of recipes) expect(r.serviceIds.length).toBeLessThan(allServices);
  });

  it("chaque recette franchit RÉELLEMENT les seuils du palier cible", () => {
    for (const r of recipes) {
      const ev = compileTierEvaluator(chain, { goodsMet: true, relevant: new Set(r.serviceIds) });
      let mask = 0;
      for (const id of r.serviceIds) {
        const b = ev.bitOf.get(id);
        if (b !== undefined) mask |= 1 << b;
      }
      expect(ev.evaluate(mask).tier.guid).toBe(t4.guid);
    }
  });

  it("chaque recette est MINIMALE : retirer un service fait perdre le palier", () => {
    for (const r of recipes) {
      for (const drop of r.serviceIds) {
        const rest = r.serviceIds.filter((id) => id !== drop);
        const ev = compileTierEvaluator(chain, { goodsMet: true, relevant: new Set(rest) });
        let mask = 0;
        for (const id of rest) {
          const b = ev.bitOf.get(id);
          if (b !== undefined) mask |= 1 << b;
        }
        expect(ev.evaluate(mask).tier.guid).not.toBe(t4.guid);
      }
    }
  });

  it("elles occupent nettement moins de sol que la recette complète", () => {
    const allTax = t4.services
      .map((s) => s.building && lookup(s.building))
      .filter((d): d is BuildingDef => !!d && !!(d.streetRange || d.radius?.range))
      .reduce((s, d) => s + landTax(d), 0);
    for (const r of recipes) expect(r.landTax).toBeLessThan(allTax);
    expect(recipes[0].landTax).toBeLessThan(allTax * 0.6);
  });

  it("sortie déterministe et sans doublon", () => {
    const a = candidateRecipes(chain, lookup, { keep: 8 });
    const b = candidateRecipes(chain, lookup, { keep: 8 });
    expect(a.map((r) => r.serviceIds.join(","))).toEqual(b.map((r) => r.serviceIds.join(",")));
    expect(new Set(a.map((r) => r.serviceIds.join(","))).size).toBe(a.length);
  });

  it("landTax : un petit bâtiment à longue portée coûte moins qu'un gros à courte portée", () => {
    const citerne = lookup("g19753")!; // 3×3, portée-rue 36
    const grammaticus = lookup("g3616")!; // 6×8, portée-rue 26
    expect(landTax(citerne)).toBeLessThan(landTax(grammaticus));
  });
});
