import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { economy, effectOf, residentialChainExtended } from "../economy/economy";
import { viableSubset, type Weighed } from "./viability";
import { uniqueCap } from "../economy/uniques";
import { VITAL_ATTRS } from "../economy/attributes";
import { compileTierEvaluator } from "../economy/needsModel";
import type { DefLookup } from "../engine/rules";
import { MAX_RUN, MOUNTAIN_BLOCK_RADIUS, needsWater, planWater, type WaterPlanResult } from "./waterPlan";
import { makeStreetGrid } from "./streetGrid";

// Portée de PLANIFICATION = streetRange (distance le long des rues, cf.
// GAME_MECHANICS.md §1). radius.range en repli.
const rangeOf = (d: BuildingDef): number => d.streetRange || d.radius?.range || 0;

export interface LatticeOpts {
  coverageFloor?: number; // 0..1, défaut 1
  serviceIds?: string[]; // restreint les services (mode seuils)
  /** Router le réseau d'eau ENTRE services et maisons (corridors réservés : les
   *  conduites ne partagent pas les cases route → après les maisons il ne reste
   *  plus de passage). Défaut false. */
  water?: boolean;
  /** Hauteurs quantifiées (q = h/16) — pente des aqueducs (waterPlan). */
  heights?: Int8Array | null;
  /** Espacement des ÉPINES verticales du peigne, en tuiles. Voir `SPINE_STEP`. */
  spineStep?: number;
  /**
   * INSTITUTIONS à blanketer en plus des services du palier (Vigiles, Medici, Custodia,
   * sanctuaires…). Elles ne remplissent aucun besoin — elles ne comptent donc pas pour les
   * seuils de palier — mais leur effet de zone corrige les attributs que le rang de cité
   * dégrade. Sans elles, aucune ville ne dépasse 3 000 habitants avec tous ses attributs
   * positifs ; avec elles, la recette complète tient jusqu'à 260 000.
   */
  institutions?: string[];
  /** Arrêter de bâtir quand le BILAN DE L'ÎLE passerait sous zéro sur un attribut vital.
   *  Défaut true. */
  viabilityGate?: boolean;
  /** Déficit vital TOLÉRÉ par maison, 0 par défaut. Voir `viability.ts`. */
  tolerance?: number;
  /** Permis détenus en partie, par GUID de permis. Voir `economy/uniques`. */
  permits?: Record<string, number>;
  /** Emprise réservée à un bâtiment posé plus tard (le comptoir) : le réseau d'eau doit
   *  l'éviter, le masque de terre ne suffit pas à l'en protéger. */
  reserved?: { x: number; y: number; w: number; h: number };
}

/**
 * Espacement des épines verticales du peigne de routes.
 *
 * Le pas HORIZONTAL vaut `2·rh + 1` (= 7 pour des résidences 3×3) et il est optimal :
 * une rangée de route pour deux rangées de maisons, soit le minimum en 4-adjacence.
 * Les épines, elles, ne servent qu'à la connexité et à raccourcir la distance-rue —
 * et à 7 elles coûtaient à elles seules ~1 colonne sur 7, soit ~12 % du sol.
 *
 * La valeur a été BALAYÉE, pas devinée — et l'optimum n'est pas monotone : élargir rend
 * du sol mais allonge la distance-rue, donc un service couvre moins de maisons, et le
 * tracé des conduites d'eau change aussi (elles se faufilent entre les routes). 13 gagne
 * sur les deux îles testées, et c'est aussi la valeur la plus ROBUSTE : 9, 17, 21 et 25
 * font s'effondrer le réseau d'eau de medium_01 (0 maison au palier cible).
 *
 *   île 320² (terre 45 621)        île medium_01 (terre 26 835)
 *   pas | habitants | routes        pas | habitants | routes
 *     7 |    47 281 |   25 %          7 |    27 536 |   26 %
 *    11 |    46 955 |   22 %         11 |    27 551 |   23 %
 *    13 |    48 990 |   22 %   ←     13 |    29 289 |   23 %   ←
 *    17 |    47 852 |   21 %         17 |    22 680 |   21 %
 *    21 |    44 815 |   20 %         21 |    22 482 |   21 %
 *    41 |    42 556 |   20 %         41 |    21 661 |   21 %
 */
export const SPINE_STEP = 13;

/**
 * Une PARCELLE bâtie et les paliers qu'elle peut légalement accueillir, d'après les services
 * qui la couvrent. C'est la matière première de la cascade de main-d'œuvre : rétrograder une
 * maison vers un palier ouvrier ne déplace ni ne démolit rien, puisque les neuf résidences
 * du jeu font toutes 3×3.
 */
export interface HousePlot {
  uid: string;
  /** palier effectivement retenu à la pose (le meilleur atteignable) */
  guid: string;
  opts: {
    guid: string;
    defId: string;
    cap: number;
    /** attributs vitaux de la maison à ce palier, institutions comprises, hors rang de cité */
    attrs: Record<string, number>;
  }[];
}

/** Paliers qu'au moins une parcelle sait accueillir — le VIVIER de la cascade. */
export const hostableTiers = (plots?: HousePlot[]): Set<string> => {
  const s = new Set<string>();
  for (const p of plots ?? []) for (const o of p.opts) s.add(o.guid);
  return s;
};

export interface LatticeResult {
  buildings: PlacedBuilding[];
  /** parcelles retenues et leurs paliers atteignables (cascade de main-d'œuvre) */
  plots: HousePlot[];
  roads: RoadTile[];
  fields: FieldTile[];
  houses: number;
  fullyCovered: number; // maisons ayant atteint le tier-cible
  /** Maisons par tier ATTEINT (guid → nb) : accounting MIXTE. Une maison sous-desservie
   *  retombe au meilleur palier dont elle franchit les seuils (min = base). */
  tierCounts: Record<string, number>;
  /** Habitants TOTAUX = Σ sur les maisons de leur capacité RÉELLE (Σ Population des besoins
   *  remplis, cf. economy/needsModel). Ce n'est pas `Σ tierCounts × capacité par défaut` :
   *  deux maisons du même palier n'ont pas la même capacité si l'une est mieux desservie. */
  residents: number;
  /** Taxe/min cumulée des maisons (Σ Money des besoins remplis). */
  houseMoney: number;
  /**
   * SOMME de chaque attribut VITAL sur toutes les maisons retenues, hors malus de rang de
   * cité — que seul l'appelant connaît, puisqu'il dépend de la population totale.
   *
   * Le bilan se juge à l'échelle de l'ÎLE, pas de la maison : une maison en déficit
   * compensée par ses voisines ne pose aucun problème. Le total de l'île vaut donc
   * `attrsSum[k] + houses × rangDeCité[k]`, et c'est lui qui doit rester ≥ 0.
   */
  attrsSum: Record<string, number>;
  /** Capacité cumulée PAR PALIER atteint (guid → habitants). Permet de recalculer la
   *  population après une démotion sans repasser par les masques de couverture. */
  capByTier: Record<string, number>;
  servicesPlaced: Record<string, number>;
  water?: WaterPlanResult; // présent si opts.water
}

