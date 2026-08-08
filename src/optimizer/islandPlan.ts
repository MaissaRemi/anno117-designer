import { makeLookup } from "../engine/rules";
import type { AqueductTile, BuildingDef, FieldTile, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import { economy, residentialChainExtended, upkeepOf } from "../economy/economy";
import { buildTierProfile, solve } from "../economy/solve";
import { compileTierEvaluator } from "../economy/needsModel";
import { cityStatusAttrs, tierByGuid } from "../economy/economy";
import { institutionDefs, pickPatron, SHRINE_TYPE, isViable, VITAL_ATTRS, worstAttr } from "../economy/attributes";
import { effectOf } from "../economy/economy";
import { footprintSize } from "../engine/geometry";
import { candidateRecipes } from "./recipes";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";
import { hostableTiers, planLattice, type LatticeResult } from "./planLattice";
import { planPacked, type PackResult } from "./packPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";
import { blockMountains, needsWater, planWater, type WaterConsumerReport, type WaterPlanResult } from "./waterPlan";
import { connectKontor, pickKontorDef, repairRoadConnectivity, reserveKontor } from "./kontor";
import { planSlots, type ExploitedSlot } from "./slotPlan";
import { WorkforceLedger } from "./workforceLedger";
import { workforceGrant } from "../economy/workforce";
import { netOf, planLocalProduction, type LocalWorkshop } from "./localProd";
import { regionOfIsland } from "../data/islands";

export interface IslandPlanRequest {
  catalog: BuildingDef[];
  grid: GridShape;
  /** Archetype d'île : population (défaut, mode import) ou production (export). */
  mode?: "population" | "production";
  tierGuid: string; // tier-cible (ex Patriciens) — mode population
  coverageFloor?: number; // 0..1, défaut 1 (seuil pour le flag feasible)
  /** Choix des services à poser :
   *  - "auto" (défaut) : RECHERCHE DE RECETTE — on énumère les sous-ensembles minimaux
   *    qui franchissent les seuils du palier, on présélectionne par taxe foncière, puis
   *    on tranche en faisant tourner le vrai moteur sur chacun (cf. optimizer/recipes.ts).
   *    Mesuré ×1,48 sur la population face à « tous les services ».
   *  - "all" : tous les services du palier (max de bonus par maison, densité minimale).
   *  - "thresholds" : ancien pré-choix par ratio entretien/poids — conservé pour
   *    comparaison, mais il retient systématiquement les services les plus coûteux
   *    en sol (Grammaticus, Marché, Taverne) et perd contre "auto". */
  needMode?: "auto" | "all" | "thresholds";
  /** Nombre de recettes évaluées avec le moteur réel en mode "auto" (défaut 8).
   *  Chaque évaluation coûte 80 à 400 ms selon la taille de l'île. */
  recipeCount?: number;
  /** Exploiter les emplacements de terrain (montagne, rivière, marais) que le réseau
   *  d'eau n'a PAS consommés : mines, carrières, argile… plus les entrepôts nécessaires
   *  pour que leur production sorte. L'eau reste prioritaire. Défaut false. */
  exploitSlots?: boolean;
  /** Produire une partie des biens SUR L'ÎLE au lieu de tout importer. Les ateliers sont
   *  posés tant que le bilan d'attributs de l'île reste positif — le surplus de Santé et
   *  d'Argent est exactement le budget qu'ils dépensent. Défaut false. */
  localProduction?: boolean;
  /** Mode production : bien cible (GUID) + débit u/min. */
  productionGood?: string;
  productionRate?: number;
  /** Fertilités/gisements disponibles sur l'île (GUIDs) — vide = toutes supposées OK. */
  islandFertilities?: string[];
  /** Hauteurs quantifiées de l'île (q = h/16, mer < 0) — pente des aqueducs.
   *  Décodées par le worker depuis terrain.generated (grid.islandId). */
  heights?: Int8Array;
  /**
   * PERMIS détenus en partie, par GUID de permis. Le seul qui compte aujourd'hui est le
   * permis d'autel (`SHRINE_PERMIT`) : il borne le nombre d'autels de la divinité tutélaire.
   * Ce n'est pas une donnée des fichiers du jeu mais un état de partie — défaut
   * `DEFAULT_PERMITS`.
   */
  permits?: Record<string, number>;
  /**
   * BALAYER LES PALIERS de la lignée et garder celui qui LOGE LE PLUS, au lieu de prendre
   * `tierGuid` pour argent comptant. Défaut false — c'est une option coûteuse (un plan
   * complet par palier) et le palier cible reste un objectif de partie, pas un simple
   * réglage.
   *
   * Elle existe parce qu'un palier plus haut n'héberge pas forcément plus de monde, et que
   * l'écart n'est pas marginal. Mesuré sur `celtic_island_large_07` : viser les Nobles
   * (capacité 21) livre 9 844 habitants en 488 maisons, viser les Aldermen (capacité 18) en
   * livre 22 114 en 1 698 maisons — soit 2,25 fois plus. Les Nobles sont la population
   * ROMANISÉE d'Albion : leur malus de rang de cité est bien plus lourd (−17,4 de Bonheur
   * contre −12,6 pour un natif) et leurs services mangent davantage de sol, si bien que le
   * garde-fou de viabilité rase les trois quarts du quartier.
   *
   * Ce n'est pas systématique : sur `roman_island_medium_01`, monotone, le sommet gagne
   * (Patriciens 17 266 contre Equites 7 409). D'où le balayage plutôt qu'une règle.
   */
  autoTier?: boolean;
}

export interface ImportGood {
  good: string;
  name: string;
  perMin: number;
}

export interface IslandPlanResult {
  mode: "import";
  tierGuid: string;
  tierName: string;
  cap: number;
  houses: number;
  fullyCovered: number; // maisons couvertes par TOUS leurs besoins (= tier-cible atteint)
  fullyCoveredPct: number; // 0..100 (fullyCovered / houses)
  /** Maisons par tier ATTEINT (guid → nb) : accounting MIXTE. Une maison sous-desservie
   *  retombe au meilleur palier atteint (min = base) — d'où residents = somme mixte. */
  tierCounts: Record<string, number>;
  residents: number; // habitants TOTAUX (mixte, tous paliers atteints)
  buildings: PlacedBuilding[]; // résidences + services + sources d'eau
  roads: RoadTile[];
  fields: FieldTile[];
  aqueducts: AqueductTile[]; // conduites d'eau (réseau source → consommateurs)
  water: {
    sources: number;
    capacity: number;
    used: number;
    consumers: WaterConsumerReport[];
  } | null; // null = aucun consommateur d'eau dans le plan
  importGoods: ImportGood[];
  /** Emplacements de terrain exploités (option `exploitSlots`) — vide si l'option est off. */
  exploited: ExploitedSlot[];
  /** Ateliers posés sur l'île (option `localProduction`) — leur production sort du manifeste. */
  workshops: LocalWorkshop[];
  /** BILAN DE L'ÎLE par attribut vital : somme sur toutes les maisons, malus de rang de
   *  cité compris. C'est le total qui doit rester ≥ 0 — une maison en déficit compensée
   *  par ses voisines ne pose pas de problème. */
  attrsTotal: Record<string, number>;
  /**
   * MAIN-D'ŒUVRE. `offer` et `demand` sont en unités par palier ; `deficit` non vide signifie
   * que des bâtiments tourneront au ralenti en jeu. `conversions` liste les maisons
   * rétrogradées pour armer la production locale.
   */
  workforce: {
    offer: Record<string, number>;
    demand: Record<string, number>;
    deficit: Record<string, number>;
    alien: Record<string, number>;
    conversions: { from: string; to: string; houses: number; popLost: number }[];
  };
  /** Le bilan de l'île tient-il sur les quatre attributs vitaux ? */
  viable: boolean;
  coverage: CoverageReport;
  coverageMin: number; // min % parmi les services à rayon (métrique de faisabilité)
  money: { gross: number; upkeep: number; net: number };
  attributes: Record<string, number>; // bonus cumulés (maisons pleines)
  gaps: string[]; // services non plaçables / trous de couverture
  feasible: boolean; // a atteint le seuil de couverture
}

const goodName = (g: string): string => economy.goodNames[g] || g;

/**
 * Point d'entrée UNIQUE du plan d'île : dispatch par archetype (population/import
 * vs production/export) + validation des paramètres. Le worker n'est qu'un shim.
 */
export function planIsland(
  req: IslandPlanRequest,
  onProgress?: (step: number, total: number) => void,
): IslandPlanResult | ProdPlanResult {
  if (req.mode === "production") {
    if (!req.productionGood || !req.productionRate) throw new Error("Bien et débit cibles requis.");
    return planIslandProduction(
      req.catalog, req.grid, makeLookup(req.catalog),
      req.productionGood, req.productionRate,
      { islandFertilities: req.islandFertilities }, onProgress,
    );
  }
  return planIslandImport(req, onProgress);
}

/**
 * Plan d'île — mode IMPORT. Cale le maximum de résidences du tier-cible sur l'île,
 * place les services publics pour couvrir au mieux (best-effort), et renvoie le
 * manifeste des biens à importer (u/min) pour satisfaire tous les besoins.
 *
 * Production et main-d'œuvre sont supposées sur une AUTRE île : l'île principale ne
 * contient que des maisons du tier-cible + leurs services d'influence.
 */
export function planIslandImport(
  req: IslandPlanRequest,
  onProgress?: (step: number, total: number) => void,
): IslandPlanResult {
  const needMode = req.needMode ?? "auto";
  const lookup = makeLookup(req.catalog);
  const tier = economy.tiers.find((t) => t.guid === req.tierGuid);
  if (!tier || !tier.residenceId) {
    throw new Error("Tier-cible invalide ou sans résidence.");
  }
  // ═══ BALAYAGE DES PALIERS (option) ═══════════════════════════════════════════════════
  // Un plan complet par palier de la lignée, et on garde celui qui loge le plus. La
  // récursion se fait drapeau BAISSÉ : chaque passe est un plan ordinaire. Le palier
  // effectivement retenu ressort dans `tierGuid` / `tierName`, l'appelant n'a rien à
  // deviner. Voir `IslandPlanRequest.autoTier` pour la mesure qui justifie l'option.
  if (req.autoTier) {
    const ladder = residentialChainExtended(req.tierGuid).filter((t) => t.residenceId);
    if (ladder.length > 1) {
      let best: IslandPlanResult | null = null;
      for (let i = 0; i < ladder.length; i++) {
        onProgress?.(i + 1, ladder.length);
        const r = planIslandImport({ ...req, tierGuid: ladder[i].guid, autoTier: false });
        const wins = !best
          || (r.feasible !== best.feasible ? r.feasible
            : r.viable !== best.viable ? r.viable
              : r.residents !== best.residents ? r.residents > best.residents
                : r.money.net > best.money.net);
        if (wins) best = r;
      }
      if (best) {
        if (best.tierGuid !== req.tierGuid) {
          const asked = economy.tiers.find((t) => t.guid === req.tierGuid);
          best.gaps.unshift(
            `Palier ${best.tierName} retenu à la place de ${asked?.name ?? req.tierGuid}`
            + " : il loge davantage sur cette île (balayage des paliers)",
          );
        }
        return best;
      }
    }
  }
  const chain = residentialChainExtended(req.tierGuid);
  const residenceIds = new Set(chain.map((t) => t.residenceId).filter((r): r is string => !!r));

  // --- RECETTES À ESSAYER ------------------------------------------------------------
  // `undefined` = tous les services du palier. Chaque entrée sera placée pour de vrai puis
  // évaluée ; c'est la population LIVRÉE qui tranche, pas une estimation. Un modèle
  // analytique ne suffit pas : confronté au moteur, son classement ne corrèle qu'à 0,45,
  // et le routage d'eau l'inverse (chaque citerne coûte 10 u, une conduite, un corridor).
  let landTiles = 0;
  for (const u of req.grid.usable) if (u) landTiles++;
  // Le plan aura-t-il besoin d'ouvriers ? Cela ne change PAS les recettes essayées (elles le
  // sont toutes, sous leurs deux formes), seulement l'arbitrage entre plans à population
  // comparable.
  const needWorkers = !!req.exploitSlots || !!req.localProduction;
  const trials: (string[] | undefined)[] = [];
  if (needMode === "auto") {
    // budget adaptatif : une évaluation coûte ~0,1 s sur une île moyenne mais plusieurs
    // secondes sur une continentale de 400 000 tuiles
    const land = landTiles;
    // BUDGET D'ESSAIS, pas de recettes : c'est le nombre de passes du moteur qui coûte, et
    // `keep` n'est qu'un plafond MOU — `candidateRecipes` y ajoute ses variantes. Le diviser
    // ne divisait donc rien : mesuré, 11 passes étaient devenues 15, soit +36 % de temps de
    // plan pour un commentaire qui promettait l'inverse. On réserve ici les places des
    // variantes au lieu de les découvrir après coup.
    const budget = req.recipeCount ?? (land > 200_000 ? 2 : land > 60_000 ? 5 : 7);
    const keepFallback = budget >= 5 ? 2 : 1;
    const keepOpened = budget >= 5 ? 2 : 1;
    const keep = Math.max(1, budget - keepFallback - keepOpened);
    // `candidateRecipes` produit lui-même ses variantes — filet de repli et ouverture des
    // paliers inférieurs — avec son propre dédoublonnage et son propre filtre catalogue.
    // Le budget porte sur les ESSAIS, c'est-à-dire sur le temps de calcul : `keep` n'est
    // qu'un plafond MOU côté recettes, et le diviser ne divisait rien. Mesuré avant
    // correction : 11 passes devenues 15, soit +36 % de temps de plan pour un commentaire
    // qui promettait l'inverse.
    for (const r of candidateRecipes(chain, lookup, { keep, keepFallback, keepOpened })) {
      trials.push(r.serviceIds);
    }
    // La recette COMPLÈTE en dernier recours — mais seulement tant qu'elle est abordable.
    // Elle pose 5 à 7 fois plus de copies, donc coûte 5 à 7 fois le temps d'un plan maigre
    // (5,5 s à elle seule sur une île continentale). Au-delà de 200 000 tuiles elle est de
    // toute façon battue par les recettes à filet de repli (437 287 contre 546 147 mesurés),
    // parce que la portée du Colisée y plafonne la part de maisons au palier cible.
    if (land <= 200_000) trials.push(undefined);
  } else if (needMode === "thresholds") {
    const profile = buildTierProfile(req.tierGuid, { needSelection: "thresholds" });
    trials.push([...new Set(profile.services.map((s) => s.building).filter((b): b is string => !!b))]);
  }
  if (!trials.length) trials.push(undefined); // "all", ou repli si l'énumération n'a rien donné

  // --- COMPTOIR (racine du réseau + entrée des imports) : réservé AVANT les moteurs ---
  // Aucun moteur n'en posait : le plan était formellement valide (sans racine,
  // rootedRoadSet accepte toutes les routes) mais injouable — sur une île d'IMPORT, les
  // 27 biens transitent par le port. On retire l'emprise du masque constructible pour que
  // les moteurs bâtissent autour, plutôt que d'avoir à raser un quartier après coup.
  const islandRegion = regionOfIsland(req.grid.islandId);
  // INSTITUTIONS anti-incidents : elles ne remplissent aucun besoin, l'optimiseur ne les
  // posait donc jamais — alors qu'elles sont le seul contrepoids au malus de rang de cité.
  // Mesuré : sans elles aucune ville ne dépasse 3 000 habitants avec tous ses attributs
  // positifs ; avec elles la recette complète tient jusqu'à 260 000.
  const instCands = institutionDefs(islandRegion)
    .flatMap((i) => { const d = lookup(i.defId); return d ? [{ ...i, uniqueType: d.uniqueType }] : []; });
  // DIVINITÉ TUTÉLAIRE : une seule par île. Le choix se fait sur le déficit d'attribut
  // observé, mesuré par une passe SANS autel — seul l'attribut limitant compte, et le
  // classement change complètement d'une île à l'autre. Il est fait plus bas, une fois ce
  // déficit connu ; ici on retient les institutions non religieuses, communes à tous les
  // essais, plus l'autel finalement élu.
  let patron: string | undefined;
  const institutions = instCands.filter((i) => i.uniqueType !== SHRINE_TYPE).map((i) => i.defId);
  const kontorDef = pickKontorDef(req.catalog, islandRegion);
  const kontor = kontorDef ? reserveKontor(req.grid, kontorDef) : null;

  // moteurs sur grille SANS les zones montagne (non constructibles en vrai, et la
  // source d'aqueduc en a besoin) ; l'eau est planifiée sur la grille d'origine
  const planGrid = blockMountains(kontor?.grid ?? req.grid);
  const coverageFloor = req.coverageFloor ?? 1;
  const svcCount = (r: { servicesPlaced: Record<string, number> }) =>
    Object.values(r.servicesPlaced).reduce((a, b) => a + b, 0);

  // --- ÉVALUATION D'UN CANDIDAT, EAU COMPRISE ---------------------------------------
  // planLattice route l'eau PENDANT le placement et exclut déjà de son comptage les
  // services non raccordés ; packPlan ne route rien et suppose tout actif. Comparer leurs
  // `tierCounts` bruts revenait donc à opposer un candidat pénalisé par la réalité à un
  // candidat optimiste. Mesuré (île 320², cible Patriciens, mode seuils) : packPlan
  // l'emportait de 9 habitants (0,1 %), puis l'eau routée après coup ne raccordait que
  // 2/40 consommateurs — contre 30/30 pour le lattice écarté. Critère de sélection ≠
  // métrique livrée. On route donc l'eau et on applique la démotion À CHAQUE candidat
  // AVANT de trancher.
  type Cand = LatticeResult | PackResult;
  interface Evaluated {
    cand: Cand;
    /** services que ce candidat était censé poser (undefined = tous ceux du palier) */
    relevant: Set<string> | null;
    water: WaterPlanResult;
    buildings: PlacedBuilding[];
    tierCounts: Record<string, number>;
    capByTier: Record<string, number>;
    deadTypes: Set<string>;
    residents: number;
    houseMoney: number;
    /** part des consommateurs d'eau réellement raccordés (0..1 ; 1 si aucun) */
    waterPct: number;
    /** bilan de l'île par attribut vital, rang de cité compris */
    attrsTotal: Record<string, number>;
    /** nombre de paliers que les parcelles de ce plan savent héberger (vivier) */
    hostable: number;
    /** le bilan de l'île tient-il ? */
    viable: boolean;
    /**
     * SIGNATURE GÉOMÉTRIQUE du plan posé. `finalize` est déterministe : deux candidats de
     * géométrie identique en rendront le même résultat, donc en finaliser un second est du
     * temps perdu — prouvé, pas supposé. Mesuré : la passe de divinité tutélaire rejoue la
     * recette gagnante et, quand l'autel ne change rien, produit un plan strictement égal ;
     * sur celtic_island_large_07 les finalistes #0 et #1 étaient ce même plan, soit un rang
     * sur trois gaspillé alors que le vrai gagnant était #2, de justesse.
     */
    sig: string;
  }
  const evaluate = (cand: Cand, relevant: Set<string> | null): Evaluated => {
    // évaluateur scopé à CE jeu de services : un service hors recette ne compte ni pour
    // les seuils ni pour la capacité (utilisé ici seulement par le repli de démotion)
    const evaluator = compileTierEvaluator(chain, { goodsMet: true, relevant: relevant ?? undefined });
    const water = cand.water ?? planWater(req.grid, cand.buildings, cand.roads, lookup, req.heights);
    const buildings = cand.water ? cand.buildings : [...cand.buildings, ...water.sources];
    // types de service dont AUCUN exemplaire n'est raccordé → inactifs en jeu
    const defOfUid = new Map(buildings.map((b) => [b.uid, b.defId]));
    const connectedByDef = new Map<string, number>();
    for (const c of water.consumers) {
      if (!c.connected) continue;
      const id = defOfUid.get(c.uid);
      if (id) connectedByDef.set(id, (connectedByDef.get(id) ?? 0) + 1);
    }
    const deadTypes = new Set(
      [...new Set(tier.services.map((s) => s.building))]
        .filter((id): id is string => !!id && (!relevant || relevant.has(id)))
        .filter((id) => { const d = lookup(id); return !!d && needsWater(d) && !connectedByDef.get(id); }),
    );
    // DÉMOTION : les maisons comptées à un tier « eau-bloqué » retombent au plus haut
    // tier sûr (la chaîne est nichée → le blocage est monotone), au lieu d'annuler
    // toute la population comme le faisait l'ancien gate tout-ou-rien.
    const tierSafe = (t: (typeof chain)[number]): boolean => t.services.every((s) =>
      !s.building || (relevant && !relevant.has(s.building)) ? true : !deadTypes.has(s.building));
    const tierCounts: Record<string, number> = { ...cand.tierCounts };
    const capByTier: Record<string, number> = { ...cand.capByTier };
    let houseMoney = cand.houseMoney;
    let cutoff = chain.length;
    for (let k = 0; k < chain.length; k++) if (!tierSafe(chain[k])) { cutoff = k; break; }
    if (cutoff < chain.length) {
      const safeIdx = Math.max(0, cutoff - 1);
      const safeGuid = chain[safeIdx]?.guid;
      // capacité attribuée aux maisons démotées : la moyenne OBSERVÉE du palier sûr si
      // des maisons y vivent déjà, sinon la référence tous-services-couverts. C'est une
      // approximation, sur un chemin de repli : les moteurs eau-aware ont déjà exclu les
      // services secs de leur comptage par maison, seul packPlan passe par ici.
      const avg = safeGuid && tierCounts[safeGuid]
        ? (capByTier[safeGuid] || 0) / tierCounts[safeGuid]
        : evaluator.reference(safeIdx).cap;
      const before = Object.values(capByTier).reduce((a, b) => a + b, 0);
      let moved = 0;
      for (let k = cutoff; k < chain.length; k++) {
        moved += tierCounts[chain[k].guid] || 0;
        delete tierCounts[chain[k].guid];
        delete capByTier[chain[k].guid];
      }
      if (moved && safeGuid) {
        tierCounts[safeGuid] = (tierCounts[safeGuid] || 0) + moved;
        capByTier[safeGuid] = (capByTier[safeGuid] || 0) + moved * avg;
      }
      const after = Object.values(capByTier).reduce((a, b) => a + b, 0);
      houseMoney = before > 0 ? houseMoney * (after / before) : 0;
    }
    // Ordre-indépendante et bon marché : somme de position et de type sur les emprises.
    let sig = 0;
    for (const b of buildings) {
      let h = 5381;
      for (let i = 0; i < b.defId.length; i++) h = (h * 33 + b.defId.charCodeAt(i)) | 0;
      sig = (sig + Math.imul(h, 2654435761) + b.x * 73856093 + b.y * 19349663) | 0;
    }
    const nCons = water.consumers.length;
    const nOk = water.consumers.filter((c) => c.connected).length;
    const residents = Math.round(Object.values(capByTier).reduce((a, b) => a + b, 0));
    // BILAN DE L'ÎLE : somme des attributs sur toutes les maisons, plus le malus de RANG
    // DE CITÉ appliqué à chacune — il dépend de la population totale et n'est donc connu
    // qu'ici. Le jugement porte sur le total, pas sur la pire maison : un quartier de
    // bordure en déficit compensé par le cœur de la ville ne pose pas de problème.
    // Le rang se lit avec la CULTURE du palier visé, pas avec le monde de l'île : sur une
    // même île d'Albion, une maison romanisée encaisse −17,4 Bonheur au dernier rang là où
    // une maison native n'en prend que −12,6.
    const rank = cityStatusAttrs(residents, tier?.region ?? islandRegion);
    const attrsTotal: Record<string, number> = {};
    for (const k of VITAL_ATTRS) attrsTotal[k] = (cand.attrsSum[k] ?? 0) + cand.houses * (rank[k] ?? 0);
    return {
      cand, relevant, water, buildings, tierCounts, capByTier, deadTypes, houseMoney,
      hostable: needWorkers ? hostableTiers(cand.plots).size : 0,
      residents,
      waterPct: nCons ? nOk / nCons : 1,
      attrsTotal,
      viable: isViable(attrsTotal),
      sig: `${buildings.length}:${sig}`,
    };
  };
  // Critère LEXICOGRAPHIQUE, faisabilité d'abord.
  //
  // 1) VIABILITÉ EAU. Un plan dont la majorité des consommateurs d'eau reste sèche n'est pas
  //    un plan valide pour ce tier : en jeu ces services sont inactifs, donc les maisons ne
  //    montent pas. Le gate par TYPE ne suffit pas à le capter (il ne démote que si AUCUNE
  //    copie n'est raccordée — 1 copie sur 21 suffit à le désarmer), d'où ce filtre explicite.
  //    C'est structurel : packPlan pose toutes ses maisons AVANT de router l'eau, il ne reste
  //    plus de corridor libre ; seul un moteur eau-aware peut être viable sur un tier à eau.
  // 2) Puis la population mixte, à 2 % près (en deçà c'est du bruit).
  // 3) Puis le taux de raccordement, la densité, et le moins de services (anti-confetti).
  //
  // Le plancher est volontairement TRÈS BAS. Un raccordement partiel est déjà pénalisé une
  // première fois par la démotion (`deadTypes`) ; en faire aussi un filtre à 50 % revenait à
  // une double peine, qui coûtait ~100 000 habitants sur une île continentale (un plan à
  // 437 000 habitants et 39 % de raccordement était rejeté au profit d'un plan à 339 000).
  // Ce qu'il faut éliminer, c'est le plan structurellement injouable — typiquement packPlan,
  // qui pose toutes ses maisons avant de router l'eau et ne laisse plus aucun corridor.
  const WATER_VIABLE = 0.15;
  const waterViable = (e: Evaluated): boolean => e.waterPct >= WATER_VIABLE;
  const better = (a: Evaluated, b: Evaluated): boolean => {
    if (waterViable(a) !== waterViable(b)) return waterViable(a);
    // VIABILITÉ DE L'ÎLE avant la population : un bilan négatif en Bonheur, Argent, Santé
    // ou Sécurité incendie déclenche émeutes, incendies et maladies. Maximiser la
    // population sans cette contrainte revenait à optimiser une ville que le jeu punit.
    if (a.viable !== b.viable) return a.viable;
    const close = Math.abs(a.residents - b.residents) <= 0.02 * Math.max(a.residents, b.residents, 1);
    if (!close) return a.residents > b.residents;
    // À population comparable, on préfère le plan dont le VIVIER est le plus riche : il
    // pourra héberger des maisons ouvrières de plus de paliers, donc armer davantage
    // d'ateliers et d'exploitations. C'est un départage, pas un sacrifice — la population
    // reste le critère premier.
    if (needWorkers && a.hostable !== b.hostable) return a.hostable > b.hostable;
    if (a.waterPct !== b.waterPct) return a.waterPct > b.waterPct;
    if (a.cand.houses !== b.cand.houses) return a.cand.houses > b.cand.houses;
    return svcCount(a.cand) <= svcCount(b.cand);
  };

  // --- ÉVALUATION DE CHAQUE RECETTE PAR LE MOTEUR RÉEL --------------------------------
  // C'est la population LIVRÉE qui décide. On garde aussi packPlan sur la première recette :
  // il gagne parfois sur les paliers sans consommateur d'eau (où son houses-first paie).
  // seuils de densification à balayer sur la recette GAGNANTE (cf. plus bas) : au-delà de
  // 0,9 le moteur sur-densifie (services 10,8 % → 19,4 % du sol) et la population baisse.
  const REFINE_FLOOR = 0.9;
  /**
   * FINALISTES passés au pipeline AVAL complet (comptoir, emplacements, ateliers, règlement
   * de la main-d'œuvre) avant que l'on tranche. Le pré-tri ci-dessous reste ce qu'il est —
   * une comparaison de plans NUS — mais il ne décide plus : il ne fait que présélectionner.
   *
   * 3 est un compromis mesuré : l'aval pèse ~10 % du temps d'un plan, le passer trois fois
   * coûte donc ~+20 %, et au-delà de trois les candidats retenus sont des variantes de seuil
   * du même plan, qui livrent la même chose.
   */
  const FINALISTS = 3;
  const total = trials.length + 2 + FINALISTS;
  /** Tous les plans NUS évalués — le vivier dans lequel les finalistes sont pris. */
  const cands: Evaluated[] = [];
  let pick: Evaluated | null = null;
  const runLattice = (serviceIds: string[] | undefined, floor: number): Evaluated =>
    evaluate(
      planLattice(planGrid, req.tierGuid, lookup, {
        coverageFloor: floor, serviceIds, water: true, heights: req.heights,
        institutions: patron ? [...institutions, patron] : institutions,
        permits: req.permits,
      }),
      serviceIds ? new Set(serviceIds) : null,
    );
  let bestTrial: string[] | undefined;
  for (let i = 0; i < trials.length; i++) {
    onProgress?.(i + 1, total);
    const ev = runLattice(trials[i], coverageFloor);
    cands.push(ev);
    if (!pick || better(ev, pick)) { pick = ev; bestTrial = trials[i]; }
  }
  // ═══ DIVINITÉ TUTÉLAIRE ═══════════════════════════════════════════════════════════════
  // Le choix ne peut pas être fait à l'avance : il dépend de l'attribut qui MANQUE, et celui
  // qui manque dépend du plan. On mesure donc le déficit sur le meilleur plan sans autel,
  // on élit le dieu qui le comble, et on rejoue la recette gagnante avec lui.
  //
  // Un tri statique par « somme des gains vitaux » est inopérant : sur une île où la sécurité
  // incendie est le goulot, Vulcain et Neptune valent des milliers d'habitants et les quatre
  // autres divinités exactement zéro.
  if (pick && instCands.some((i) => i.uniqueType === SHRINE_TYPE)) {
    const rank = cityStatusAttrs(pick.residents, tier?.region ?? islandRegion);
    const deficit: Record<string, number> = {};
    for (const k of VITAL_ATTRS) {
      deficit[k] = Math.max(0, -((pick.cand.attrsSum[k] ?? 0) + pick.cand.houses * (rank[k] ?? 0)));
    }
    // Aucun attribut en déficit : le plan tient déjà. On vise alors le plus serré — c'est
    // lui qui bornera la production locale et la cascade de main-d'œuvre.
    if (VITAL_ATTRS.every((k) => deficit[k] === 0)) {
      const w = worstAttr({ ...pick.attrsTotal });
      if (w) deficit[w.attr] = 1;
    }
    patron = pickPatron(instCands, deficit);
    if (patron) {
      // La passe est rejouée AU MÊME SEUIL que celle qui a servi à mesurer le déficit.
      // Tenté un temps de la fusionner avec le raffinage, pour économiser 1,15 s : le patron
      // était alors choisi sur un plan et appliqué à un autre, et le bilan de l'île finissait
      // à −1 en sécurité incendie. L'économie ne valait pas ça.
      const ev = runLattice(bestTrial, coverageFloor);
      cands.push(ev);
      if (better(ev, pick)) pick = ev;
      else patron = undefined; // l'autel ne paie pas son sol : on s'en passe
    }
  }

  // RAFFINAGE : la recette gagnante rejouée à un seuil de densification plus exigeant.
  // Mesuré +4,0 % (65 357 → 67 940 habitants) — le moteur pose une ou deux copies de plus
  // là où la couverture était juste, et récupère des maisons entières au palier cible.
  if (Math.abs(coverageFloor - REFINE_FLOOR) > 1e-6) {
    onProgress?.(trials.length + 1, total);
    const ev = runLattice(bestTrial, REFINE_FLOOR);
    cands.push(ev);
    if (!pick || better(ev, pick)) pick = ev;
  }
  // packPlan sur la meilleure recette : il ne gagne jamais sur un palier à eau (il pose ses
  // maisons avant de router), mais il reste pertinent sur les paliers qui n'en consomment
  // pas. Sur les très grandes îles il coûte un plan complet pour un résultat toujours
  // perdant (mesuré −0,7 % et −1,7 %) : on s'en passe.
  onProgress?.(trials.length + 2, total);
  if (landTiles <= 200_000) {
    const serviceIds = bestTrial;
    const packed = planPacked(planGrid, req.tierGuid, lookup, { coverageFloor, serviceIds, permits: req.permits });
    const ev = evaluate(packed, serviceIds ? new Set(serviceIds) : null);
    cands.push(ev);
    if (!pick || better(ev, pick)) pick = ev;
  }

  /**
   * ═══ LE PLAN COMPLET D'UN CANDIDAT ═══════════════════════════════════════════════════
   *
   * Tout ce qui suit — comptoir, exploitation des emplacements, production locale, règlement
   * de la main-d'œuvre, manifeste d'import — était appliqué au SEUL plan retenu par `better()`,
   * c'est-à-dire après la décision. On optimisait donc une approximation (un plan NU) puis on
   * en corrigeait les dégâts, et le correctif — le recul sur pose — ne peut que retrancher,
   * jamais rattraper un mauvais choix de départ.
   *
   * C'est ce décalage qui avait produit un bilan d'île à −1 : un plan retenu comme viable
   * finissait négatif une fois ses coûts réels appliqués.
   *
   * Le bloc devient donc une FONCTION, appliquée à chacun des finalistes ; c'est son résultat
   * livré — habitants réellement logés, bilan réellement tenu — qui tranche.
   */
  const finalize = (chosen: Evaluated): IslandPlanResult => {
    const relevant = chosen.relevant;
    const dist = chosen.cand;
    const water = chosen.water;
    const deadTypes = chosen.deadTypes;
    const attrsTotal: Record<string, number> = { ...chosen.attrsTotal };
    // capacité de référence d'une maison au palier cible SOUS LA RECETTE RETENUE : c'est ce
    // que le panneau affiche, et ce n'est plus `capacityDefault` — une recette maigre héberge
    // moins par maison mais bien plus de maisons.
    const cap = compileTierEvaluator(chain, { goodsMet: true, relevant: relevant ?? undefined })
      .reference(chain.length - 1).cap;

    // --- pose du comptoir + raccordement au réseau produit -----------------------------
    const buildings = [...chosen.buildings];
    const roads: RoadTile[] = [...dist.roads];
    const kontorGaps: string[] = [];
    let removedHouses = 0;
    const tierCounts: Record<string, number> = { ...chosen.tierCounts };
    const capByTier: Record<string, number> = { ...chosen.capByTier };
    const tierOfRes = new Map(chain.filter((t) => t.residenceId).map((t) => [t.residenceId!, t.guid]));
    /** Capacité RÉELLE de chaque parcelle, à son palier retenu. */
    const capOfPlot = new Map<string, number>();
    for (const pl of dist.plots ?? []) {
      capOfPlot.set(pl.uid, pl.opts.find((op) => op.guid === pl.guid)?.cap ?? 0);
    }

    /**
     * AGRÉGATS DÉRIVÉS des maisons encore debout — jamais décrémentés.
     *
     * Trois endroits rasaient des maisons (raccord du comptoir, emplacements, ateliers) et
     * retiraient de `capByTier` la capacité MOYENNE du palier, faute de connaître celle de la
     * maison réelle. Deux maisons du même palier n'hébergent pourtant pas autant — celle qui
     * voit un service de plus loge davantage. Le résultat dépendait donc de l'ORDRE des
     * retraits, et le `Math.max(0, …)` masquait la dérive au lieu de la signaler. Dernière
     * survivance du motif « accumulation de deltas sur un état qui bouge », corrigé partout
     * ailleurs — cf. `WorkforceLedger.settle()`, qui recalcule ces mêmes agrégats depuis les
     * parcelles survivantes et les écrase dès qu'il y a une conversion.
     *
     * Rend `false` quand le candidat ne publie pas ses parcelles : `packPlan` déclare le
     * champ mais ne le remplit jamais. L'appelant retombe alors sur la moyenne, faute de
     * mieux — et c'est aussi pourquoi la cascade de main-d'œuvre ne fait rien sur ses plans.
     */
    const recount = (): boolean => {
      if (!capOfPlot.size) return false;
      for (const k of Object.keys(tierCounts)) delete tierCounts[k];
      for (const k of Object.keys(capByTier)) delete capByTier[k];
      for (const b of buildings) {
        const g = tierOfRes.get(b.defId);
        if (!g) continue;
        tierCounts[g] = (tierCounts[g] ?? 0) + 1;
        capByTier[g] = (capByTier[g] ?? 0) + (capOfPlot.get(b.uid) ?? 0);
      }
      return true;
    };

    /**
     * Retire des maisons du plan et remet les compteurs d'aplomb. `extra` entre au même
     * moment : ce qui rase pose en général quelque chose à la place.
     */
    const razeHouses = (gone: ReadonlySet<string>, extra: PlacedBuilding[] = []) => {
      const fallback = !capOfPlot.size;
      for (const b of buildings) {
        if (!gone.has(b.uid)) continue;
        const g = tierOfRes.get(b.defId);
        if (!g) continue;
        removedHouses++;
        if (!fallback || !tierCounts[g]) continue;
        const avg = (capByTier[g] || 0) / tierCounts[g];
        tierCounts[g]--;
        capByTier[g] = Math.max(0, (capByTier[g] || 0) - avg);
      }
      const keep = buildings.filter((b) => !gone.has(b.uid));
      buildings.length = 0;
      buildings.push(...keep, ...extra);
      if (!fallback) recount();
    };
    if (kontor) {
      const kp = connectKontor(req.grid, kontor, buildings, roads, lookup, (id) => residenceIds.has(id));
      if (kp.connected) {
        // les maisons rasées par le stub sortent du décompte (et de leur palier)
        razeHouses(new Set(kp.removed), [kp.building]);
        const seen = new Set(roads.map((r) => `${r.x},${r.y}`));
        for (const r of kp.roads) if (!seen.has(`${r.x},${r.y}`)) { seen.add(`${r.x},${r.y}`); roads.push(r); }
      } else {
        kontorGaps.push("Comptoir non raccordable au réseau routier (île saturée ou littoral isolé)");
      }
    } else {
      kontorGaps.push("Aucun comptoir posable : pas de littoral exploitable → réseau routier sans racine");
    }

    // --- EXPLOITATION DES EMPLACEMENTS LIBRES (option) ---------------------------------
    // Appelée APRÈS le routage d'eau : les sources ont déjà pris les slots montagne dont
    // elles avaient besoin, ce module ne voit que le complément. Il pose aussi les entrepôts
    // sans lesquels la production ne sortirait pas.
    // ═══ GUICHET DE MAIN-D'ŒUVRE ═════════════════════════════════════════════════════════
    // Le grand-livre naît ICI, avant les exploitations, pour leur servir de guichet : rien
    // n'entre dans le plan sans qu'on ait vérifié que l'île saura l'armer, et en quelle
    // quantité. Le comptoir fournit une part gratuite — 25 unités du premier palier —, seule
    // main-d'œuvre qui ne vienne pas de la population.
    //
    // Les SERVICES, eux, sont posés par le moteur de placement et ne passent pas par ce
    // guichet : ils sont facturés en bloc, sans droit de refus. C'est la seule source de
    // déficit préexistant que le devis doive tolérer.
    const aliveUids = new Set(buildings.map((b) => b.uid));
    const grants = workforceGrant(kontorDef?.id);
    const ledger = new WorkforceLedger(
      (dist.plots ?? []).filter((p) => aliveUids.has(p.uid)), grants, islandRegion,
    );
    ledger.charge(buildings.filter((b) => !residenceIds.has(b.defId)).map((b) => b.defId));

    let exploited: ExploitedSlot[] = [];
    if (req.exploitSlots) {
      const sp = planSlots(
        req.grid, req.catalog, lookup, buildings, roads, water.usedSlots,
        (id) => residenceIds.has(id),
        { fertilities: req.islandFertilities, region: islandRegion, workforce: ledger },
      );
      if (sp.removed.length) razeHouses(new Set(sp.removed));
      buildings.push(...sp.buildings);
      const seenR = new Set(roads.map((r) => `${r.x},${r.y}`));
      for (const r of sp.roads) if (!seenR.has(`${r.x},${r.y}`)) { seenR.add(`${r.x},${r.y}`); roads.push(r); }
      exploited = sp.exploited;
      kontorGaps.push(...sp.gaps);
    }

    // --- EFFETS DE ZONE DES BÂTIMENTS POSÉS HORS MOTEUR ---------------------------------
    // Les exploitations d'emplacement (mines, carrières, ferme à bœufs) portent toutes un
    // malus de Santé −2 CUMULABLE dans un rayon EUCLIDIEN de 20 à 24. Elles sont posées après
    // les moteurs, donc leur effet échappait au bilan calculé par ceux-ci. On le rattrape ici,
    // sur les maisons réellement à portée.
    /**
     * Effet de zone EUCLIDIEN des bâtiments posés hors moteur — mines, carrières, ferme à
     * bœufs, ateliers. Les moteurs ne les voient pas : ils sont posés après.
     *
     * Paramétré par les maisons RASÉES, parce qu'il ne doit compter que celles encore debout.
     * Il était calculé une seule fois, sur toutes les maisons, puis versé dans un bilan qui,
     * lui, n'en compte qu'une partie : le malus des mines pesait donc sur des maisons que les
     * ateliers avaient démolies. Même forme que l'accumulation de deltas corrigée par ailleurs.
     */
    const zoneAttrsOf = (razed: ReadonlySet<string>, extra: PlacedBuilding[] = []) => {
      const out: Record<string, number> = {};
      const svcOfTiers = new Set(chain.flatMap((t) => t.services.map((s) => s.building)));
      const centre = (b: PlacedBuilding) => {
        const d = lookup(b.defId);
        const fp = d ? footprintSize(d, b.rotation) : { w: 1, h: 1 };
        return { x: b.x + fp.w / 2, y: b.y + fp.h / 2 };
      };
      const houseCentres = buildings
        .filter((b) => residenceIds.has(b.defId) && !razed.has(b.uid))
        .map(centre);
      const seenOnce = new Map<string, Set<number>>();
      for (const b of [...buildings, ...extra]) {
        const fx = effectOf(b.defId);
        if (!fx || fx.scope !== "radius" || svcOfTiers.has(b.defId)) continue;
        const c = centre(b);
        const r2 = fx.range * fx.range;
        for (let i = 0; i < houseCentres.length; i++) {
          const h = houseCentres[i];
          const dx = h.x - c.x, dy = h.y - c.y;
          if (dx * dx + dy * dy > r2) continue;
          if (!fx.stackable) {
            let set = seenOnce.get(b.defId);
            if (!set) seenOnce.set(b.defId, (set = new Set()));
            if (set.has(i)) continue;
            set.add(i);
          }
          for (const [k, v] of Object.entries(fx.attrs)) out[k] = (out[k] ?? 0) + v;
        }
      }
      return out;
    };

    // CONNEXITÉ : l'élagage des moteurs peut laisser des îlots de route (case d'accès dont le
    // connecteur a sauté). En jeu, un bâtiment desservi par une route coupée du comptoir est
    // INACTIF. On raccroche ce qui peut l'être et on signale le reste.
    const repair = repairRoadConnectivity(req.grid, buildings, roads, lookup);
    if (repair.orphans) {
      kontorGaps.push(`${repair.orphans} case(s) de route isolées du comptoir (bâtiments desservis inactifs en jeu)`);
    }

    const layout: Layout = { grid: req.grid, buildings, roads: repair.roads, fields: dist.fields, aqueducts: water.aqueducts };
    // couverture DISTANCE-RUE = la vraie mécanique du jeu. `requiredServices` scope le gate
    // "pleinement couverte" au sous-ensemble retenu (mode seuils), sinon tous les services.
    // `inactiveBuildings` = consommateurs d'eau NON raccordés (inactifs en jeu) → une maison
    // servie uniquement par une copie sèche n'est PAS comptée couverte (corrige l'optimisme
    // du raccordement partiel : le gate eau par-def ne voyait que le cas 0-raccordé).
    const inactiveWater = new Set(water.consumers.filter((c) => !c.connected).map((c) => c.uid));
    const coverage = analyzeCoverage(layout, lookup, {
      ...(relevant ? { requiredServices: relevant } : {}),
      inactiveBuildings: inactiveWater,
    });
    const analyzable = coverage.services.filter((s) => s.hasRadius && (!relevant || relevant.has(s.serviceId)));
    const coverageMin = analyzable.length ? Math.min(...analyzable.map((s) => s.pct)) : 100;
    let houses = dist.houses - removedHouses;
    let fullyCovered = tierCounts[req.tierGuid] || 0; // maisons ayant atteint le palier cible
    let fullyCoveredPct = houses ? Math.round((fullyCovered / houses) * 100) : 0;
    // Habitants = Σ des capacités RÉELLES, maison par maison (Σ Population des besoins
    // remplis). Deux maisons du même palier n'ont pas la même capacité : celle qui voit un
    // service de plus héberge davantage. C'est ce gradient qui guide l'optimisation.
    let residents = Math.round(Object.values(capByTier).reduce((a, b) => a + b, 0));

    // Manifeste d'import : vecteur de population MULTI-PALIERS. La capacité passée à `solve`
    // est la MOYENNE OBSERVÉE par palier (capacité cumulée / nb de maisons), pas la capacité
    // théorique tous-besoins-remplis : sinon `solve` déduirait un nombre de maisons faux et
    // la demande de biens avec (elle est proportionnelle aux MAISONS, pas aux habitants).
    const capacities: Record<string, number> = {};
    for (const t of chain) {
      const n = tierCounts[t.guid] || 0;
      capacities[t.guid] = n > 0 ? Math.max(1, (capByTier[t.guid] || 0) / n) : (t.capacityDefault || 10);
    }
    const popTargets = chain
      .map((t) => ({ tier: t.guid, pop: (tierCounts[t.guid] || 0) * capacities[t.guid] }))
      .filter((p) => p.pop > 0);
    // needSelection: "all" — la DEMANDE DE BIENS est toujours complète : sur une île d'import
    // tous les biens sont acheminés (c'est l'hypothèse `goodsMet` du modèle de besoins). Ce
    // que la recette restreint, ce sont les SERVICES, qui ne consomment rien.
    const sol = solve(
      popTargets.length ? popTargets : [{ tier: req.tierGuid, pop: 0 }],
      { includeProduction: false, includeServices: true, includeWorkforce: false, optimizeNeeds: false, needSelection: "all", capacities },
    );
    const importGoods: ImportGood[] = Object.entries(sol.goodsPerMin)
      .filter(([, v]) => v > 0)
      .map(([good, perMin]) => ({ good, name: goodName(good), perMin: Math.round(perMin * 100) / 100 }))
      .sort((a, b) => b.perMin - a.perMin);

    // --- PRODUCTION FINALE SUR L'ÎLE (option) -------------------------------------------
    // Le bilan d'attributs est un BUDGET : le surplus de Santé et d'Argent achète des ateliers
    // qui retirent leur bien du manifeste d'import. On s'arrête au premier qui ferait passer
    // un attribut vital sous zéro.
    let workshops: LocalWorkshop[] = [];
    // Charge de base du grand-livre : tout ce qui est posé hors résidences. Invariante d'un
    // essai à l'autre — le recul ne fait varier que les ateliers.
    const baseCharge = buildings.filter((b) => !residenceIds.has(b.defId)).map((b) => b.defId);

    /**
     * BILAN DE L'ÎLE pour un sous-ensemble d'ateliers, évalué POUR DE BON.
     *
     * C'est l'unique façon dont le bilan est calculé. Il l'était auparavant par accumulation de
     * deltas successifs — effets de zone, puis règlement de la main-d'œuvre, puis variation du
     * rang de cité — sur un état qui bougeait encore entre chaque terme, et l'un d'eux était
     * compté en trop : le bilan finissait à −1 en sécurité incendie sur roman_island_medium_01.
     * Un calcul d'un seul tenant, à partir d'un seul règlement, n'a pas ce défaut.
     *
     * Défaire une pose se réduit alors à reconstruire le grand-livre sans elle.
     */
    const settleWith = (kept: LocalWorkshop[]) => {
      const razed = new Set(kept.flatMap((w) => w.razed));
      const l = new WorkforceLedger(
        (dist.plots ?? []).filter((p) => aliveUids.has(p.uid) && !razed.has(p.uid)),
        grants,
        islandRegion,
      );
      l.charge(baseCharge);
      l.charge(kept.flatMap((w) => w.placed.map((b) => b.defId)));
      const wfk = l.settle();
      const rank = cityStatusAttrs(wfk.residents, tier?.region ?? islandRegion);
      // Les effets de zone sont RECALCULÉS sur les maisons que ce sous-ensemble laisse debout,
      // ateliers gardés compris. Réutiliser l'instantané figé à la pose (`w.attrs`) aurait
      // reconduit le défaut : il compte les maisons vivantes AU MOMENT de la pose, et le recul
      // en ressuscite.
      const zone = zoneAttrsOf(razed, kept.flatMap((w) => w.placed));
      const attrs: Record<string, number> = {};
      for (const k of VITAL_ATTRS) {
        attrs[k] = (wfk.attrsSum[k] ?? 0)       // maisons debout, affectation finale
          + (zone[k] ?? 0)                      // mines, carrières, ateliers — portée euclidienne
          + wfk.houses * (rank[k] ?? 0);        // rang de cité
      }
      return { wf: wfk, attrs };
    };

    let droppedCopies = 0;
    let kept: LocalWorkshop[] = [];
    let trial: ReturnType<typeof settleWith> | null = null;
    if (req.localProduction) {
      const lp = planLocalProduction(
        req.grid, lookup, buildings, roads, residenceIds,
        importGoods.map((g) => ({ good: g.good, perMin: g.perMin })),
        attrsTotal,
        { region: islandRegion, workforce: ledger },
      );
      // ═══ RECUL SUR POSE ═══════════════════════════════════════════════════════════════
      // Le garde-fou de `planLocalProduction` compare un devis PRÉDICTIF à son budget, et ce
      // devis ne peut pas être exact : il chiffre l'effet de zone et les conversions tels qu'il
      // les voit au moment de la pose, alors que la facture réelle n'est connue qu'au règlement
      // de la main-d'œuvre. On cesse donc de lui faire confiance : les ateliers sont posés comme
      // avant, puis on RETIRE les derniers tant que le bilan est négatif, en réévaluant à chaque
      // recul. L'ordre de retrait est celui de la pose — les biens sont proposés par débit
      // décroissant, donc le dernier posé est le moins rentable.
      kept = [...lp.workshops];
      // Le dernier essai est CONSERVÉ : c'est celui du sous-ensemble accepté, et le recalculer
      // plus bas serait un règlement complet jeté pour rien.
      trial = settleWith(kept);
      while (kept.length && !isViable(trial.attrs)) {
        droppedCopies += kept.pop()!.copies;
        trial = settleWith(kept);
      }
      lp.buildings = kept.flatMap((w) => w.placed);
      lp.removed = kept.flatMap((w) => w.razed);
      lp.workshops = kept;
      lp.netPerMin = netOf(kept);

      if (lp.buildings.length) {
        razeHouses(new Set(lp.removed), lp.buildings);
        workshops = lp.workshops;
        // les maisons rasées sortent des compteurs. Le manifeste, lui, a été calculé AVANT
        // la démolition : il surestime donc légèrement la demande, ce qui est conservateur —
        // le recalculer imposerait une seconde passe du solveur pour un écart de l'ordre du %.
        houses = dist.houses - removedHouses;
        residents = Math.round(Object.values(capByTier).reduce((a, b) => a + b, 0));
        fullyCovered = tierCounts[req.tierGuid] || 0;
        fullyCoveredPct = houses ? Math.round((fullyCovered / houses) * 100) : 0;
        // MANIFESTE : un atelier ne fait pas disparaître un besoin, il le DÉPLACE en amont.
        // Produire des tuniques sur place, c'est cesser d'importer des tuniques et commencer
        // à importer de la laine — sauf si la remontée de chaîne a aussi posé le producteur
        // de laine, auquel cas le bilan se compense de lui-même. `netPerMin` porte les deux
        // sens : positif = produit ici, négatif = à acheminer en plus.
        for (const [good, net] of Object.entries(lp.netPerMin)) {
          if (Math.abs(net) < 1e-6) continue;
          let g = importGoods.find((x) => x.good === good);
          if (!g) {
            if (net >= 0) continue; // rien à retrancher d'un bien qu'on n'importait pas
            g = { good, name: goodName(good), perMin: 0 };
            importGoods.push(g);
          }
          g.perMin = Math.max(0, Math.round((g.perMin - net) * 100) / 100);
        }
        // un bien entièrement produit sur place sort du manifeste
        const still = importGoods.filter((g) => g.perMin > 0);
        importGoods.length = 0;
        importGoods.push(...still.sort((a, b) => b.perMin - a.perMin));
      }
      kontorGaps.push(...lp.gaps);
      if (droppedCopies) {
        kontorGaps.push(`${droppedCopies} atelier(s) retiré(s) : le bilan de l'île ne les portait pas`);
      }
    }

    // ═══ RÈGLEMENT DE LA MAIN-D'ŒUVRE ════════════════════════════════════════════════════
    // Les conversions décidées par le grand-livre sont appliquées aux résidences posées : un
    // simple changement de `defId`, les neuf résidences du jeu faisant toutes 3×3. Rien ne
    // bouge, ni routes, ni couverture, ni réseau d'eau.
    //
    // On recalcule ensuite le rang de cité, puisque la population a baissé — c'est la seule
    // rétroaction du système, et elle joue en notre faveur : moins d'habitants, malus plus
    // doux. Le nombre de maisons, lui, est invariant.
    // Le règlement retenu est celui du sous-ensemble d'ateliers gardé — le même appel que
    // celui qui a servi à trancher, et le SEUL qui alimente le bilan. Sans production locale,
    // `kept` est vide : c'est exactement le même chemin.
    const final = trial ?? settleWith(kept);
    const wf = final.wf;
    for (const k of VITAL_ATTRS) attrsTotal[k] = final.attrs[k] ?? 0;
    if (wf.changed.size) {
      for (const b of buildings) {
        const to = wf.changed.get(b.uid);
        if (to) b.defId = to;
      }
      for (const k of Object.keys(tierCounts)) delete tierCounts[k];
      Object.assign(tierCounts, wf.tierCounts);
      for (const k of Object.keys(capByTier)) delete capByTier[k];
      Object.assign(capByTier, wf.capByTier);
      houses = wf.houses;
      residents = wf.residents;
      fullyCovered = tierCounts[req.tierGuid] || 0;
      fullyCoveredPct = houses ? Math.round((fullyCovered / houses) * 100) : 0;
    }

    // bonus d'attributs cumulés (par tier atteint × maisons de ce tier)
    const attributes: Record<string, number> = {};
    for (const t of chain) {
      const n = tierCounts[t.guid] || 0;
      if (!n) continue;
      for (const [k, v] of Object.entries(t.perHouse || {})) attributes[k] = (attributes[k] || 0) + Math.round(v * n);
    }

    // ARGENT : la taxe (`gross`) vient du solveur, par tier réellement atteint. L'ENTRETIEN
    // est calculé sur les bâtiments RÉELLEMENT POSÉS — auparavant il venait aussi de solve(),
    // qui estime le nombre de services avec la constante DEFAULT_HOUSES_PER_SERVICE = 30
    // (« un service couvre 30 maisons »), alors que le plan spatial connaît le compte exact.
    const upkeep = Math.round(buildings.reduce((s, b) => s + upkeepOf(b.defId), 0));
    const money = { gross: sol.money.gross, upkeep, net: sol.money.gross - upkeep };

    // TROUS. Ordre délibéré : d'abord ce qui BLOQUE (l'UI n'affiche que les premiers),
    // ensuite les trous de couverture qui ne sont que du best-effort.
    const gaps: string[] = [...kontorGaps];
    for (const id of deadTypes) {
      const d = lookup(id);
      gaps.push(`${d?.name ?? id} sans eau (aucun raccordé) → maisons plafonnées au palier inférieur`);
    }
    gaps.push(...water.gaps);
    for (const s of tier.services) {
      if (relevant && s.building && !relevant.has(s.building)) continue; // écarté volontairement
      if (!s.building) gaps.push("Service sans bâtiment au catalogue (non plaçable)");
      else {
        const def = lookup(s.building);
        if (!def) gaps.push(`Service ${s.building} absent du catalogue`);
        else if (!(def.streetRange || def.radius?.range)) gaps.push(`${def.name} : rayon inconnu (non couvrable)`);
      }
    }
    if (removedHouses) gaps.push(`${removedHouses} maison(s) rasée(s) pour raccorder le comptoir`);
    // MAIN-D'ŒUVRE. Un déficit n'est jamais silencieux : en jeu, les bâtiments concernés
    // tournent au ralenti. Une demande « hors monde » est pire — aucune maison de l'île ne
    // peut la satisfaire, quel que soit le nombre de conversions.
    for (const [guid, miss] of Object.entries(wf.alien)) {
      const t = tierByGuid(guid);
      gaps.push(`${miss.toFixed(0)} main-d'œuvre ${t?.name ?? guid} demandée, palier absent de ce monde`);
    }
    for (const [guid, miss] of Object.entries(wf.deficit)) {
      const t = tierByGuid(guid);
      gaps.push(`Main-d'œuvre ${t?.name ?? guid} : ${miss.toFixed(0)} manquante(s) — production au ralenti`);
    }
    for (const c of wf.conversions) {
      const a = tierByGuid(c.from)?.name ?? c.from, b = tierByGuid(c.to)?.name ?? c.to;
      gaps.push(`${c.houses} maison(s) ${a} → ${b} pour la main-d'œuvre (−${c.popLost} habitants)`);
    }
    {
      const w = worstAttr(attrsTotal);
      if (w) {
        const label: Record<string, string> = {
          Happiness: "Bonheur", Money: "Argent", Health: "Santé", FireSafety: "Sécurité incendie",
        };
        gaps.push(`${label[w.attr] ?? w.attr} négatif sur l'île (${w.value.toFixed(0)}) — émeutes/incendies/maladies en jeu`);
      }
    }
    for (const s of analyzable) {
      if (s.pct < 100) gaps.push(`${s.name} : ${s.pct}% des maisons couvertes (distance-rue)`);
    }

    const planViable = isViable(attrsTotal);
    const hasWaterConsumers = water.consumers.length > 0;
    return {
      mode: "import",
      tierGuid: req.tierGuid,
      tierName: tier.name,
      cap,
      houses,
      fullyCovered,
      fullyCoveredPct,
      residents,
      buildings: layout.buildings,
      roads: layout.roads,
      fields: layout.fields,
      aqueducts: water.aqueducts,
      water: hasWaterConsumers
        ? { sources: water.sources.length, capacity: water.capacity, used: water.used, consumers: water.consumers }
        : null,
      importGoods,
      exploited,
      workshops,
      attrsTotal,
      workforce: {
        offer: wf.offer, demand: wf.demand, deficit: wf.deficit, alien: wf.alien,
        conversions: wf.conversions,
      },
      viable: planViable,
      tierCounts,
      coverage,
      coverageMin,
      money,
      attributes,
      gaps: [...new Set(gaps)],
      // FAISABLE = le plan tient debout en jeu : des maisons, des habitants, et un réseau
      // d'eau qui n'est pas mort. Le critère précédent (`fullyCoveredPct ≥ curseur`) déclarait
      // « best-effort » les MEILLEURS plans mesurés : une recette maigre loge bien plus de
      // monde tout en laissant une part plus grande de maisons sous le palier cible. Le
      // curseur reste un objectif affiché, pas un verdict.
      feasible: houses > 0 && residents > 0 && chosen.waterPct >= WATER_VIABLE,
    };
  };

  // ═══ ARBITRAGE SUR LE RÉSULTAT LIVRÉ ═════════════════════════════════════════════════
  // Présélection par `better()` (plans nus), puis pipeline complet sur les finalistes, puis
  // décision sur ce qui sort. Le tri se fait par extraction du maximum plutôt que par `sort` :
  // `better()` n'est pas transitif — sa bande d'égalité à 2 % sur la population l'en empêche —
  // et un tri sur un comparateur non transitif rend un ordre arbitraire.
  const shortlist: Evaluated[] = [];
  const seen = new Set<string>();
  const pool = [...cands];
  while (shortlist.length < FINALISTS && pool.length) {
    let bi = 0;
    for (let i = 1; i < pool.length; i++) if (better(pool[i], pool[bi])) bi = i;
    const c = pool.splice(bi, 1)[0];
    // Un doublon géométrique rendrait le même plan final : on ne lui donne pas un rang.
    if (seen.has(c.sig)) continue;
    seen.add(c.sig);
    shortlist.push(c);
  }
  if (!shortlist.length) shortlist.push(pick!);

  // Le verdict porte sur le plan LIVRÉ : jouable d'abord, bilan d'île tenu ensuite, puis
  // habitants. Pas de bande d'égalité ici — ce ne sont plus des estimations.
  const betterFinal = (a: IslandPlanResult, b: IslandPlanResult): boolean => {
    if (a.feasible !== b.feasible) return a.feasible;
    if (a.viable !== b.viable) return a.viable;
    if (a.residents !== b.residents) return a.residents > b.residents;
    return a.money.net > b.money.net;
  };
  let out: IslandPlanResult | null = null;
  for (let i = 0; i < shortlist.length; i++) {
    onProgress?.(trials.length + 2 + i + 1, total);
    const r = finalize(shortlist[i]);
    if (!out || betterFinal(r, out)) out = r;
  }
  return out!;
}
