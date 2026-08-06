import { describe, expect, it } from "vitest";
import { economy, residentialChain, type Tier } from "./economy";
import { compileTierEvaluator } from "./needsModel";

/**
 * Tests de FIDÉLITÉ AUX RÈGLES DU JEU, dérivés directement de `economy.generated.json`.
 *
 * Ils ne verrouillent aucun comportement de moteur : ils affirment ce que le JEU fait.
 * C'est l'angle mort qui avait laissé passer le modèle « tous les services requis » —
 * les golden snapshots figeaient le comportement existant, pas le comportement correct.
 */

const tierByName = (n: string): Tier => economy.tiers.find((t) => t.name === n)!;
const t4 = tierByName("Patriciens");
const chain = residentialChain(t4.guid);

/** Masque de couverture à partir d'une liste de defId de service. */
const maskOf = (ev: { bitOf: Map<string, number> }, ids: string[]): number =>
  ids.reduce((m, id) => m | (1 << (ev.bitOf.get(id) ?? 31)), 0);

const svc = (t: Tier, cat: string) => t.services.filter((s) => s.category === cat && s.building);
const byWeightDesc = (a: { weight: number }, b: { weight: number }) => b.weight - a.weight;

describe("données d'upgrade : ce que le jeu exige réellement", () => {
  it("la chaîne résidentielle romaine va de Liberti à Patriciens", () => {
    expect(chain.map((t) => t.name)).toEqual(["Liberti", "Plébéiens", "Equites", "Patriciens"]);
  });

  it("les seuils sont des SOUS-ENSEMBLES : jamais la totalité des besoins du palier", () => {
    for (const t of chain) {
      for (const [cat, target] of Object.entries(t.upgradeThresholds)) {
        const dispo = [...t.goods, ...t.services]
          .filter((n) => n.category === cat)
          .reduce((s, n) => s + (n.weight || 0), 0);
        expect(dispo).toBeGreaterThanOrEqual(target); // seuil atteignable
        // c'est TOUT l'enjeu : le seuil est strictement en dessous du total disponible,
        // donc plusieurs recettes différentes y arrivent (besoins substituables)
        if (cat === "Public" || cat === "Wonders") expect(target).toBeLessThan(dispo);
      }
    }
  });
});

describe("compileTierEvaluator — palier atteint", () => {
  const ev = compileTierEvaluator(chain, { goodsMet: true });

  it("aucun service couvrant → palier de base", () => {
    const r = ev.evaluate(0);
    expect(r.index).toBe(0);
    expect(r.tier.name).toBe("Liberti");
    expect(r.cap).toBeGreaterThan(0); // la maison existe, elle n'est simplement pas montée
  });

  it("tous les services couvrants → palier cible, capacité = capacityDefault", () => {
    const all = maskOf(ev, ev.serviceIds);
    const r = ev.evaluate(all);
    expect(r.tier.guid).toBe(t4.guid);
    expect(r.cap).toBe(t4.capacityDefault); // Σ Population de TOUS les besoins
  });

  it("les 2 plus gros services Public + les Wonders au seuil SUFFISENT (ancien modèle : non)", () => {
    // Patriciens : Public 15 sur 34 disponibles → Temple (8) + Bibliothèque (8) = 16 ✓
    const publics = svc(t4, "Public").sort(byWeightDesc).slice(0, 2);
    // Wonders 12 sur 16 → Amphithéâtre (8) + Forum ou Bains (4) = 12 ✓
    const wonders = svc(t4, "Wonders").sort(byWeightDesc);
    const chosen = [...publics, wonders[0], wonders[1]].map((s) => s.building!);
    expect(chosen.length).toBeLessThan(t4.services.length); // strictement moins que « tous »

    const r = ev.evaluate(maskOf(ev, chosen));
    expect(r.tier.guid).toBe(t4.guid);
    // et la maison vaut MOINS qu'une maison pleinement desservie : c'est l'arbitrage réel
    expect(r.cap).toBeLessThan(t4.capacityDefault);
    expect(r.cap).toBeGreaterThan(0);
  });

  it("le plus gros Wonder est indispensable : les deux petits ne franchissent pas le seuil", () => {
    // GAME_MECHANICS §9 : Forum 4 + Bains 4 = 8 < 12 → l'Amphithéâtre est obligatoire
    const wonders = svc(t4, "Wonders").sort(byWeightDesc);
    const petits = wonders.slice(1).map((s) => s.building!);
    const publics = svc(t4, "Public").map((s) => s.building!); // tout le Public possible
    const r = ev.evaluate(maskOf(ev, [...publics, ...petits]));
    expect(r.tier.guid).not.toBe(t4.guid);
    const gros = ev.evaluate(maskOf(ev, [...publics, ...petits, wonders[0].building!]));
    expect(gros.tier.guid).toBe(t4.guid);
  });

  it("monotonie : ajouter un service ne fait jamais baisser le palier ni la capacité", () => {
    const ids = ev.serviceIds;
    let mask = 0;
    let prev = ev.evaluate(0);
    for (const id of ids) {
      mask |= 1 << ev.bitOf.get(id)!;
      const r = ev.evaluate(mask);
      expect(r.index).toBeGreaterThanOrEqual(prev.index);
      expect(r.cap).toBeGreaterThanOrEqual(prev.cap);
      prev = r;
    }
  });

  it("la capacité est CONTINUE : elle croît avec les besoins remplis, pas par paliers seuls", () => {
    const publics = svc(t4, "Public").sort(byWeightDesc).slice(0, 2).map((s) => s.building!);
    const wonders = svc(t4, "Wonders").sort(byWeightDesc).slice(0, 2).map((s) => s.building!);
    const mini = maskOf(ev, [...publics, ...wonders]);
    const r0 = ev.evaluate(mini);
    // un service de plus, même sans changer de palier, ajoute ses habitants
    const extra = t4.services.find((s) => s.building && !(mini & (1 << ev.bitOf.get(s.building)!)))!;
    const r1 = ev.evaluate(mini | (1 << ev.bitOf.get(extra.building!)!));
    expect(r1.tier.guid).toBe(r0.tier.guid);
    if ((extra.pop || 0) > 0) expect(r1.cap).toBeGreaterThan(r0.cap);
  });

  it("`relevant` restreint : un service écarté ne compte ni pour le seuil ni pour la capacité", () => {
    const keep = new Set(svc(t4, "Wonders").map((s) => s.building!));
    const ev2 = compileTierEvaluator(chain, { goodsMet: true, relevant: keep });
    expect(ev2.serviceIds.every((id) => keep.has(id))).toBe(true);
    const r = ev2.evaluate(maskOf(ev2, [...keep]));
    // Public reste sous son seuil (aucun service Public retenu) → palier cible hors d'atteinte
    expect(r.tier.guid).not.toBe(t4.guid);
  });

  it("reference(k) = palier k tous services couverts (repli par palier)", () => {
    const last = ev.reference(chain.length - 1);
    expect(last.tier.guid).toBe(t4.guid);
    expect(last.cap).toBe(t4.capacityDefault);
    const first = ev.reference(0);
    expect(first.tier.guid).toBe(chain[0].guid);
  });

  it("mémoïsation : même masque → même objet (chemin chaud des moteurs)", () => {
    const m = maskOf(ev, ev.serviceIds.slice(0, 3));
    expect(ev.evaluate(m)).toBe(ev.evaluate(m));
  });
});
