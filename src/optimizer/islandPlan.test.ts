import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { economy, residentialChainExtended } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { solve } from "../economy/solve";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport, verdictViable } from "./islandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
// tier réel avec résidence + au moins un service à rayon
const tier = economy.tiers.find(
  (t) => t.residenceId && t.services.some((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)),
)!;

const plan = (w: number, h: number, floor = 1) =>
  planIslandImport({ catalog, grid: makeGrid(w, h), tierGuid: tier.guid, coverageFloor: floor });

// capacité MAXIMALE d'une maison du palier (tous besoins remplis) — borne haute seulement :
// la capacité réelle vaut Σ Population des besoins REMPLIS (cf. economy/needsModel), donc
// deux maisons du même palier n'hébergent pas forcément autant.
const capOf = (guid: string) => economy.tiers.find((t) => t.guid === guid)?.capacityDefault ?? 1;
const maxMixed = (tc: Record<string, number>) => Object.entries(tc).reduce((s, [g, n]) => s + n * capOf(g), 0);

describe("planIslandImport (mode import)", () => {
  it("cale des maisons et renvoie un manifeste d'import", () => {
    const r = plan(36, 36, 0.5);
    expect(r.houses).toBeGreaterThan(0);
    // habitants = Σ des capacités RÉELLES par maison : strictement positif, et borné par
    // la capacité pleine de chaque palier (une maison partiellement desservie héberge moins)
    expect(r.residents).toBeGreaterThan(0);
    expect(r.residents).toBeLessThanOrEqual(maxMixed(r.tierCounts));
    expect(Object.values(r.tierCounts).reduce((a, b) => a + b, 0)).toBe(r.houses); // Σ tiers = maisons
    expect(r.fullyCovered).toBeLessThanOrEqual(r.houses);
    expect(r.buildings.length).toBeGreaterThanOrEqual(r.houses); // résidences + services
    expect(r.importGoods.length).toBeGreaterThan(0); // biens à acheminer
    expect(r.importGoods.every((g) => g.perMin > 0)).toBe(true);
  });

  it("plus de surface => au moins autant de maisons (monotone)", () => {
    const small = plan(24, 24, 0.5);
    const big = plan(48, 48, 0.5);
    expect(big.houses).toBeGreaterThanOrEqual(small.houses);
  });

  it("manifeste = demande directe solve(vecteur pop MIXTE par tier)", () => {
    const r = plan(36, 36, 0.5);
    const targets = Object.entries(r.tierCounts).map(([g, n]) => ({ tier: g, pop: n * capOf(g) }));
    const capacities = Object.fromEntries(Object.keys(r.tierCounts).map((g) => [g, capOf(g)]));
    const sol = solve(
      targets,
      { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, capacities },
    );
    // chaque bien du manifeste correspond à la demande solve mixte (arrondie)
    for (const g of r.importGoods.slice(0, 5)) {
      expect(Math.round((sol.goodsPerMin[g.good] || 0) * 100) / 100).toBeCloseTo(g.perMin, 1);
    }
  });

  it("best-effort : grille minuscule => peu de maisons, jamais d'échec", () => {
    const r = plan(10, 10, 1);
    expect(r.houses).toBeGreaterThanOrEqual(0);
    expect(r.mode).toBe("import");
    expect(Array.isArray(r.gaps)).toBe(true);
  });

  it("rapporte la couverture et les trous", () => {
    const r = plan(40, 40, 1);
    expect(r.coverage.services.length).toBeGreaterThan(0);
    expect(typeof r.coverageMin).toBe("number");
  });

  it("borne basse de non-régression sur l'île de référence, BILAN D'ÎLE positif", () => {
    // Golden numérique : la population livrée sur celtic_island_large_07 en mode auto.
    // Historique : 30 092 (audit) → 43 315 (seuils pondérés) → 65 404 (recette) → 67 862
    // (filet de repli + raffinage + ancrage eau) → 28 508.
    //
    // La chute n'est PAS une régression : le plan respecte désormais la contrainte de
    // viabilité. Les 67 862 précédents comptaient des maisons que le jeu aurait sanctionnées
    // par des émeutes, des incendies et des maladies — le nombre a changé de SENS, il compte
    // maintenant des habitants tenables.
    //
    // Le jugement porte sur le TOTAL de l'île, pas sur la pire maison : un quartier de
    // bordure en déficit compensé par le cœur ne pose aucun problème. C'est cette lecture
    // qui permet de garder ~1 235 maisons au lieu de 788.
    const grid = downscaleGrid(buildIslandGrid("celtic_island_large_07")!);
    const t4 = [...economy.tiers].filter((t) => t.residenceId)
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8 });
    expect(r.residents).toBeGreaterThan(24_000);
    expect(r.viable).toBe(true);
    for (const k of ["Happiness", "Money", "Health", "FireSafety"]) {
      expect(r.attrsTotal[k]).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("le balayage des paliers ne rend JAMAIS un plan pire que le palier demandé", () => {
    // Un palier plus haut ne loge pas forcément plus de monde : ses services mangent plus de
    // sol et son malus de rang de cité est plus lourd. Mesuré sur celtic_island_large_07,
    // viser les Nobles (capacité 21) livre 9 844 habitants en 488 maisons, viser les Aldermen
    // (capacité 18) en livre 22 114 en 1 698. Le balayage doit donc pouvoir DESCENDRE.
    //
    // L'invariant testé ici est celui qui compte et qui vaut sur toute île : le balayage
    // inclut le palier demandé parmi ses candidats, donc son résultat ne peut pas être pire.
    // Petite grille : c'est la propriété qu'on vérifie, pas un chiffre d'île.
    const g = makeGrid(48, 48);
    const t4 = [...economy.tiers].filter((t) => t.residenceId)
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    const plain = planIslandImport({ catalog, grid: g, tierGuid: t4.guid, coverageFloor: 0.8 });
    const auto = planIslandImport({ catalog, grid: g, tierGuid: t4.guid, coverageFloor: 0.8, autoTier: true });
    expect(auto.residents).toBeGreaterThanOrEqual(plain.residents);
    // le palier retenu appartient bien à la lignée demandée
    const ladder = residentialChainExtended(t4.guid).map((t) => t.guid);
    expect(ladder).toContain(auto.tierGuid);
    // et il est annoncé s'il diffère — l'utilisateur ne doit pas avoir à le deviner
    if (auto.tierGuid !== t4.guid) expect(auto.gaps.some((x) => x.includes("Palier"))).toBe(true);
  }, 120_000);

  it("l'arbitrage se fait sur le plan LIVRÉ, pas sur le plan nu", () => {
    // Le pré-tri compare des plans NUS : ni comptoir, ni exploitations, ni ateliers, ni
    // règlement de la main-d'œuvre. L'écart avec ce qui est réellement livré atteint 9 à
    // 12 % — assez pour inverser un classement, d'autant que `better()` traite deux plans
    // à moins de 2 % d'écart comme égaux et tranche alors sur des critères secondaires.
    //
    // Mesuré à l'époque (Nobles, celtic_island_large_07, seuil 1) : le pré-tri classait EN
    // TÊTE un plan nu à 9 820 habitants, qui n'en livrait que 8 968 ; le plan nu à 9 956,
    // relégué, en livrait 9 161.
    //
    // Le SEUIL a depuis été divisé par deux, et ce n'est pas une régression. Les paliers
    // d'Albion référençaient des bâtiments ROMAINS pour leurs services — le besoin était
    // résolu par icône, commune aux deux mondes, et seule la version romaine survivait. Le
    // moteur posait donc les DEUX variantes du même service, chacune avec son propre bit
    // dans l'évaluateur : une maison couverte par le Marché romain ET le Marché celtique
    // comptait le poids du besoin deux fois et franchissait des seuils hors de sa portée.
    // 9 598 habitants annoncés, 4 616 réels. Ce que ce test garde, c'est l'arbitrage sur le
    // plan livré, pas la valeur absolue.
    const grid = downscaleGrid(buildIslandGrid("celtic_island_large_07")!);
    const nobles = [...economy.tiers]
      .filter((t) => t.residenceId && ["Celtic", "RomanCeltic"].includes(t.region))
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    const r = planIslandImport({
      catalog, grid, tierGuid: nobles.guid, coverageFloor: 1,
      exploitSlots: true, localProduction: true,
    });
    expect(r.residents).toBeGreaterThan(4_000);
    expect(r.viable).toBe(true);
  }, 120_000);

  it("les DEUX modes de besoins atteignent le palier cible sur une île réelle", () => {
    // Régression 2026-08 : le palier était décidé par un ET booléen sur TOUS les services du
    // tier. En mode « seuils », qui écarte volontairement certains services, le masque devenait
    // insatisfiable → 0 maison au palier cible, par construction (mesuré sur une île 320²).
    // La vraie règle est un seuil de SupplyWeight par catégorie (cf. economy/needsModel).
    const grid = downscaleGrid(buildIslandGrid("roman_island_medium_01")!);
    const t4 = [...economy.tiers].filter((t) => t.residenceId)
      .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;
    // `all` sur une île pauvre en eau peut ne rien atteindre : c'est la recherche de recette
    // (mode par défaut) qui doit trouver une configuration tenable.
    for (const needMode of ["auto", "all"] as const) {
      const r = planIslandImport({ catalog, grid, tierGuid: t4.guid, coverageFloor: 0.8, needMode });
      expect(r.houses).toBeGreaterThan(100);
      // la population dépasse largement ce que donnerait un plan tout-au-palier-de-base
      const capBase = Math.min(...economy.tiers.filter((t) => t.residenceId).map((t) => t.capacityDefault));
      expect(r.residents).toBeGreaterThan(r.houses * capBase);
      if (needMode === "auto") {
        expect(r.fullyCovered).toBeGreaterThan(0);
        expect(r.viable).toBe(true);
      }
    }
  }, 120_000);
});

// ═══ VERDICT DE VIABILITÉ : LE PLANCHER DE BRUIT ═══════════════════════════════════════
//
// Le drapeau `viable` est binaire et `better()` le classe AVANT la population : un déficit
// de 0,034 par maison faisait donc écarter tout un palier par `autoTier`. Le plancher rend
// le verdict insensible au bruit de discrétisation du modèle SANS toucher au garde-fou de
// sélection, qui reste strict (cf. `viability.test.ts`).
describe("verdict de viabilité — plancher de bruit du modèle (BRUIT_VITAL)", () => {
  // Cas MESURÉ : roman_island_medium_05, palier Patriciens — FireSafety = −21 sur
  // 625 maisons (−0,034/maison), quand le Bonheur vaut +3 637 et l'Argent +46 414.
  // Avant le plancher, `autoTier` se rabattait sur Plébéiens : 20 904 → 4 992 habitants.
  const attrs = (fire: number) => ({ Happiness: 3637, Money: 46414, Health: 2883, FireSafety: fire });

  it("absorbe un déficit diffus sous 0,05/maison, à tolérance nulle (cas medium_05)", () => {
    expect(verdictViable(attrs(-21), 625)).toBe(true);      // −0,034/maison : le cas réel
    expect(verdictViable(attrs(-31.25), 625)).toBe(true);   // borne exacte 0,05 × 625, incluse
  });

  it("rejette un vrai déficit : ce n'est pas une tolérance déguisée", () => {
    expect(verdictViable(attrs(-32), 625)).toBe(false);     // −0,051/maison, juste au-delà
    expect(verdictViable(attrs(-625), 625)).toBe(false);    // −1/maison : ville en feu
  });

  it("la tolérance du joueur s'AJOUTE au plancher, elle ne le remplace pas", () => {
    expect(verdictViable(attrs(-625), 625, 1)).toBe(true);  // (1 + 0,05) × 625 = 656,25
    expect(verdictViable(attrs(-657), 625, 1)).toBe(false);
  });

  it("sans maison, aucune marge : seuls des attributs positifs passent", () => {
    expect(verdictViable({ FireSafety: -1 }, 0)).toBe(false);
    expect(verdictViable({}, 0)).toBe(true);
  });
});