/**
 * Planner v5 — LATTICE par type (cf. session refonte placement, fil 1).
 *
 * Idée clef : chaque type de service est posé sur une GRILLE RÉGULIÈRE d'espacement
 * S_t calé sur sa portée-rue. Comme chaque type tuile l'île indépendamment et
 * régulièrement, l'INTERSECTION des couvertures (= maisons vues par TOUS les types)
 * couvre tout l'intérieur PAR CONSTRUCTION — contrairement au greedy de districtPlan
 * dont l'intersection est déchiquetée. Les wonders (portée 50-70) sont le MÊME
 * mécanisme avec un grand S_t → 1-2 copies suffisent.
 *
 * Ordre : routes → lattices de service (du plus grand au plus petit) → vérification
 * + densification si un type < seuil → maisons dans tout le reste accessible, gardées
 * ssi couvertes par tous (intérieur ~100 %, bordures best-effort jusqu'à floor).
 *
 * Couverture = BFS le long des rues, sémantique = streetCoverage de l'analyseur.
 */
export function planLattice(
  grid: GridShape,
  tierGuid: string,
  lookup: DefLookup,
  opts: LatticeOpts = {},
): LatticeResult {
  const floor = Math.min(1, Math.max(0.3, opts.coverageFloor ?? 1));
  const tier = economy.tiers.find((t) => t.guid === tierGuid);
  if (!tier || !tier.residenceId) throw new Error("Tier-cible invalide.");
  const residenceId = tier.residenceId;
  const resDef = lookup(residenceId)!;
  const rw = resDef.size.w, rh = resDef.size.h;
  const W = grid.w, H = grid.h, N = W * H;

  const wanted = opts.serviceIds ? new Set(opts.serviceIds) : null;
  const tierSvcIds = new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b));
  // Les institutions sont traitées comme des types de service SUPPLÉMENTAIRES : même
  // lattice, même BFS de portée-rue. Elles n'entrent simplement pas dans l'évaluateur de
  // palier (aucun bit), donc elles ne peuvent pas faire monter une maison de rang.
  const instIds = (opts.institutions ?? []).filter((id) => !tierSvcIds.has(id));
  const viabilityGate = opts.viabilityGate !== false;
  const svcDefs = [...new Set([...tierSvcIds].filter((id) => !wanted || wanted.has(id)).concat(instIds))]
    .map((id) => lookup(id))
    .filter((d): d is BuildingDef => !!d && rangeOf(d) > 0)
    .sort((a, b) => rangeOf(b) - rangeOf(a)); // grand → petit (espace contigu d'abord)

  const occ = new Uint8Array(N);
  // `occ` confond deux choses : le terrain impraticable et les bâtiments posés. On garde donc
  // le masque TERRAIN à part — la route de montagne a besoin de savoir qu'une case est
  // bloquée par le relief, pas par une construction.
  const terrainBlocked = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!grid.usable[i]) { occ[i] = 1; terrainBlocked[i] = 1; }
  const roadAt = new Uint8Array(N);
  const bldAdj = new Uint8Array(N);

  let x0 = W, y0 = H, x1 = -1, y1 = -1, landCount = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid.usable[y * W + x]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    landCount++; sumX += x; sumY += y;
  }
  if (x1 < 0) return { buildings: [], plots: [], roads: [], fields: [], houses: 0, fullyCovered: 0, tierCounts: {}, residents: 0, houseMoney: 0, attrsSum: {}, capByTier: {}, servicesPlaced: {} };
  const gx = Math.round(sumX / landCount), gy = Math.round(sumY / landCount);

  // --- routes : grille régulière (lignes H tous STEPH, épines V tous STEPV) ---
  const STEPH = 2 * rh + 1;
  const STEPV = Math.max(rw + 2, opts.spineStep ?? SPINE_STEP);
  // « prises d'eau » : cases réservées SANS route près des consommateurs d'eau —
  // une conduite ne peut pas terminer sur une route, donc un anneau complet rend
  // le bâtiment irraccordable (cause du 0/20 raccordés)
  const waterGate = new Uint8Array(N);
  // primitives de grille/rue partagées (cf. streetGrid.ts). planLattice : anti-emmurement
  // (bldAdj) ET prises d'eau (waterGate, layRoad/layRing les évitent).
  const sg = makeStreetGrid({
    W, H, occ, roadAt, bldAdj, usable: grid.usable, rw, rh, x0, y0, x1, y1, STEPH,
    blockRingInFits: true, reserved: waterGate,
  });
  const { fitsBld, fitsHouse, orthoRoadCells, touchesRoad, markAdj, layRoad, layRing, connectRing } = sg;
  for (let y = y0; y <= y1; y += STEPH) for (let x = x0; x <= x1; x++) layRoad(x, y);
  for (let x = x0; x <= x1; x += STEPV) for (let y = y0; y <= y1; y++) layRoad(x, y);

  // --- helpers ---
  const buildings: PlacedBuilding[] = [];
  const servicesPlaced: Record<string, number> = {};
  const placements = new Map<string, { x: number; y: number; w: number; h: number }[]>();
  // réserve 2 cases libres SANS route au milieu d'un côté (prise d'eau pour la
  // conduite). Essaie bas → haut → droite → gauche ; renvoie true si réservé.
  const reserveWaterGate = (x: number, y: number, w: number, h: number): boolean => {
    const mx = x + (w >> 1), my = y + (h >> 1);
    const trySide = (cells: [number, number][]): boolean => {
      const ok = cells.filter(([px, py]) => px >= 0 && py >= 0 && px < W && py < H
        && grid.usable[py * W + px] && !occ[py * W + px] && !roadAt[py * W + px]);
      if (!ok.length) return false;
      for (const [px, py] of ok) waterGate[py * W + px] = 1;
      return true;
    };
    return trySide([[mx, y + h], [mx + 1, y + h]]) || trySide([[mx, y - 1], [mx + 1, y - 1]])
      || trySide([[x + w, my], [x + w, my + 1]]) || trySide([[x - 1, my], [x - 1, my + 1]]);
  };
  interface TypeCov {
    def: BuildingDef;
    range: number;
    reach: Uint8Array;
    reachList: number[];
    parent: Int32Array;
  }
  const typeCov = new Map<string, TypeCov>();
  for (const d of svcDefs) typeCov.set(d.id, { def: d, range: rangeOf(d), reach: new Uint8Array(N), reachList: [], parent: new Int32Array(N) });

  // BFS distance-rue partagé (cf. streetGrid.ts) — wrapper conservant la signature locale.
  const bfsType = (tc: TypeCov) => sg.bfsType(tc, placements);

  // rotation 0|1 : 1 = couché (w/h échangés, même ancre top-left — cf. footprintCells)
  const stamp = (def: BuildingDef, x: number, y: number, rot: 0 | 1 = 0) => {
    const w = rot ? def.size.h : def.size.w, h = rot ? def.size.w : def.size.h;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (y + j) * W + (x + i);
      occ[c] = 1;
      if (roadAt[c]) roadAt[c] = 0;
    }
    buildings.push({ uid: uid("lat"), defId: def.id, x, y, rotation: rot ? 90 : 0, locked: false });
    servicesPlaced[def.id] = (servicesPlaced[def.id] ?? 0) + 1;
    if (def.uniqueType) uniqueUsed.set(def.uniqueType, (uniqueUsed.get(def.uniqueType) ?? 0) + 1);
    const arr = placements.get(def.id) ?? [];
    arr.push({ x, y, w, h });
    placements.set(def.id, arr);
    markAdj(x, y, w, h);
    // consommateur d'eau : réserver la prise AVANT l'anneau (sinon il l'enferme)
    if (needsWater(def)) reserveWaterGate(x, y, w, h);
    const ring = layRing(x, y, w, h);
    if (ring.length) connectRing(ring);
  };
  /**
   * QUOTA D'UNICITÉ PARTAGÉ. `BuildingUnique` ne plafonne pas un bâtiment mais un TYPE :
   * les seize autels de dieux — huit divinités × deux régions — portent tous
   * `UniqueType=Shrine` avec `UniqueScope=Area`, si bien que le total autorisé sur l'île
   * est commun à toutes les divinités. Le placeur ne connaissait que le drapeau booléen et
   * en posait donc une copie par DIVINITÉ : 72 autels mesurés sur roman_island_medium_01,
   * 84 sur celtic_island_large_07, là où le jeu en autorise le nombre de permis détenus.
   */
  const uniqueUsed = new Map<string, number>();
  const remainingQuota = (d: BuildingDef): number =>
    uniqueCap(d, opts.permits) - (d.uniqueType ? (uniqueUsed.get(d.uniqueType) ?? 0) : 0);

  // pose une copie au plus près de (tx,ty) dans un rayon maxRad (spirale Chebyshev)
  const placeNear = (def: BuildingDef, tx: number, ty: number, maxRad: number, rot: 0 | 1 = 0): boolean => {
    const w = rot ? def.size.h : def.size.w, h = rot ? def.size.w : def.size.h;
    for (let r = 0; r <= maxRad; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (fitsBld(w, h, tx + dx, ty + dy)) { stamp(def, tx + dx, ty + dy, rot); return true; }
      }
    }
    return false;
  };

  // --- LATTICE par type : pavage en QUINCONCE (diamants L1) ---
  // Un service de portée-rue R couvre ≈ un diamant L1 de rayon R_eff autour de lui
  // (R_eff = R − détour de grille ≈ R − STEPH). Les diamants L1 de rayon r PAVENT
  // le plan quand les centres sont en quinconce (lignes espacées de r, colonnes de
  // 2r, lignes impaires décalées de r) : tout point est à L1 ≤ r d'un centre. C'est
  // le minimum de copies pour couvrir une zone (≈ aire/2r²), posé d'AVANCE — pas de
  // boucle de réparation qui explose comme districtPlan.
  // floor < 1 : espacement étiré (trous de bordure acceptés → moins de copies).
  // services TOUJOURS dimensionnés à leur portée réelle (maximise les maisons
  // PLEINEMENT couvertes) ; le floor ne joue plus sur la densité de services mais
  // sur le quota de maisons partielles gardées en bordure (cf. passe MAISONS).
  const effR = (d: BuildingDef): number => Math.max(8, rangeOf(d) - STEPH);

  // BFS L1 plein-grille (proxy OPTIMISTE de la distance-rue : rue ≥ L1). Sert à
  // ÉLAGUER les ancres redondantes — la densification exacte (rue) répare derrière.
  const l1Update = (distMap: Int32Array, seeds: number[], limit: number) => {
    let frontier: number[] = [];
    for (const c of seeds) if (distMap[c] > 0) { distMap[c] = 0; frontier.push(c); }
    let d = 0;
    while (frontier.length && d < limit) {
      const next: number[] = [];
      for (const c of frontier) {
        const x = c % W, y = (c / W) | 0;
        for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
          if (nb < 0 || distMap[nb] <= d + 1) continue;
          distMap[nb] = d + 1;
          next.push(nb);
        }
      }
      frontier = next; d++;
    }
  };

  // gain d'une ancre = cases de terre encore à > r (L1) dans son diamant
  const diamondGain = (ax0: number, ay0: number, r: number, distMap: Int32Array): number => {
    let g = 0;
    for (let dy = -r; dy <= r; dy++) {
      const ay = ay0 + dy;
      if (ay < 0 || ay >= H) continue;
      const span = r - Math.abs(dy), base = ay * W;
      for (let dx = -span; dx <= span; dx++) {
        const ax = ax0 + dx;
        if (ax < 0 || ax >= W) continue;
        const c = base + ax;
        if (grid.usable[c] && distMap[c] > r) g++;
      }
    }
    return g;
  };

  // GREEDY INCRÉMENTAL : pose des copies au max-gain (identique au greedy naïf), mais
  // après chaque pose, ne RECALCULE le diamant que des ancres PROCHES du copie posée
  // (les seules dont le gain a pu changer — le gain est sous-modulaire et borné par la
  // distance). Le greedy naïf rescannait TOUTES les ancres × tout le diamant à chaque
  // tour → O(51 s) sur continental 768² ; ici l'île entière tombe sous 3 s.
  const greedyCover = (
    anchors: { x: number; y: number }[],
    distMap: Int32Array,
    r: number,
    minGain: number,
    maxCopies: number,
    place: (a: { x: number; y: number }) => number[] | null,
  ) => {
    const gains = anchors.map((a) => diamondGain(a.x, a.y, r, distMap));
    for (let placed = 0; placed < maxCopies; placed++) {
      let bi = -1, bg = minGain - 1; // scan du max (O(ancres), bon marché)
      for (let i = 0; i < gains.length; i++) if (gains[i] > bg) { bg = gains[i]; bi = i; }
      if (bi < 0) break; // plus aucune ancre ≥ minGain
      gains[bi] = -1; // ancre consommée
      const seeds = place(anchors[bi]);
      if (!seeds) continue; // rien ne tient ici
      l1Update(distMap, seeds, r + 1);
      // zone réellement altérée = bbox des cases posées ± r (portée du diamant L1) ;
      // dérivée des SEEDS (un strip de cluster s'étend bien au-delà de l'ancre)
      let nx0 = W, ny0 = H, nx1 = 0, ny1 = 0;
      for (const c of seeds) {
        const x = c % W, y = (c / W) | 0;
        if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y;
      }
      // une ancre (diamant r) voit son gain changer ssi une case de son diamant a été
      // abaissée par l1Update (portée r+1 autour des graines) → L1 ≤ 2r+1 du bbox
      const m = 2 * r + 1;
      for (let i = 0; i < gains.length; i++) {
        if (gains[i] < 0) continue;
        const ax = anchors[i].x, ay = anchors[i].y;
        if (ax >= nx0 - m && ax <= nx1 + m && ay >= ny0 - m && ay <= ny1 + m) {
          gains[i] = diamondGain(ax, ay, r, distMap);
        }
      }
    }
  };

  // slots montagne = emplacements possibles des sources d'aqueduc (cf. waterPlan)
  const mountainSlots = (grid.slots ?? []).filter((s) => s.type === "mountain");
  const SMALL_RANGE_MAX = 40; // gros (Théâtre/Biblio/Bains/Temple/Forum/MJeu) vs petits
  const placeLattice = (d: BuildingDef) => {
    const r = effR(d);
    // candidats : grille FINE (r/2) + centroïde en tête. Le lazy-greedy borné ci-dessous
    // est un min-set-cover approché par type (converge vers le quinconce ~aire/2r²).
    const cstep = Math.max(4, Math.floor(r / 2));
    let anchors: { x: number; y: number }[] = [{ x: gx, y: gy }];
    for (let ly = y0; ly <= y1; ly += cstep) {
      for (let lx = x0; lx <= x1; lx += cstep) anchors.push({ x: lx, y: ly });
    }
    // ANCRAGE EAU d'un bâtiment UNIQUE et consommateur (l'Amphithéâtre : 1 exemplaire,
    // 50 u obligatoires). Il n'a qu'une chance d'être bien posé : s'il atterrit loin de tout
    // slot montagne, aucune conduite ne peut l'atteindre (MAX_RUN), il reste SEC donc
    // INACTIF, et comme il pèse 8 des 12 points Wonders, TOUT le palier cible s'effondre —
    // mesuré sur 6 îles sur 55, où le plan retombait entièrement au palier inférieur.
    // On restreint donc ses ancres au voisinage des sources possibles, en desserrant par
    // paliers, et on retombe sur les ancres libres si rien ne tient (best-effort).
    if (d.unique && needsWater(d) && mountainSlots.length) {
      for (const frac of [0.5, 0.75, 1]) {
        const lim = frac * MAX_RUN;
        const near = anchors.filter((a) => mountainSlots.some(
          (s) => Math.max(Math.abs(s.x - a.x), Math.abs(s.y - a.y)) <= lim));
        if (near.length) { anchors = near; break; }
      }
    }
    const distMap = new Int32Array(N).fill(N);
    // minGain plafonné à 30 % de la terre : un type à portée >= taille d'île (Colisée
    // 250) aurait sinon un seuil inatteignable → jamais posé
    const minGain = Math.max(60, Math.min(Math.floor(2 * r * r * 0.25), Math.floor(landCount * 0.3)));
    // Le quota est PARTAGÉ entre bâtiments de même `uniqueType` : on ne borne donc pas à 1
    // par bâtiment mais au reliquat commun. Le Colisée reste à 1, les autels se partagent
    // les permis de sanctuaire.
    const maxCopies = Math.min(remainingQuota(d), Math.ceil(landCount / (2 * r * r)) * 2 + 2);
    if (maxCopies <= 0) return;
    greedyCover(anchors, distMap, r, minGain, maxCopies, (a) => {
      const before = (placements.get(d.id) ?? []).length;
      placeNear(d, a.x, a.y, Math.floor(r / 2) + 4);
      const arr = placements.get(d.id) ?? [];
      if (arr.length === before) return null;
      const p = arr[arr.length - 1];
      const seeds: number[] = [];
      for (let j = 0; j < p.h; j++) for (let i2 = 0; i2 < p.w; i2++) seeds.push((p.y + j) * W + (p.x + i2));
      return seeds;
    });
  };

  // --- CLUSTERS de petits services : CO-LOCALISATION sur quinconce gain-pruné ---
  // Leçon des benchs : des lattices INDÉPENDANTS par petit type (phases décalées)
  // déchiquettent l'INTERSECTION des couvertures (gruyère → ~0 maison complète).
  // Tous les petits types posés FLUSH sur la MÊME ligne du peigne → leurs graines
  // BFS coïncident → l'intersection ≈ le diamant du type le plus court. Le quinconce
  // des clusters est calé sur CE rayon-là (le minimum), gain-pruné comme les gros.
  const bigDefs = svcDefs.filter((d) => rangeOf(d) > SMALL_RANGE_MAX);
  const smallDefs = svcDefs.filter((d) => rangeOf(d) <= SMALL_RANGE_MAX);
  const smallByH = [...smallDefs].sort((a, b) => b.size.h - a.size.h);
  // strip atomique : tous les petits types alternés dessus/dessous d'une ligne du
  // peigne (rotation pour ceux qui débordent de la poche), tout ou rien
  const tryStrip = (cx: number, ly: number): boolean => {
    let xa = cx, xb = cx, above = true;
    const pos: { d: BuildingDef; x: number; y: number; rot: 0 | 1 }[] = [];
    // Le quota compte AUSSI ce que ce strip a déjà retenu : sans ce compteur local, un même
    // strip posait un autel par divinité d'un coup, quota ou pas.
    const localUse = new Map<string, number>();
    for (const d of smallByH) {
      if (d.uniqueType) {
        const used = (localUse.get(d.uniqueType) ?? 0);
        if (remainingQuota(d) - used <= 0) continue;
        localUse.set(d.uniqueType, used + 1);
      }
      const rot: 0 | 1 = d.size.h > STEPH - 1 && d.size.w <= STEPH - 1 ? 1 : 0;
      const w = rot ? d.size.h : d.size.w, h = rot ? d.size.w : d.size.h;
      const ty = above ? ly - h : ly + 1; // flush contre la route
      const tx = above ? xa : xb;
      if (!fitsBld(w, h, tx, ty)) return false;
      pos.push({ d, x: tx, y: ty, rot });
      if (above) xa += w + 1; else xb += w + 1;
      above = !above;
    }
    for (const p of pos) stamp(p.d, p.x, p.y, p.rot);
    return true;
  };
  const placeClusterLattice = () => {
    if (!smallDefs.length) return;
    // NOTE : les bâtiments à quota restent dans ce calcul, bien qu'on n'en pose qu'un ou
    // deux. Les en exclure élargit la trame et dégrade mesurablement la connexité routière
    // (0,95 → 0,70) et le raccordement à l'eau (0,60 → 0,54) : c'est une question
    // d'optimisation à traiter séparément, pas un effet du quota d'unicité.
    const rC = Math.min(...smallDefs.map((d) => effR(d)));
    const cstep = Math.max(4, Math.floor(rC / 2));
    // ancres : centroïde + grille fine SNAPPÉE aux lignes du peigne (flush)
    const snapLine = (y: number) => Math.min(y0 + Math.round((y - y0) / STEPH) * STEPH, y1);
    const anchors: { x: number; y: number }[] = [{ x: gx, y: snapLine(gy) }];
    for (let ly = y0; ly <= y1; ly += cstep) {
      const ay = snapLine(ly);
      for (let lx = x0; lx <= x1; lx += cstep) anchors.push({ x: lx, y: ay });
    }
    const distMap = new Int32Array(N).fill(N);
    const minGain = Math.max(60, Math.floor(2 * rC * rC * 0.25));
    const maxStrips = Math.ceil(landCount / (2 * rC * rC)) * 2 + 2;
    greedyCover(anchors, distMap, rC, minGain, maxStrips, (a) => {
      // strip atomique : essai en glissant le long de la ligne
      const nBefore = buildings.length;
      let ok = false;
      for (const dx of [0, -3, 3, -6, 6, -9, 9, -12, 12]) {
        if (tryStrip(a.x + dx, a.y)) { ok = true; break; }
      }
      if (!ok) return null;
      const seeds: number[] = [];
      for (let bIdx = nBefore; bIdx < buildings.length; bIdx++) {
        const b = buildings[bIdx];
        const { w, h } = footprintSize(lookup(b.defId)!, b.rotation);
        for (let j = 0; j < h; j++) for (let i2 = 0; i2 < w; i2++) seeds.push((b.y + j) * W + (b.x + i2));
      }
      return seeds;
    });
  };

  for (const d of bigDefs) placeLattice(d); // gros : grand → petit (espace contigu)
  placeClusterLattice(); // petits : clusters co-localisés

  // --- carte de demande (où une maison TIENT, après les services) ---
  // recalculable : chaque densification stampe une emprise → des slots meurent.
  let demand = new Uint8Array(N);
  let demandTotal = 0;
  const rebuildDemand = () => {
    demand = new Uint8Array(N);
    demandTotal = 0;
    for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) {
      if (fitsHouse(x, y) && touchesRoad(x, y)) { demand[y * W + x] = 1; demandTotal++; }
    }
  };
  rebuildDemand();

  // couverture d'un type sur la demande : origine couverte ssi case d'emprise
  // ortho-adjacente à une route atteinte. Renvoie le set d'origines couvertes.
  const coveredOrigins = (tc: TypeCov): Uint8Array => {
    const cov = new Uint8Array(N);
    // pour chaque route atteinte c, les cases-maison adjacentes = voisins ortho de c.
    // une origine (ox,oy) est couverte si l'un de ces voisins est dans son emprise.
    for (const c of tc.reachList) {
      const cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        // origines dont l'emprise rw×rh contient (nx,ny)
        for (let ox = nx - rw + 1; ox <= nx; ox++) for (let oy = ny - rh + 1; oy <= ny; oy++) {
          if (ox < 0 || oy < 0 || ox + rw > W || oy + rh > H) continue;
          const o = oy * W + ox;
          if (demand[o]) cov[o] = 1;
        }
      }
    }
    return cov;
  };

  // ═══ PHASE densification : tout type sous le seuil reçoit des copies de secours.
  // ORDRE PORTEUR (hazards) : densif → EAU → refresh final → maisons → élagage. L'eau
  // AVANT les maisons (les conduites n'occupent pas les routes ; après, plus de passage).
  // refresh FINAL obligatoire (stamps tardifs de densif/eau invalident les BFS). ═══
  const covByType = new Map<string, Uint8Array>();
  const refreshType = (tc: TypeCov) => { bfsType(tc); covByType.set(tc.def.id, coveredOrigins(tc)); };
  for (const tc of typeCov.values()) refreshType(tc);

  // budget par TYPE (≈ moitié du lattice initial en copies de secours) : borné par
  // construction, contrairement à la réparation ouverte de districtPlan.
  const repairBudget = new Map<string, number>();
  for (const tc of typeCov.values()) {
    const r = effR(tc.def);
    // LE BUDGET NE PEUT PAS DÉPASSER CE QUI RESTE AU QUOTA.
    //
    // Le garde-fou était le seul booléen `def.unique` : vrai pour le Colisée, vrai aussi pour
    // les seize sanctuaires — d'où l'illusion que la densification respectait l'unicité. Elle
    // ne la respectait pas : `repairBudget` est indexé par DEFID et la pose qui en découle
    // (`placeNear` → `stamp`) ne consulte AUCUN quota. Un type portant un `uniqueType` sans le
    // drapeau `unique` — un plafond `allowed: 2`, par exemple — se serait vu densifier au-delà
    // de son plafond, à raison d'une copie de secours par bâtiment du type.
    //
    // Le budget est donc borné par le quota restant, lui indexé par TYPE.
    repairBudget.set(tc.def.id, Math.min(
      remainingQuota(tc.def),
      tc.def.unique ? 0 : Math.max(3, Math.ceil(landCount / (2 * r * r))),
    ));
  }
  const maxRounds = 8 * svcDefs.length;
  for (let round = 0; round < maxRounds; round++) {
    let worst: TypeCov | null = null, worstMiss = 0;
    for (const tc of typeCov.values()) {
      if ((repairBudget.get(tc.def.id) ?? 0) <= 0) continue;
      const cov = covByType.get(tc.def.id)!;
      let miss = 0;
      for (let i = 0; i < N; i++) if (demand[i] && !cov[i]) miss++;
      if (miss > worstMiss) { worstMiss = miss; worst = tc; }
    }
    if (!worst || worstMiss <= demandTotal * (1 - floor)) break;
    // densifier : poser une copie au barycentre du plus gros trou (max demande non
    // couverte). Vraie table de sommes intégrales : la somme de fenêtre brute-force
    // coûtait (bbox/3)² × q² par round (q≈106 pour le Colisée).
    const cov = covByType.get(worst.def.id)!;
    const sat = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      const r0 = y * (W + 1), r1 = (y + 1) * (W + 1);
      for (let x = 0; x < W; x++) {
        const m = demand[y * W + x] && !cov[y * W + x] ? 1 : 0;
        sat[r1 + x + 1] = m + sat[r0 + x + 1] + sat[r1 + x] - sat[r0 + x];
      }
    }
    const rectSum = (xa: number, ya: number, xb: number, yb: number): number => {
      xa = Math.max(0, xa); ya = Math.max(0, ya); xb = Math.min(W - 1, xb); yb = Math.min(H - 1, yb);
      if (xa > xb || ya > yb) return 0;
      return sat[(yb + 1) * (W + 1) + xb + 1] - sat[ya * (W + 1) + xb + 1] - sat[(yb + 1) * (W + 1) + xa] + sat[ya * (W + 1) + xa];
    };
    const q = Math.max(3, Math.floor((worst.range * 0.6) / Math.SQRT2));
    let bx = -1, by = -1, best = 0;
    for (let cy = y0; cy <= y1; cy += 3) for (let cx = x0; cx <= x1; cx += 3) {
      const s = rectSum(cx - q, cy - q, cx + q, cy + q);
      if (s > best) { best = s; bx = cx; by = cy; }
    }
    if (bx < 0 || best === 0) { repairBudget.set(worst.def.id, 0); continue; }
    if (!placeNear(worst.def, bx, by, Math.max(W, H))) { repairBudget.set(worst.def.id, 0); continue; }
    repairBudget.set(worst.def.id, (repairBudget.get(worst.def.id) ?? 1) - 1);
    // l'emprise posée a pu écraser routes/slots → demande live + type recalculé
    rebuildDemand();
    refreshType(worst);
  }

  // ═══ PHASE eau (AVANT les maisons) : services posés = consommateurs connus ; les
  // conduites ne partagent pas les cases route → maisons d'abord = poches pleines, aucun
  // passage. Routées ici, les maisons contournent les corridors (cases conduite occupées). ═══
  let water: WaterPlanResult | undefined;
  if (opts.water) {
    const roadsNow: RoadTile[] = [];
    for (let i = 0; i < N; i++) if (roadAt[i]) roadsNow.push({ x: i % W, y: (i / W) | 0 });
    water = planWater(grid, buildings, roadsNow, lookup, opts.heights, opts.reserved);
    for (const s of water.sources) {
      const { w, h } = footprintSize(lookup(s.defId)!, s.rotation);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const c = (s.y + j) * W + (s.x + i);
        if (c >= 0 && c < N) { occ[c] = 1; if (roadAt[c]) roadAt[c] = 0; }
      }
      // Marquer l'adjacence, comme le fait `stamp` pour tout autre bâtiment. Sans cela
      // `bldAdj` reste vide autour de la source, et l'élagage — qui garde les routes sur le
      // critère `roadAt && bldAdj` — retire son unique accès. C'est pourquoi TOUS les
      // bâtiments sans route adjacente mesurés étaient des sources : elles en avaient une,
      // l'élagage la reprenait.
      markAdj(s.x, s.y, w, h);
      buildings.push(s);
    }
    for (const a of water.aqueducts) {
      const c = a.y * W + a.x;
      if (!roadAt[c]) occ[c] = 1; // croisement : la route reste, la conduite enjambe
    }

    // ═══ LES CONSOMMATEURS D'EAU SECS SORTENT DU PLAN ═══════════════════════════════════
    //
    // Un service à eau non raccordé est INACTIF en jeu : il ne rend aucun service, il coûte
    // son entretien, et il occupe une emprise souvent énorme — Forum, Bains, Citerne. Mesuré
    // sur roman_island_small_06 : 5 secs sur 18, et 12 sur 19 dans la configuration signalée
    // par l'utilisateur.
    //
    // Les retirer répare DEUX défauts d'un coup. Le sol revient aux maisons — c'est le gain
    // évident. Mais surtout, leur COUVERTURE cesse de compter : `activeType` est calculé par
    // TYPE, si bien qu'une seule copie raccordée rendait actives toutes les copies du type,
    // sèches comprises, et une maison desservie par la seule copie sèche était comptée
    // couverte. Le BFS de portée part de `placements` : en retirer la copie suffit, sans
    // toucher au reste du moteur.
    //
    // Un type dont TOUTES les copies sont sèches disparaît alors, et les maisons retombent au
    // palier qu'elles franchissent sans lui — ce qui est exactement ce que le jeu ferait.
    const dry = new Set(water.consumers.filter((c) => !c.connected).map((c) => c.uid));
    if (dry.size) {
      const kept: PlacedBuilding[] = [];
      for (const b of buildings) {
        const d = dry.has(b.uid) ? lookup(b.defId) : undefined;
        if (!d) { kept.push(b); continue; }
        const fp = footprintSize(d, b.rotation);
        for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
          const c = (b.y + j) * W + (b.x + i);
          if (c >= 0 && c < N && grid.usable[c]) occ[c] = 0; // le sol redevient constructible
        }
        const arr = placements.get(b.defId);
        const k = arr ? arr.findIndex((q) => q.x === b.x && q.y === b.y) : -1;
        if (arr && k >= 0) arr.splice(k, 1);
        servicesPlaced[b.defId] = Math.max(0, (servicesPlaced[b.defId] ?? 1) - 1);
        if (!servicesPlaced[b.defId]) delete servicesPlaced[b.defId];
        if (d.uniqueType) {
          uniqueUsed.set(d.uniqueType, Math.max(0, (uniqueUsed.get(d.uniqueType) ?? 1) - 1));
        }
      }
      buildings.length = 0;
      buildings.push(...kept);
      water.consumers = water.consumers.filter((c) => !dry.has(c.uid));
      water.dropped = (water.dropped ?? 0) + dry.size;
      water.gaps.push(
        `${dry.size} service(s) à eau non raccordable(s) retiré(s) du plan (inactifs en jeu)`,
      );
    }
  }

  // ═══ ROUTE JUSQU'AUX SLOTS MONTAGNE ═════════════════════════════════════════════════
  //
  // `blockMountains` retire la zone montagne du masque constructible, et `layRoad` refuse
  // toute case non utilisable : le peigne ne peut donc STRUCTURELLEMENT pas y monter. Or le
  // slot montagne accueille la source d'aqueduc ET les mines — qui ont besoin de la route
  // comme tout bâtiment de production, et d'un entrepôt à portée de charrette pour expédier.
  //
  // Mesuré avant correction : sur trois îles, la TOTALITÉ des bâtiments sans aucune route
  // adjacente étaient des sources d'aqueduc — 7, 5 et 9 — et le balayage des 55 îles montrait
  // le même reliquat partout.
  //
  // On creuse donc un accès depuis chaque source vers le réseau existant. Le chemin traverse
  // le RELIEF (cases bloquées par le terrain, jamais par un bâtiment : `fitsBld` exige
  // `usable`, aucune construction n'y tient) et les cases libres, jamais un bâtiment. Les
  // cases posées deviennent des routes ordinaires : l'élagage ancré au comptoir les rattache
  // ensuite au réseau enraciné comme n'importe quelles autres.
  if (water?.sources.length) {
    const nearMountain = new Uint8Array(N);
    const rad = MOUNTAIN_BLOCK_RADIUS + 2;
    for (const sl of mountainSlots) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = sl.x + dx, y = sl.y + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) nearMountain[y * W + x] = 1;
      }
    }
    const passable = (c: number): boolean => {
      if (roadAt[c]) return true;
      if (terrainBlocked[c]) return nearMountain[c] === 1; // relief autour du slot
      return !occ[c];
    };
    for (const src of water.sources) {
      const fp = footprintSize(lookup(src.defId)!, src.rotation);
      const ring: number[] = [];
      for (let i = 0; i < fp.w; i++) {
        for (const yy of [src.y - 1, src.y + fp.h]) {
          const x = src.x + i;
          if (yy >= 0 && yy < H && x >= 0 && x < W) ring.push(yy * W + x);
        }
      }
      for (let j = 0; j < fp.h; j++) {
        for (const xx of [src.x - 1, src.x + fp.w]) {
          const y = src.y + j;
          if (xx >= 0 && xx < W && y >= 0 && y < H) ring.push(y * W + xx);
        }
      }
      if (ring.some((c) => roadAt[c])) continue; // déjà desservie
      const prev = new Int32Array(N).fill(-2);
      let fr: number[] = [];
      for (const c of ring) if (prev[c] === -2 && passable(c)) { prev[c] = -1; fr.push(c); }
      let hit = -1;
      // borne généreuse : une source peut être loin, et le chemin ne coûte que des cases de
      // relief que rien d'autre ne peut occuper
      for (let depth = 0; depth < 200 && fr.length && hit < 0; depth++) {
        const next: number[] = [];
        for (const c of fr) {
          for (const n of [c % W > 0 ? c - 1 : -1, c % W < W - 1 ? c + 1 : -1,
            c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
            if (n < 0 || prev[n] !== -2 || !passable(n)) continue;
            prev[n] = c;
            if (roadAt[n]) { hit = n; break; }
            next.push(n);
          }
          if (hit >= 0) break;
        }
        fr = next;
      }
      if (hit < 0) continue;
      for (let cur = hit; cur >= 0; cur = prev[cur]) {
        if (!roadAt[cur]) { roadAt[cur] = 1; occ[cur] = 0; }
      }
    }
  }

  // refresh FINAL de tous les types : les stamps tardifs ont pu invalider les BFS
  // précédents (routes écrasées) — le filtre maisons doit voir l'état exact.
  rebuildDemand();
  for (const tc of typeCov.values()) refreshType(tc);

  // --- MAISONS : DENSITÉ MAX + accounting MIXTE, aux VRAIES règles du jeu.
  // On remplit TOUT slot valide (fitsHouse+route). Le palier de chaque maison est décidé
  // par `needsModel` : seuil de SupplyWeight par catégorie, pas un ET sur tous les services
  // — et sa capacité vaut la somme des Population des besoins réellement remplis. Une
  // résidence sous-desservie ne disparaît pas, elle reste au palier qu'elle franchit.
  const types = [...typeCov.values()].filter((tc) => (placements.get(tc.def.id) ?? []).length > 0);
  const covArr = types.map((tc) => covByType.get(tc.def.id) ?? coveredOrigins(tc));

  const chain = residentialChainExtended(tierGuid); // base → cible
  const resIdSet = new Set(chain.map((t) => t.residenceId).filter((r): r is string => !!r));
  // L'évaluateur est scopé aux services RETENUS (`wanted`) : un type écarté ne compte ni
  // pour les seuils ni pour la capacité — c'est ce qui rendait le mode « seuils »
  // insatisfiable quand le masque exigeait encore les services écartés.
  const evaluator = compileTierEvaluator(chain, { goodsMet: true, relevant: wanted ?? undefined });
  // consommateurs d'eau raccordés (≥1 copie) : un type d'eau MORT n'est pas actif
  const connByDef = new Map<string, number>();
  for (const c of water?.consumers ?? []) {
    if (!c.connected) continue;
    const id = buildings.find((b) => b.uid === c.uid)?.defId;
    if (id) connByDef.set(id, (connByDef.get(id) ?? 0) + 1);
  }
  // un type d'eau est INACTIF seulement si l'eau A ÉTÉ routée (opts.water) et qu'aucune
  // copie n'est raccordée ; sans routage (planLattice autonome) on suppose actif (géom.)
  const activeType = types.map((tc) => !needsWater(tc.def) || !water || (connByDef.get(tc.def.id) ?? 0) > 0);
  const typeBit = types.map((tc) => evaluator.bitOf.get(tc.def.id)); // undefined = hors chaîne/écarté

  // Institutions RÉELLEMENT posées : leur effet de zone s'ajoute au bilan de chaque maison
  // qu'elles couvrent. Elles ne remplissent aucun besoin, donc aucun double comptage avec
  // les attributs des services (cf. economy/attributes.ts).
  const instTypes = types
    .map((tc, i) => ({ i, id: tc.def.id, fx: effectOf(tc.def.id) }))
    .filter((e) => instIds.includes(e.id) && !!e.fx);

  const placeHouses = (): Pick<LatticeResult, "houses" | "fullyCovered" | "tierCounts" | "residents" | "houseMoney" | "capByTier" | "attrsSum" | "plots"> => {
    let houses = 0, fullyCovered = 0, residents = 0, houseMoney = 0;
    const tierCounts: Record<string, number> = {};
    const capByTier: Record<string, number> = {};
    const attrsSum: Record<string, number> = {};
    for (const k of VITAL_ATTRS) attrsSum[k] = 0;
    const placed: (Weighed & {
      b: PlacedBuilding; money: number; guid: string; attrs: Record<string, number>;
      /** masque des services qui couvrent cette parcelle — sert à réévaluer la maison à un
       *  palier INFÉRIEUR lors de la cascade de main-d'œuvre */
      mask: number;
      /** attributs des institutions : indépendants du palier, donc constants par conversion */
      inst: Record<string, number>;
    })[] = [];
    const targetGuid = chain[chain.length - 1]?.guid ?? tierGuid;
    for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) {
      if (!fitsHouse(x, y) || !touchesRoad(x, y)) continue;
      const o = y * W + x;
      let coveredMask = 0;
      for (let t = 0; t < types.length; t++) {
        const b = typeBit[t];
        if (b !== undefined && activeType[t] && covArr[t][o]) coveredMask |= 1 << b;
      }
      const reach = evaluator.evaluate(coveredMask);
      // bilan d'attributs de CETTE maison : besoins remplis + institutions qui la couvrent.
      // Le malus de rang de cité s'ajoute plus bas (il dépend de la population totale).
      const inst: Record<string, number> = {};
      for (const e of instTypes) {
        if (!activeType[e.i] || !covArr[e.i][o]) continue;
        for (const [k, v] of Object.entries(e.fx!.attrs)) inst[k] = (inst[k] ?? 0) + v;
      }
      const attrs: Record<string, number> = { ...evaluator.attrsOf(coveredMask) };
      for (const [k, v] of Object.entries(inst)) attrs[k] = (attrs[k] ?? 0) + v;
      const defId = reach.tier.residenceId ?? residenceId;
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) occ[(y + j) * W + (x + i)] = 1;
      const b: PlacedBuilding = { uid: uid("lat"), defId, x, y, rotation: 0, locked: false };
      buildings.push(b);
      markAdj(x, y, rw, rh);
      placed.push({ b, key: o, cap: reach.cap, money: reach.money, guid: reach.tier.guid, attrs, mask: coveredMask, inst });
    }

    // Garde-fou de viabilité (cf. `optimizer/viability`) : les écartées sont démolies.
    const keep = viabilityGate
      ? viableSubset(placed, tier.region, { tolerance: opts.tolerance })
      : placed;
    if (keep.length !== placed.length) {
      const alive = new Set(keep.map((p) => p.b.uid));
      const gone = new Set(placed.filter((p) => !alive.has(p.b.uid)).map((p) => p.b.uid));
      const kept = buildings.filter((b) => !gone.has(b.uid));
      buildings.length = 0;
      buildings.push(...kept);
      // les emplacements libérés redeviennent constructibles pour l'élagage des routes
      for (const p of placed) {
        if (!gone.has(p.b.uid)) continue;
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
          const c = (p.b.y + j) * W + (p.b.x + i);
          if (grid.usable[c]) occ[c] = 0;
        }
      }
    }

    const plots: HousePlot[] = [];
    for (const p of keep) {
      houses++;
      residents += p.cap;
      houseMoney += p.money;
      tierCounts[p.guid] = (tierCounts[p.guid] ?? 0) + 1;
      capByTier[p.guid] = (capByTier[p.guid] ?? 0) + p.cap;
      if (p.guid === targetGuid) fullyCovered++;
      for (const k of VITAL_ATTRS) attrsSum[k] += p.attrs[k] ?? 0;

      // PALIERS ATTEIGNABLES sur cette parcelle. Laisser une maison à un palier inférieur
      // alors que sa desserte lui permettrait mieux est un état de jeu parfaitement légal :
      // la montée de palier est un acte MANUEL du joueur. C'est ce qui rend la cascade de
      // main-d'œuvre possible sans rien démolir — les 9 résidences font 3×3, une conversion
      // n'est qu'un changement de `defId`.
      const opts: HousePlot["opts"] = [];
      for (let k = 0; k < chain.length; k++) {
        const r = evaluator.evaluateAt(k, p.mask);
        if (!r || !r.tier.residenceId) continue;
        const attrs: Record<string, number> = {};
        for (const key of VITAL_ATTRS) {
          attrs[key] = (evaluator.attrsAt(k, p.mask)[key] ?? 0) + (p.inst[key] ?? 0);
        }
        opts.push({ guid: r.tier.guid, defId: r.tier.residenceId, cap: r.cap, attrs });
      }
      plots.push({ uid: p.b.uid, guid: p.guid, opts });
    }
    return { houses, fullyCovered, tierCounts, residents, houseMoney, capByTier, attrsSum, plots };
  };

  // ═══ PHASE élagage routes : adjacentes aux bâtiments + chemins maison→service ═══
  const pruneRoads = (): RoadTile[] => {
    const keep = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (roadAt[i] && bldAdj[i]) keep[i] = 1;
    const housesPlaced = buildings.filter((b) => resIdSet.has(b.defId));
    const chainKept = new Map<string, Uint8Array>();
    for (const t of types) chainKept.set(t.def.id, new Uint8Array(N));
    for (const hb of housesPlaced) {
      const anchors = orthoRoadCells(hb.x, hb.y, rw, rh);
      for (const t of types) {
        const ck = chainKept.get(t.def.id)!;
        for (const a of anchors) {
          if (!t.reach[a]) continue;
          let cur = a;
          while (cur >= 0 && !ck[cur]) { ck[cur] = 1; keep[cur] = 1; cur = t.parent[cur]; }
          break;
        }
      }
    }
    // ═══ L'ÉLAGAGE DOIT CONNAÎTRE LA RACINE DU RÉSEAU ═════════════════════════════════
    //
    // `keep` réunit deux ensembles — routes adjacentes à un bâtiment, chemins maison→service
    // — sans que rien ne garantisse qu'ils tiennent ENSEMBLE, ni surtout qu'ils tiennent au
    // COMPTOIR. Résultat mesuré sur celtic_island_large_05 : 96 composantes de route dans le
    // plan final, un tronc de 12 693 cases et 1 240 hors du réseau enraciné, pour 61 services
    // inactifs en jeu — dont 52 avaient bel et bien une route adjacente, simplement pas dans
    // la bonne composante.
    //
    // Deux corrections ont échoué avant celle-ci, et pour la MÊME raison : elles rendaient des
    // routes sans savoir de quel côté du comptoir. Reconnecter autour de « la plus grosse
    // composante » a fait passer les services isolés de 61 à 147 ; donner la réserve élaguée à
    // la réparation d'après coup, de 61 à 166. Ce n'est pas de route qu'il manquait.
    //
    // Ce qui manquait, c'est la RACINE. Sa position est fixée avant les moteurs par
    // `reserveKontor` et arrive ici dans `opts.reserved` : on ancre donc l'élagage dessus.
    // Restituer une case ne coûte rien en sol — l'élagage passe après `placeHouses` sans
    // toucher `roadAt`, donc aucune maison ne s'y est posée.
    const R = opts.reserved;
    if (R) {
      const rootRing: number[] = [];
      for (let i = 0; i < R.w; i++) {
        for (const yy of [R.y - 1, R.y + R.h]) {
          const x = R.x + i;
          if (yy >= 0 && yy < H && x >= 0 && x < W) rootRing.push(yy * W + x);
        }
      }
      for (let j = 0; j < R.h; j++) {
        for (const xx of [R.x - 1, R.x + R.w]) {
          const y = R.y + j;
          if (xx >= 0 && xx < W && y >= 0 && y < H) rootRing.push(y * W + xx);
        }
      }
      const roots = rootRing.filter((c) => roadAt[c]);
      if (roots.length) {
        const nb4 = (c: number): number[] => {
          const x = c % W, y = (c / W) | 0;
          const out: number[] = [];
          if (x > 0) out.push(c - 1);
          if (x < W - 1) out.push(c + 1);
          if (y > 0) out.push(c - W);
          if (y < H - 1) out.push(c + W);
          return out;
        };
        // chemins sur le peigne COMPLET, élaguées comprises, depuis l'anneau du comptoir
        const parent = new Int32Array(N).fill(-2);
        let fr: number[] = [...roots];
        for (const c of roots) parent[c] = -1;
        while (fr.length) {
          const next: number[] = [];
          for (const c of fr) {
            for (const n of nb4(c)) {
              if (roadAt[n] && parent[n] === -2) { parent[n] = c; next.push(n); }
            }
          }
          fr = next;
        }
        // ce que `keep` relie DÉJÀ à la racine
        const rooted = new Uint8Array(N);
        const growRooted = (from: number[]) => {
          let f = from.filter((c) => keep[c] && !rooted[c]);
          for (const c of f) rooted[c] = 1;
          while (f.length) {
            const next: number[] = [];
            for (const c of f) {
              for (const n of nb4(c)) if (keep[n] && !rooted[n]) { rooted[n] = 1; next.push(n); }
            }
            f = next;
          }
        };
        for (const c of roots) keep[c] = 1; // l'accès du comptoir n'est jamais élagué
        growRooted(roots);
        for (let i = 0; i < N; i++) {
          if (!keep[i] || rooted[i] || parent[i] === -2) continue;
          // remonter vers la racine en restituant, jusqu'à retomber sur du déjà relié
          const path: number[] = [];
          for (let cur = parent[i]; cur >= 0 && !rooted[cur]; cur = parent[cur]) path.push(cur);
          for (const c of path) keep[c] = 1;
          growRooted([i, ...path]);
        }
      }
    }

    const roads: RoadTile[] = [];
    for (let i = 0; i < N; i++) if (keep[i]) roads.push({ x: i % W, y: (i / W) | 0 });
    return roads;
  };

  const placed = placeHouses();
  const roads = pruneRoads();
  return { buildings, roads, fields: [], ...placed, servicesPlaced, water };
}
