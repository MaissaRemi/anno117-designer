import { uid } from "../model/factories";
import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { economy, residentialChainExtended } from "../economy/economy";
import { compileTierEvaluator } from "../economy/needsModel";
import { VITAL_ATTRS } from "../economy/attributes";
import type { DefLookup } from "../engine/rules";
import type { HousePlot } from "./planLattice";
import { uniqueCap } from "../economy/uniques";
import { makeStreetGrid } from "./streetGrid";

const SMALL_RANGE_MAX = 40; // services portée <= 40 = locaux

// Portée de PLANIFICATION = streetRange (mécanique réelle = distance LE LONG DES
// RUES, cf. GAME_MECHANICS.md §1). radius.range en repli.
const rangeOf = (d: BuildingDef): number => d.streetRange || d.radius?.range || 0;

export interface PackOpts {
  /** Seuil de couverture par service (0..1, défaut 1). */
  coverageFloor?: number;
  /** Restreint les services à placer (mode seuils). Absent = tous les services du tier. */
  serviceIds?: string[];
  /** Permis détenus en partie, par GUID de permis (cf. `economy/uniques`). */
  permits?: Record<string, number>;
}

export interface PackResult {
  buildings: PlacedBuilding[]; // services + maisons
  /** Parcelles et paliers atteignables — interface commune avec planLattice. packPlan ne
   *  produit pas cette information : la cascade de main-d'œuvre ne s'applique donc pas aux
   *  plans qu'il génère, et le déficit éventuel est simplement signalé. */
  plots?: HousePlot[];
  roads: RoadTile[];
  fields: FieldTile[];
  houses: number;
  fullyCovered: number; // maisons ayant atteint le tier-cible
  /** Maisons par tier ATTEINT (guid → nb) : accounting MIXTE, comme planLattice. */
  tierCounts: Record<string, number>;
  /** Habitants TOTAUX = Σ capacité RÉELLE par maison (cf. economy/needsModel). */
  residents: number;
  /** Taxe/min cumulée des maisons. */
  houseMoney: number;
  /** Capacité cumulée PAR PALIER atteint (guid → habitants). */
  capByTier: Record<string, number>;
  /** Σ des attributs vitaux sur les maisons, hors rang de cité (cf. LatticeResult.attrsSum).
   *  packPlan ne pose pas d'institution : ce sont les seuls attributs des besoins. */
  attrsSum: Record<string, number>;
  servicesPlaced: Record<string, number>;
  /** Réseau d'eau intégré — jamais produit par packPlan (l'eau y serait routée
   *  APRÈS les maisons, sans corridors) ; présent pour l'interface commune des
   *  moteurs : le portfolio fait `dist.water ?? planWater(...)` uniformément. */
  water?: import("./waterPlan").WaterPlanResult;
}

/**
 * Planner v4 — HOUSES-FIRST + MIN-COVER (cf. session refonte placement, fil 2+B).
 *
 * Inversion du paradigme service-first de districtPlan :
 *  1. Peigne de routes + on POSE LE MAXIMUM DE MAISONS d'abord (la densité = la
 *     valeur ; on ne couvre pas des slots potentiels qui resteront vides).
 *  2. MIN-SET-COVER des services sur les maisons RÉELLES, gros (portée 50-70 →
 *     quelques copies blanketent) puis petits. Un service DÉPLACE les maisons sous
 *     son emprise (coût ~1-9 maisons pour en couvrir des dizaines → net positif).
 *  3. Finalisation : recalcul couverture sur les survivantes, on retire les maisons
 *     non couvertes par TOUS les types (mode 100%) ou on garde le partiel (floor<1).
 *  4. Élagage des routes (adjacentes aux bâtiments + chemins maison→service).
 *
 * Couverture = BFS le long des rues, sémantique identique à streetCoverage de
 * l'analyseur (graines = routes ortho-adjacentes à l'emprise, dist ≤ range, maison
 * couverte ssi une case d'emprise est ortho-adjacente à une route atteinte).
 */
