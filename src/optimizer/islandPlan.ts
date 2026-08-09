import { makeLookup, roadConnected, rootedRoadSet } from "../engine/rules";
import type { AqueductTile, BuildingDef, FieldTile, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import { economy, residentialChainExtended, upkeepOf } from "../economy/economy";
import { buildTierProfile, solve } from "../economy/solve";
import { compileTierEvaluator } from "../economy/needsModel";
import { cityStatusAttrs, tierByGuid } from "../economy/economy";
import { institutionDefs, pickPatron, SHRINE_TYPE, VITAL_ATTRS, worstAttr } from "../economy/attributes";
import { effectOf } from "../economy/economy";
import { footprintSize } from "../engine/geometry";
import { candidateRecipes } from "./recipes";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";
import { planLattice, type LatticeResult } from "./planLattice";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";
import { blockMountains, needsWater, planWater, type WaterConsumerReport, type WaterPlanResult } from "./waterPlan";
import { connectKontor, keepMainLandmass, pickKontorDef, repairRoadConnectivity, reserveKontor } from "./kontor";
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
   * DÉFICIT VITAL TOLÉRÉ PAR MAISON. 0 (défaut) = le veto binaire historique.
   *
   * Le garde-fou rase jusqu'à ce que chaque attribut vital de l'île repasse à zéro. Sur une
   * grande île ce veto est un plafond de POPULATION, pas de surface : une maison patricienne
   * plafonne à +7 de sécurité incendie tandis que le malus de rang atteint −7 dès 30 000
   * habitants. Au-delà, aucune maison ne peut avoir un bilan incendie positif — l'échelle de
   * rang compte pourtant quarante paliers jusqu'à 260 000 habitants, dont vingt-cinq
   * inatteignables. Le modèle contredit sa propre table.
   *
   * La tolérance laisse le joueur arbitrer ce risque plutôt que de le décider pour lui.
   */
  tolerance?: number;
  /**
   * LISTE DE VŒUX DE PRODUCTION — ce que l'utilisateur veut voir sur l'île.
   *
   * `workshops` amorce la file de `planLocalProduction`, en unités de BÂTIMENT et non de bien,
   * DANS L'ORDRE DONNÉ : c'est cet ordre que le moteur suit quand le budget se ferme. La file
   * épuisée, il enchaîne sur son choix automatique avec ce qui reste, intrants compris.
   *
   * `slots` exprime une préférence PAR TYPE d'emplacement, pas par emplacement nommé. Elle ne
   * peut que restreindre : hors région, gisement absent ou main-d'œuvre hors de portée restent
   * écartés, et la préférence est alors ignorée puis signalée.
   *
   * ⚠ Une demande servie AVANT le manifeste déplace le plan : les ateliers que le moteur
   * aurait choisis seuls ne seront peut-être plus finançables, et le plan livré peut LOGER
   * MOINS DE MONDE qu'avec l'option décochée. C'est l'arbitrage demandé, pas une régression —
   * mais il doit être affiché comme tel.
   */
  wanted?: {
    workshops?: { defId: string; count: number }[];
    slots?: Record<string, string>;
  };
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
  // LA TOLÉRANCE DOIT VALOIR POUR LE VERDICT AUSSI, PAS SEULEMENT POUR LA SÉLECTION.
  //
  // `viableSubset` garde les maisons tant que le déficit par maison reste sous la tolérance.
  // Juger ensuite le plan avec un `isViable` strict le déclarait non viable alors qu'il
  // respectait exactement la contrainte demandée — et `better()`, qui départage d'abord sur
  // `viable`, aurait préféré un plan bridé à un plan conforme à l'option.
  const tol = Math.max(0, req.tolerance ?? 0);
  const viableAvecTolerance = (attrs: Record<string, number>, houses: number): boolean =>
    VITAL_ATTRS.every((k) => (attrs[k] ?? 0) + tol * houses >= 0);
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
  let instCands = institutionDefs(islandRegion)
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
  // Un seul tenant : bâtir sur un lobe que la route ne peut pas atteindre depuis le comptoir
  // produit des bâtiments INACTIFS en jeu, et des maisons comptées comme desservies par des
  // services qui ne tournent pas. Voir `keepMainLandmass` pour la mesure.
  const planGrid = blockMountains(keepMainLandmass(kontor?.grid ?? req.grid, kontor ?? undefined));
  // Emprise du comptoir, à protéger AUSSI du réseau d'eau : les sources d'aqueduc se posent
  // sur des cases hors masque de terre, que la réservation ne couvre donc pas.
  const kontorRect = kontor
    ? { x: kontor.x, y: kontor.y, ...footprintSize(kontor.def, kontor.rotation) }
    : undefined;
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
  // Un seul moteur au portefeuille depuis que packPlan en est sorti (cf. plus bas) ; l'alias
  // reste, il documente l'intention d'en accueillir plusieurs.
  type Cand = LatticeResult;
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
    const water = cand.water
      ?? planWater(req.grid, cand.buildings, cand.roads, lookup, req.heights, kontorRect);
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
    // Les consommateurs RETIRÉS faute de raccordement comptent encore au dénominateur : le
    // réseau se juge sur ce qu'il fallait alimenter, pas sur ce qui a survécu au ménage.
    const nCons = water.consumers.length + (water.dropped ?? 0);
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
      residents,
      waterPct: nCons ? nOk / nCons : 1,
      attrsTotal,
      viable: viableAvecTolerance(attrsTotal, cand.houses),
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
    // Un départage par la richesse du VIVIER de main-d'œuvre a existé ici. Il ne sert plus à
    // rien depuis que `finalize` tranche sur le plan LIVRÉ : mesuré sur quatre îles avec
    // exploitations et production locale, le résultat est identique au bâtiment près avec ou
    // sans lui — et il coûtait un `hostableTiers` par candidat.
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
  const runLattice = (serviceIds: string[] | undefined, floor: number, g: GridShape = planGrid): Evaluated =>
    evaluate(
      planLattice(g, req.tierGuid, lookup, {
        coverageFloor: floor, serviceIds, water: true, heights: req.heights,
        institutions: patron ? [...institutions, patron] : institutions,
        permits: req.permits, reserved: kontorRect, tolerance: req.tolerance,
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
  // UN SEUL DIEU, MAIS UN DIEU QUAND MÊME.
  //
  // Depuis que le besoin « Sanctuaire » se résout vers un vrai sanctuaire de divinité, le
  // palier en désigne déjà un. Élire librement un patron mettrait DEUX dieux sur la même île,
  // ce que le jeu interdit. Mais SUPPRIMER l'élection ne marche pas non plus : mesuré sur
  // `celtic_island_large_07`, le palier déclare le besoin sans que le glouton ne pose jamais
  // la copie, l'île se retrouvait alors sans aucun sanctuaire et perdait 2,5 % (4 867 → 4 745).
  //
  // On CONTRAINT donc l'élection au dieu DÉJÀ POSÉ au lieu de l'annuler : `pickPatron` garde
  // son rôle — décider s'il vaut la peine de rejouer la passe avec des sanctuaires en plus —
  // mais n'a plus qu'un seul choix possible dès qu'un dieu occupe le terrain.
  //
  // Le critère est bien le dieu POSÉ, pas celui que le palier DÉCLARE. Sur celtic le palier
  // déclare le besoin sans que le glouton ne pose jamais la copie : se fier à la déclaration
  // verrouillait l'élection sur un dieu absent du plan, et l'île finissait sans aucun
  // sanctuaire. Tant qu'aucun n'est posé, le choix reste entier — c'est le joueur qui tranche.
  const tierGod = pick?.buildings
    .find((b) => lookup(b.defId)?.uniqueType === SHRINE_TYPE)?.defId;
  if (tierGod) {
    instCands = instCands.filter((i) => i.uniqueType !== SHRINE_TYPE || i.defId === tierGod);
  }
  if (pick && instCands.some((i) => i.uniqueType === SHRINE_TYPE)) {
    const rank = cityStatusAttrs(pick.residents, tier?.region ?? islandRegion);
    const deficit: Record<string, number> = {};
    for (const k of VITAL_ATTRS) {
      deficit[k] = Math.max(0, -((pick.cand.attrsSum[k] ?? 0) + pick.cand.houses * (rank[k] ?? 0)));
    }
    // ═══ LE DÉFICIT EST TOUJOURS NUL ICI, ET C'EST LE POINT ═══════════════════════════
    //
    // `pick` sort de `viableSubset`, qui a DÉJÀ rasé jusqu'au retour à zéro : aucun attribut
    // vital n'y est négatif, donc la boucle ci-dessus rend systématiquement 0 partout. Le
    // repli était censé viser « le plus serré », mais il passait par `worstAttr`, qui ne
    // retourne que sur une valeur STRICTEMENT NÉGATIVE — donc `null`, donc un déficit nul.
    //
    // `pickPatron` retombait alors sur son départage par défaut : somme des gains vitaux, puis
    // identifiant. Le dieu était élu par ordre alphabétique, ce que `GAME_MECHANICS.md §9`
    // interdit explicitement.
    //
    // Le bon critère est la marge PAR MAISON, pas le total : sur la carte continentale du DLC
    // l'incendie tient à +0,05 par maison quand le Bonheur est à +2,31 et l'Argent à +58. Ces
    // trois nombres disent la même chose que le total ne dit pas — c'est l'incendie qui borne
    // la croissance, et c'est donc Vulcain qu'il faut élire.
    if (VITAL_ATTRS.every((k) => deficit[k] === 0)) {
      const n = Math.max(1, pick.cand.houses);
      let serre: string | null = null, marge = Infinity;
      for (const k of VITAL_ATTRS) {
        const m = (pick.attrsTotal[k] ?? 0) / n;
        if (m < marge) { marge = m; serre = k; }
      }
      if (serre) deficit[serre] = 1;
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
  onProgress?.(trials.length + 2, total);
  // ═══ packPlan N'EST PLUS DU PORTEFEUILLE ═════════════════════════════════════════════
  //
  // Le moteur houses-first reste maintenu et testé (`packPlan.ts`), mais il ne concourt plus.
  //
  // Il partait avec deux handicaps qui rendaient toute comparaison absurde : il ne posait
  // aucune INSTITUTION, et il n'appliquait aucun GARDE-FOU DE VIABILITÉ. Il annonçait donc
  // 21 414 habitants là où les plans lattice en annonçaient 4 980 sur la même île, et se
  // faisait éliminer par `better()` au tout premier critère — un plan au bilan négatif perd
  // contre n'importe quel plan viable. Les deux manques ont été corrigés.
  //
  // À armes égales, il perd partout. Mesuré sur neuf configurations : jamais dans les trois
  // finalistes sur cinq îles au palier haut, et dernier du vivier sur les quatre essais aux
  // paliers bas — ceux-là mêmes où son houses-first était censé payer (2 418 contre 2 947 ;
  // 4 896 contre 4 980 ; 6 409 contre 7 086 ; 10 158 contre 13 919).
  //
  // Il coûtait 703 ms sur roman_island_medium_01 et 1 321 ms sur celtic_island_large_07, soit
  // 7,4 % et 8,8 % du temps de CHAQUE plan, pour un candidat qui n'a jamais été retenu.
  // Le remettre au portefeuille tient en une ligne, et le raisonnement ci-dessus dit à quoi
  // il faudrait s'attendre.

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
  const finalize = (chosen: Evaluated, preferred?: { x: number; y: number }[]): IslandPlanResult => {
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
        // ÉCHEC DU RACCORDEMENT — on pose le comptoir QUAND MÊME.
        //
        // Il était purement abandonné, et le plan partait alors SANS AUCUN BÂTIMENT RACINE :
        // en jeu, un réseau routier sans comptoir laisse la ville entière inactive. Le
        // signalement se noyait dans les trous, à égalité avec « 3 % des maisons non
        // couvertes ». Mesuré par l'invariant `comptoir-present` : trois îles sur cinquante-
        // cinq livraient un plan entièrement injouable.
        //
        // Un comptoir dont la route est à tracer à la main vaut infiniment mieux que pas de
        // comptoir : son emprise est réservée depuis le début, elle est libre, et le joueur
        // n'a qu'un bout de route à poser.
        buildings.push(kp.building);
        kontorGaps.push(
          "Comptoir posé mais NON RACCORDÉ au réseau routier — à relier à la main,"
          + " sinon toute l'île reste inactive en jeu",
        );
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
        {
          fertilities: req.islandFertilities, region: islandRegion, workforce: ledger,
          slotPrefs: req.wanted?.slots,
        },
      );
      if (sp.removed.length) razeHouses(new Set(sp.removed));
      buildings.push(...sp.buildings);
      const seenR = new Set(roads.map((r) => `${r.x},${r.y}`));
      for (const r of sp.roads) if (!seenR.has(`${r.x},${r.y}`)) { seenR.add(`${r.x},${r.y}`); roads.push(r); }
      exploited = sp.exploited;
      kontorGaps.push(...sp.gaps);
      // PRÉFÉRENCE D'EMPLACEMENT IGNORÉE : le bâtiment demandé n'a été retenu sur aucun slot
      // de ce type — autre monde, gisement absent, ou main-d'œuvre hors de portée. On le dit,
      // plutôt que de laisser croire que le vœu a été suivi.
      for (const [slotType, defId] of Object.entries(req.wanted?.slots ?? {})) {
        const used = exploited.some((e) => e.slotType === slotType && e.defId === defId);
        const anySlot = exploited.some((e) => e.slotType === slotType);
        if (anySlot && !used) {
          kontorGaps.push(
            `${lookup(defId)?.name ?? defId} : préférence non retenue sur les emplacements `
            + `${slotType} (monde, gisement ou main-d'œuvre)`,
          );
        }
      }
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
    const repair = repairRoadConnectivity(
      req.grid, buildings, roads, lookup, 24, (id) => residenceIds.has(id),
    );
    // Une RÉSIDENCE isolée du comptoir est inactive en jeu : elle n'héberge personne. La
    // laisser au plan gonflait la population annoncée de maisons mortes. Elle tombe donc,
    // au même titre que celles rasées pour rouvrir un passage. Les SERVICES isolés, eux,
    // restent — les retirer changerait la couverture déjà calculée — mais sont signalés.
    const deadUids = new Set([
      ...repair.removed,
      ...repair.stranded.filter((b) => residenceIds.has(b.defId)).map((b) => b.uid),
    ]);
    if (deadUids.size) razeHouses(deadUids);

    // ═══ AUCUNE RÉSIDENCE COMPTÉE SANS ACCÈS RÉEL ════════════════════════════════════════
    //
    // `repairRoadConnectivity` ne voit que les ÎLOTS de route : une maison qui, après
    // l'élagage, ne touche plus aucune route lui est invisible. Elle restait donc au plan et
    // dans la population, alors qu'en jeu elle n'héberge personne — le réseau enraciné au
    // comptoir ne l'atteint pas.
    //
    // On tranche ici sur le critère du jeu lui-même (`rootedRoadSet` + `roadConnected`), le
    // même que l'invariant `acces-comptoir-maisons`. Une passe, après toutes les démolitions.
    {
      const lay: Layout = { grid: req.grid, buildings, roads: repair.roads, fields: dist.fields };
      const { set: rootSet, hasRoot } = rootedRoadSet(lay, lookup);
      if (hasRoot) {
        const cut = new Set(buildings
          .filter((b) => residenceIds.has(b.defId) && !roadConnected(lay, lookup, b, rootSet))
          .map((b) => b.uid));
        if (cut.size) {
          razeHouses(cut);
          kontorGaps.push(`${cut.size} maison(s) sans accès au comptoir, retirée(s) du plan`);
        }
      }
    }
    const strandedSvc = repair.stranded.filter((b) => !residenceIds.has(b.defId));
    if (strandedSvc.length) {
      // Le message comptait des CASES DE ROUTE. L'utilisateur n'en fait rien : ce qui l'intéresse
      // est quels BÂTIMENTS sont inactifs en jeu, et combien.
      const byName = new Map<string, number>();
      for (const b of strandedSvc) {
        const n = lookup(b.defId)?.name ?? b.defId;
        byName.set(n, (byName.get(n) ?? 0) + 1);
      }
      const detail = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
      kontorGaps.push(
        `${strandedSvc.length} service(s) sans accès au comptoir — INACTIFS en jeu : ${detail}`
        + (byName.size > 4 ? "…" : ""),
      );
    }

    const layout: Layout = { grid: req.grid, buildings, roads: repair.roads, fields: dist.fields, aqueducts: water.aqueducts };
    // couverture DISTANCE-RUE = la vraie mécanique du jeu. `requiredServices` scope le gate
    // "pleinement couverte" au sous-ensemble retenu (mode seuils), sinon tous les services.
    // `inactiveBuildings` = consommateurs d'eau NON raccordés (inactifs en jeu) → une maison
    // servie uniquement par une copie sèche n'est PAS comptée couverte (corrige l'optimisme
    // du raccordement partiel : le gate eau par-def ne voyait que le cas 0-raccordé).
    // Un service SANS ACCÈS AU COMPTOIR est tout aussi mort qu'un service sec : les maisons
    // qu'il couvre ne le sont pas en jeu. Il rejoint donc la même liste — sans quoi la
    // couverture affichée créditait des maisons d'un service qui ne tourne pas.
    const inactive = new Set([
      ...water.consumers.filter((c) => !c.connected).map((c) => c.uid),
      ...strandedSvc.map((b) => b.uid),
    ]);
    const coverage = analyzeCoverage(layout, lookup, {
      ...(relevant ? { requiredServices: relevant } : {}),
      inactiveBuildings: inactive,
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
      // L'ensemble des maisons debout est DÉRIVÉ du plan courant, pas d'un instantané pris
      // plus haut : le raccordement du comptoir, les emplacements et la réouverture des
      // routes en ont déjà retiré depuis. Un instantané figé les aurait fait vivre encore.
      const alive = new Set(buildings.map((b) => b.uid));
      const l = new WorkforceLedger(
        (dist.plots ?? []).filter((p) => alive.has(p.uid) && !razed.has(p.uid)),
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
        { region: islandRegion, workforce: ledger, preferred, requested: req.wanted?.workshops },
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
      // Le recul se juge avec la MÊME tolérance que le garde-fou, sans quoi les deux se
      // contredisent : mesuré à tolérance 3 sur la carte continentale, ce test resté strict
      // retirait des ateliers jusqu'à faire tomber le plan de 86 052 à 6 664 habitants — il
      // défaisait ce que la tolérance venait d'autoriser.
      const nMaisons = buildings.filter((b) => residenceIds.has(b.defId)).length;
      while (kept.length && !viableAvecTolerance(trial.attrs, nMaisons)) {
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

    const planViable = viableAvecTolerance(attrsTotal, houses);
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

  /**
   * ═══ SECONDE PASSE : LES ATELIERS RÉSERVENT LEUR SOL ═══════════════════════════════
   *
   * Les ateliers sont posés APRÈS les maisons et rasent ce qui gêne. Une emprise qui ne mord
   * qu'une case d'une résidence emporte la maison ENTIÈRE, ses neuf cases et ses habitants :
   * mesuré sur roman_island_medium_01, 70 maisons détruites — plus de 600 cases de logement —
   * pour une dizaine d'ateliers qui en occupent 250. Chercher le terrain libre d'abord a
   * supprimé le gros du gaspillage sur les îles qui en ont ; là où il manque, il reste entier.
   *
   * Le comptoir avait ce problème et le résout depuis longtemps, en RÉSERVANT son emprise
   * avant que les moteurs bâtissent (`reserveKontor`). Même remède ici, mais les emprises ne
   * sont connues qu'après coup : on rejoue donc la recette gagnante sur une grille où le sol
   * des ateliers du premier plan est retiré du masque constructible. Le moteur bâtit autour au
   * lieu de démolir, et l'aval retrouve ces cases LIBRES — `planLocalProduction` cherche le
   * terrain vide en premier, il s'y réinstalle de lui-même.
   *
   * Coût : une passe de placement et un pipeline aval, pas un plan entier. Le résultat n'est
   * gardé que s'il bat le premier, jugé comme tous les autres sur ce qu'il livre.
   */
  // Rien à récupérer si aucun atelier n'a rasé : la réservation ne changerait que le sol qu'ils
  // occupent déjà, pour le prix d'une passe complète. Mesuré sur celtic_island_large_07, où la
  // recherche de terrain libre suffit à tout loger : +6 % de temps pour zéro habitant.
  const razedByWorkshops = out ? out.workshops.reduce((a, w) => a + w.razed.length, 0) : 0;
  if (req.localProduction && out && out.workshops.length && razedByWorkshops > 0) {
    const cells: number[] = [];
    const W = req.grid.w;
    for (const w of out.workshops) {
      for (const b of w.placed) {
        const d = lookup(b.defId);
        if (!d) continue;
        const fp = footprintSize(d, b.rotation);
        for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
          const x = b.x + i, y = b.y + j;
          if (x >= 0 && y >= 0 && x < W && y < req.grid.h) cells.push(y * W + x);
        }
      }
    }
    if (cells.length) {
      onProgress?.(total, total);
      const reserved: GridShape = { ...planGrid, usable: [...planGrid.usable] };
      for (const c of cells) reserved.usable[c] = false;
      // Les ateliers sont ÉPINGLÉS sur le sol réservé. Sans cela ils se réinstallent où bon
      // leur semble et rasent de nouveau : mesuré, la réservation seule ne ramenait les
      // démolitions que de 70 à 59, pour un gain de population nul.
      const pin = out.workshops.flatMap((w) => w.placed.map((b) => ({ x: b.x, y: b.y })));
      const r2 = finalize(runLattice(bestTrial, coverageFloor, reserved), pin);
      if (betterFinal(r2, out)) out = r2;
    }
  }
  return out!;
}