export function planPacked(
  grid: GridShape,
  tierGuid: string,
  lookup: DefLookup,
  opts: PackOpts = {},
): PackResult {
  const floor = Math.min(1, Math.max(0.3, opts.coverageFloor ?? 1));
  const tier = economy.tiers.find((t) => t.guid === tierGuid);
  if (!tier || !tier.residenceId) throw new Error("Tier-cible invalide.");
  /** Compteur du quota d'unicité PARTAGÉ par `uniqueType` (cf. planLattice). */
  const uniqueUsed = new Map<string, number>();
  const resDef = lookup(tier.residenceId)!;
  const rw = resDef.size.w, rh = resDef.size.h;
  const W = grid.w, H = grid.h, N = W * H;

  // services requis à portée connue, petits / gros
  const wanted = opts.serviceIds ? new Set(opts.serviceIds) : null;
  const svcDefs = [...new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b))]
    .filter((id) => !wanted || wanted.has(id))
    .map((id) => lookup(id))
    .filter((d): d is BuildingDef => !!d && rangeOf(d) > 0);
  const small = svcDefs.filter((d) => rangeOf(d) <= SMALL_RANGE_MAX);
  const big = svcDefs.filter((d) => rangeOf(d) > SMALL_RANGE_MAX);

  // occupation : 1 = bloqué (hors-terre / bâtiment / maison). routes à part.
  const occ = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!grid.usable[i]) occ[i] = 1;
  const roadAt = new Uint8Array(N);
  const bldAdj = new Uint8Array(N); // cases 4-adjacentes à un bâtiment (élagage)

  // bbox terre + centroïde
  let x0 = W, y0 = H, x1 = -1, y1 = -1, landCount = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid.usable[y * W + x]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    landCount++; sumX += x; sumY += y;
  }
  if (x1 < 0) return { buildings: [], roads: [], fields: [], houses: 0, fullyCovered: 0, tierCounts: {}, residents: 0, houseMoney: 0, capByTier: {}, attrsSum: {}, servicesPlaced: {} };
  const gx = Math.round(sumX / landCount), gy = Math.round(sumY / landCount);

  // --- peigne de routes (identique districtPlan) : double-rangée + épines ---
  const STEPH = 2 * rh + 1;
  const minSmallRange = Math.min(...small.map(rangeOf), 28);
  const STEPV = Math.max(8, Math.min(24, minSmallRange - STEPH - 2));
  // primitives de grille/rue partagées (cf. streetGrid.ts). packPlan : pas de hooks
  // (ni anti-emmurement bldAdj, ni prises d'eau — propres à planLattice).
  const sg = makeStreetGrid({ W, H, occ, roadAt, bldAdj, usable: grid.usable, rw, rh, x0, y0, x1, y1, STEPH });
  const { fitsBld, fitsHouse, orthoRoadCells, touchesRoad, markAdj, layRoad, layRing, connectRing } = sg;
  for (let y = y0; y <= y1; y += STEPH) for (let x = x0; x <= x1; x++) layRoad(x, y);
  for (let x = x0; x <= x1; x += STEPV) for (let y = y0; y <= y1; y++) layRoad(x, y);

  // --- helpers placement ---
  const buildings: PlacedBuilding[] = [];
  const servicesPlaced: Record<string, number> = {};
  const placements = new Map<string, { x: number; y: number; w: number; h: number }[]>();

  // --- maisons : structure + déplacement ---
  interface House { x: number; y: number; alive: boolean; }
  const houses: House[] = [];
  const houseOcc = new Int32Array(N).fill(-1); // index maison vivante par case d'emprise, -1 sinon

  const placeHouse = (x: number, y: number) => {
    const idx = houses.length;
    houses.push({ x, y, alive: true });
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const c = (y + j) * W + (x + i);
      occ[c] = 1; houseOcc[c] = idx;
    }
    markAdj(x, y, rw, rh);
  };
  // libère une maison (déplacée par un service) : occ + houseOcc remis à zéro
  const removeHouse = (idx: number) => {
    const hh = houses[idx];
    if (!hh.alive) return;
    hh.alive = false;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const c = (hh.y + j) * W + (hh.x + i);
      if (houseOcc[c] === idx) { houseOcc[c] = -1; occ[c] = grid.usable[c] ? 0 : 1; }
    }
  };

  // --- état couverture STREET par type ---
  interface TypeCov {
    def: BuildingDef;
    range: number;
    reach: Uint8Array; // cases route atteintes
    reachList: number[];
    parent: Int32Array; // arbre BFS (élagage)
    covered: Uint8Array; // par index maison
  }
  const typeCov = new Map<string, TypeCov>();
  for (const d of svcDefs) typeCov.set(d.id, {
    def: d, range: rangeOf(d), reach: new Uint8Array(N), reachList: [], parent: new Int32Array(N), covered: new Uint8Array(0),
  });

  // BFS distance-rue partagé (cf. streetGrid.ts) — wrapper conservant la signature locale.
  const bfsType = (tc: TypeCov) => sg.bfsType(tc, placements);
  // maison couverte ssi une case d'emprise est ortho-adjacente à une route atteinte
  // (= cases servies de streetCoverage). On scanne les routes atteintes -> voisins maison.
  const markCovered = (tc: TypeCov) => {
    for (const c of tc.reachList) {
      const x = c % W, y = (c / W) | 0;
      for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
        if (nb < 0) continue;
        const idx = houseOcc[nb];
        if (idx >= 0 && houses[idx].alive && !tc.covered[idx]) tc.covered[idx] = 1;
      }
    }
  };

  const stamp = (def: BuildingDef, x: number, y: number) => {
    for (let j = 0; j < def.size.h; j++) for (let i = 0; i < def.size.w; i++) {
      const c = (y + j) * W + (x + i);
      const hidx = houseOcc[c];
      if (hidx >= 0) removeHouse(hidx); // déplace la maison sous l'emprise
      occ[c] = 1;
      if (roadAt[c]) roadAt[c] = 0;
    }
    buildings.push({ uid: uid("pack"), defId: def.id, x, y, rotation: 0, locked: false });
    if (def.uniqueType) uniqueUsed.set(def.uniqueType, (uniqueUsed.get(def.uniqueType) ?? 0) + 1);
    servicesPlaced[def.id] = (servicesPlaced[def.id] ?? 0) + 1;
    const arr = placements.get(def.id) ?? [];
    arr.push({ x, y, w: def.size.w, h: def.size.h });
    placements.set(def.id, arr);
    markAdj(x, y, def.size.w, def.size.h);
    const ring = layRing(x, y, def.size.w, def.size.h);
    if (ring.length) connectRing(ring);
  };
  const placeNear = (def: BuildingDef, tx: number, ty: number, maxRad: number): boolean => {
    for (let r = 0; r <= maxRad; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (fitsBld(def.size.w, def.size.h, tx + dx, ty + dy)) { stamp(def, tx + dx, ty + dy); return true; }
      }
    }
    return false;
  };

  // ===================== PHASE A : MAX MAISONS =====================
  for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) {
    if (fitsHouse(x, y) && touchesRoad(x, y)) placeHouse(x, y);
  }

  // ===================== PHASE B : MIN-COVER SERVICES =====================
  // tables de sommes (proxy euclidien pour CHOISIR les positions)
  const { buildSAT, rectSum } = sg.makeSAT();
  const proxyQ = (range: number): number => Math.max(2, Math.floor((range * 0.7) / Math.SQRT2));

  // masque vivant des origines maison (1 = maison vivante à cette origine)
  const aliveMask = new Int32Array(N);
  const rebuildAliveMask = () => {
    aliveMask.fill(0);
    for (let i = 0; i < houses.length; i++) if (houses[i].alive) aliveMask[houses[i].y * W + houses[i].x] = 1;
  };

  const PEN = 2; // malus = maisons déplacées par l'emprise (préfère les trous)

  // couvre un type par glouton min-cover sur les maisons vivantes non couvertes
  const coverType = (tc: TypeCov) => {
    tc.covered = new Uint8Array(houses.length);
    // recouvre depuis d'éventuelles copies déjà posées (garantie)
    bfsType(tc); markCovered(tc);
    const q = proxyQ(tc.range);
    const stride = 3;
    // Le quota d'unicité est PARTAGÉ par `uniqueType`, pas par bâtiment : les seize autels
    // de dieux se partagent les permis de sanctuaire. Borner à 1 par bâtiment posait une
    // copie PAR DIVINITÉ — six autels là où le jeu en autorise deux.
    const used = tc.def.uniqueType ? (uniqueUsed.get(tc.def.uniqueType) ?? 0) : 0;
    const maxIters = Math.max(0, Math.min(60, uniqueCap(tc.def, opts.permits) - used));
    for (let iter = 0; iter < maxIters; iter++) {
      // uncov = maisons vivantes non couvertes (origines) ; cible du glouton
      const uncov = new Int32Array(N);
      let uncovN = 0, totalAlive = 0;
      for (let i = 0; i < houses.length; i++) {
        const h = houses[i];
        if (!h.alive) continue;
        totalAlive++;
        if (!tc.covered[i]) { uncov[h.y * W + h.x] = 1; uncovN++; }
      }
      if (totalAlive === 0) return;
      if (uncovN <= totalAlive * (1 - floor) + 1e-9) return; // seuil atteint
      // choix de position : max couverture proxy − PEN·(maisons déplacées)
      buildSAT(uncov);
      let bx = -1, by = -1, bestCov = 0;
      for (let cy = y0; cy + tc.def.size.h - 1 <= y1; cy += stride) {
        for (let cx = x0; cx + tc.def.size.w - 1 <= x1; cx += stride) {
          if (!fitsBld(tc.def.size.w, tc.def.size.h, cx, cy)) continue;
          const ccx = cx + tc.def.size.w / 2, ccy = cy + tc.def.size.h / 2;
          const cov = rectSum(Math.round(ccx - q), Math.round(ccy - q), Math.round(ccx + q), Math.round(ccy + q));
          if (cov > bestCov) { bestCov = cov; bx = cx; by = cy; }
        }
      }
      if (bx < 0 || bestCov <= 0) {
        // aucune position libre ne couvre : autoriser le déplacement (proxy sur aliveMask
        // pondéré, choisir la meilleure même si elle écrase quelques maisons)
        rebuildAliveMask(); buildSAT(uncov);
        let g = -Infinity;
        for (let cy = y0; cy + tc.def.size.h - 1 <= y1; cy += stride) {
          for (let cx = x0; cx + tc.def.size.w - 1 <= x1; cx += stride) {
            // ignore occ maison (déplaçable) mais pas hors-terre / service
            let blocked = false;
            for (let j = 0; j < tc.def.size.h && !blocked; j++) for (let i = 0; i < tc.def.size.w; i++) {
              const c = (cy + j) * W + (cx + i);
              if (!grid.usable[c] || (occ[c] && houseOcc[c] < 0)) { blocked = true; break; }
            }
            if (blocked) continue;
            const ccx = cx + tc.def.size.w / 2, ccy = cy + tc.def.size.h / 2;
            const cov = rectSum(Math.round(ccx - q), Math.round(ccy - q), Math.round(ccx + q), Math.round(ccy + q));
            // malus = maisons sous l'emprise
            let disp = 0;
            for (let j = 0; j < tc.def.size.h; j++) for (let i = 0; i < tc.def.size.w; i++) {
              if (houseOcc[(cy + j) * W + (cx + i)] >= 0) disp++;
            }
            const score = cov - PEN * (disp / (rw * rh));
            if (score > g && cov > 0) { g = score; bx = cx; by = cy; bestCov = cov; }
          }
        }
        if (bx < 0 || bestCov <= 0) return; // vraiment rien
      }
      const prevCov = tc.covered.slice();
      stamp(tc.def, bx, by);
      bfsType(tc);
      markCovered(tc);
      let net = 0;
      for (let i = 0; i < houses.length; i++) if (houses[i].alive && tc.covered[i] && !prevCov[i]) net++;
      if (net < 1) return; // copie inutile -> stop ce type
    }
  };

  // GROS d'abord (portée énorme → peu de copies, déplacent un bloc mais couvrent large),
  // puis PETITS. Au sein, du plus grand au plus petit (l'espace contigu d'abord).
  const order = [...big.sort((a, b) => b.size.w * b.size.h - a.size.w * a.size.h),
                 ...small.sort((a, b) => rangeOf(a) - rangeOf(b))];
  for (const d of order) coverType(typeCov.get(d.id)!);

  // garantie : tout type requis à 0 copie posé près du centroïde
  for (const d of svcDefs) {
    if (!servicesPlaced[d.id]) {
      placeNear(d, gx, gy, Math.max(W, H));
      const tc = typeCov.get(d.id)!;
      tc.covered = new Uint8Array(houses.length);
      bfsType(tc); markCovered(tc);
    }
  }

  // ===================== FINALISATION — DENSITÉ MAX + accounting MIXTE =====================
  // recalcul propre de la couverture de toutes les survivantes
  const types = [...typeCov.values()].filter((tc) => (placements.get(tc.def.id) ?? []).length > 0);
  for (const tc of types) { tc.covered = new Uint8Array(houses.length); bfsType(tc); markCovered(tc); }

  // aucune maison jetée : chaque maison vivante prend le palier dont elle franchit les
  // seuils de SupplyWeight (cf. economy/needsModel — la vraie règle du jeu), et sa capacité
  // vaut la somme des Population des besoins remplis. (packPlan ne route pas l'eau ici →
  // services d'eau supposés actifs ; islandPlan disqualifie ce candidat si son réseau d'eau
  // ne tient pas.)
  const chain = residentialChainExtended(tierGuid);
  const evaluator = compileTierEvaluator(chain, { goodsMet: true, relevant: wanted ?? undefined });
  const typeBit = types.map((tc) => evaluator.bitOf.get(tc.def.id));
  const targetGuid = chain[chain.length - 1]?.guid ?? tierGuid;
  const alive = houses.map((h) => h.alive);
  const tierCounts: Record<string, number> = {};
  const capByTier: Record<string, number> = {};
  const attrsSum: Record<string, number> = {};
  for (const k of VITAL_ATTRS) attrsSum[k] = 0;
  let houseCount = 0, fullyCovered = 0, residents = 0, houseMoney = 0;
  for (let i = 0; i < houses.length; i++) {
    if (!alive[i]) continue;
    let coveredMask = 0;
    for (let t = 0; t < types.length; t++) {
      const b = typeBit[t];
      if (b !== undefined && types[t].covered[i]) coveredMask |= 1 << b;
    }
    const reach = evaluator.evaluate(coveredMask);
    const at = evaluator.attrsOf(coveredMask);
    for (const k of VITAL_ATTRS) attrsSum[k] += at[k] ?? 0;
    const h = houses[i];
    buildings.push({ uid: uid("pack"), defId: reach.tier.residenceId ?? tier.residenceId, x: h.x, y: h.y, rotation: 0, locked: false });
    houseCount++;
    residents += reach.cap;
    houseMoney += reach.money;
    tierCounts[reach.tier.guid] = (tierCounts[reach.tier.guid] ?? 0) + 1;
    capByTier[reach.tier.guid] = (capByTier[reach.tier.guid] ?? 0) + reach.cap;
    if (reach.tier.guid === targetGuid) fullyCovered++;
  }

  // ===================== ÉLAGAGE ROUTES =====================
  // routes adjacentes aux bâtiments + chemins BFS maison→service (distances intactes)
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (roadAt[i] && bldAdj[i]) keep[i] = 1;
  const chainKept = new Map<string, Uint8Array>();
  for (const t of types) chainKept.set(t.def.id, new Uint8Array(N));
  for (let i = 0; i < houses.length; i++) {
    if (!alive[i]) continue;
    const h = houses[i];
    const anchors = orthoRoadCells(h.x, h.y, rw, rh);
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
  const roads: RoadTile[] = [];
  for (let i = 0; i < N; i++) if (keep[i]) roads.push({ x: i % W, y: (i / W) | 0 });

    return { buildings, roads, fields: [], houses: houseCount, fullyCovered, tierCounts, residents, houseMoney, capByTier, attrsSum, servicesPlaced };
}
