import { uid } from "../model/factories";
import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { economy } from "../economy/economy";
import type { DefLookup } from "../engine/rules";

const SMALL_RANGE_MAX = 40; // services portée <= 40 = locaux

// Portée de PLANIFICATION = streetRange (mécanique réelle = distance LE LONG DES
// RUES, cf. GAME_MECHANICS.md §1). radius.range en repli.
const rangeOf = (d: BuildingDef): number => d.streetRange || d.radius?.range || 0;

export interface PackOpts {
  /** Seuil de couverture par service (0..1, défaut 1). */
  coverageFloor?: number;
  /** Restreint les services à placer (mode seuils). Absent = tous les services du tier. */
  serviceIds?: string[];
}

export interface PackResult {
  buildings: PlacedBuilding[]; // services + maisons
  roads: RoadTile[];
  fields: FieldTile[];
  houses: number;
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
  if (x1 < 0) return { buildings: [], roads: [], fields: [], houses: 0, servicesPlaced: {} };
  const gx = Math.round(sumX / landCount), gy = Math.round(sumY / landCount);

  // --- peigne de routes (identique districtPlan) : double-rangée + épines ---
  const STEPH = 2 * rh + 1;
  const minSmallRange = Math.min(...small.map(rangeOf), 28);
  const STEPV = Math.max(8, Math.min(24, minSmallRange - STEPH - 2));
  const layRoad = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (occ[i] || roadAt[i]) return;
    roadAt[i] = 1;
  };
  for (let y = y0; y <= y1; y += STEPH) for (let x = x0; x <= x1; x++) layRoad(x, y);
  for (let x = x0; x <= x1; x += STEPV) for (let y = y0; y <= y1; y++) layRoad(x, y);

  // --- helpers placement ---
  const buildings: PlacedBuilding[] = [];
  const servicesPlaced: Record<string, number> = {};
  const placements = new Map<string, { x: number; y: number; w: number; h: number }[]>();

  const fitsBld = (w: number, h: number, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (y + j) * W + (x + i);
      if (!grid.usable[c] || occ[c]) return false; // routes OK (écrasées)
    }
    return true;
  };
  const fitsHouse = (x: number, y: number): boolean => {
    if (x < x0 || y < y0 || x + rw - 1 > x1 || y + rh - 1 > y1) return false;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const c = (y + j) * W + (x + i);
      if (!grid.usable[c] || occ[c] || roadAt[c]) return false;
    }
    return true;
  };
  const orthoRoadCells = (x: number, y: number, w: number, h: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < w; i++) {
      if (y - 1 >= 0 && roadAt[(y - 1) * W + (x + i)]) out.push((y - 1) * W + (x + i));
      if (y + h < H && roadAt[(y + h) * W + (x + i)]) out.push((y + h) * W + (x + i));
    }
    for (let j = 0; j < h; j++) {
      if (x - 1 >= 0 && roadAt[(y + j) * W + (x - 1)]) out.push((y + j) * W + (x - 1));
      if (x + w < W && roadAt[(y + j) * W + (x + w)]) out.push((y + j) * W + (x + w));
    }
    return out;
  };
  const touchesRoad = (x: number, y: number): boolean => orthoRoadCells(x, y, rw, rh).length > 0;
  const markAdj = (x: number, y: number, w: number, h: number) => {
    for (let i = 0; i < w; i++) {
      if (y - 1 >= 0) bldAdj[(y - 1) * W + (x + i)] = 1;
      if (y + h < H) bldAdj[(y + h) * W + (x + i)] = 1;
    }
    for (let j = 0; j < h; j++) {
      if (x - 1 >= 0) bldAdj[(y + j) * W + (x - 1)] = 1;
      if (x + w < W) bldAdj[(y + j) * W + (x + w)] = 1;
    }
  };

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

  // anneau de route périmétrique : reconnecte les lignes du peigne coupées + accès route
  const layRing = (x: number, y: number, w: number, h: number): number[] => {
    const ring: number[] = [];
    const tryLay = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = py * W + px;
      if (roadAt[i]) { ring.push(i); return; }
      if (occ[i] || !grid.usable[i]) return;
      roadAt[i] = 1; ring.push(i);
    };
    for (let i = -1; i <= w; i++) { tryLay(x + i, y - 1); tryLay(x + i, y + h); }
    for (let j = 0; j < h; j++) { tryLay(x - 1, y + j); tryLay(x + w, y + j); }
    return ring;
  };
  const connectRing = (ring: number[]) => {
    if (!ring.length) return;
    const ringSet = new Set(ring);
    const seen = new Set<number>(ring);
    let fr = [...ring];
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) {
        const x = c % W, y = (c / W) | 0;
        for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
          if (nb < 0 || !roadAt[nb] || seen.has(nb)) continue;
          if (!ringSet.has(nb)) return; // connecté au réseau
          seen.add(nb); next.push(nb);
        }
      }
      fr = next;
    }
    const maxDepth = 3 * STEPH;
    const prev = new Map<number, number>();
    let frontier: number[] = [];
    for (const c of ring) { prev.set(c, -1); frontier.push(c); }
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: number[] = [];
      for (const c of frontier) {
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const px = cx + dx, py = cy + dy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const n = py * W + px;
          if (prev.has(n)) continue;
          if (roadAt[n] && !ringSet.has(n)) {
            let cur = c;
            while (cur >= 0 && !roadAt[cur]) { roadAt[cur] = 1; cur = prev.get(cur)!; }
            return;
          }
          if (roadAt[n] || !grid.usable[n] || occ[n]) continue;
          prev.set(n, c);
          next.push(n);
        }
      }
      frontier = next;
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

  // BFS multi-source le long des routes depuis toutes les copies d'un type.
  const bfsType = (tc: TypeCov) => {
    tc.reach = new Uint8Array(N);
    tc.reachList = [];
    tc.parent = new Int32Array(N).fill(-2);
    const dist = new Int32Array(N).fill(-1);
    let frontier: number[] = [];
    for (const p of placements.get(tc.def.id) ?? []) {
      for (const c of orthoRoadCells(p.x, p.y, p.w, p.h)) {
        if (dist[c] >= 0) continue;
        dist[c] = 1; tc.parent[c] = -1; tc.reach[c] = 1;
        tc.reachList.push(c); frontier.push(c);
      }
    }
    let d = 1;
    while (frontier.length && d < tc.range) {
      const next: number[] = [];
      for (const c of frontier) {
        const x = c % W, y = (c / W) | 0;
        for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
          if (nb < 0 || !roadAt[nb] || dist[nb] >= 0) continue;
          dist[nb] = d + 1; tc.parent[nb] = c; tc.reach[nb] = 1;
          tc.reachList.push(nb); next.push(nb);
        }
      }
      frontier = next; d++;
    }
  };
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
  const sat = new Int32Array((W + 1) * (H + 1));
  const buildSAT = (mask: Int32Array | Uint8Array) => {
    for (let y = 0; y < H; y++) {
      const r0 = y * (W + 1), r1 = (y + 1) * (W + 1);
      for (let x = 0; x < W; x++) sat[r1 + x + 1] = mask[y * W + x] + sat[r0 + x + 1] + sat[r1 + x] - sat[r0 + x];
    }
  };
  const rectSum = (xa: number, ya: number, xb: number, yb: number): number => {
    xa = Math.max(0, xa); ya = Math.max(0, ya); xb = Math.min(W - 1, xb); yb = Math.min(H - 1, yb);
    if (xa > xb || ya > yb) return 0;
    return sat[(yb + 1) * (W + 1) + xb + 1] - sat[ya * (W + 1) + xb + 1] - sat[(yb + 1) * (W + 1) + xa] + sat[ya * (W + 1) + xa];
  };
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
    for (let iter = 0; iter < 60; iter++) {
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

  // ===================== FINALISATION =====================
  // recalcul propre de la couverture de toutes les survivantes
  const types = [...typeCov.values()].filter((tc) => (placements.get(tc.def.id) ?? []).length > 0);
  for (const tc of types) { tc.covered = new Uint8Array(houses.length); bfsType(tc); markCovered(tc); }

  // mode 100% : retirer les maisons non couvertes par TOUS les types.
  // floor<1 : garder le partiel tant que chaque type reste ≥ floor.
  const alive = houses.map((h) => h.alive);
  if (floor >= 1) {
    for (let i = 0; i < houses.length; i++) {
      if (!alive[i]) continue;
      for (const tc of types) if (!tc.covered[i]) { alive[i] = false; break; }
    }
  } else {
    // greedy : trier les maisons par nb de types couverts décroissant, garder tant
    // que chaque type reste ≥ floor sur l'ensemble gardé
    const order2 = houses.map((_, i) => i).filter((i) => alive[i])
      .sort((a, b) => {
        let ca = 0, cb = 0;
        for (const tc of types) { if (tc.covered[a]) ca++; if (tc.covered[b]) cb++; }
        return cb - ca;
      });
    const covCount = new Map<string, number>();
    let kept = 0;
    const keepSet = new Set<number>();
    for (const i of order2) {
      // tenter de garder i : chaque type doit rester ≥ floor
      let ok = true;
      for (const tc of types) {
        const c = (covCount.get(tc.def.id) ?? 0) + (tc.covered[i] ? 1 : 0);
        if (c < floor * (kept + 1) - 1e-9) { ok = false; break; }
      }
      if (!ok) continue;
      keepSet.add(i); kept++;
      for (const tc of types) if (tc.covered[i]) covCount.set(tc.def.id, (covCount.get(tc.def.id) ?? 0) + 1);
    }
    for (let i = 0; i < houses.length; i++) if (alive[i] && !keepSet.has(i)) alive[i] = false;
  }

  // émettre les maisons gardées
  let houseCount = 0;
  for (let i = 0; i < houses.length; i++) {
    if (!alive[i]) continue;
    const h = houses[i];
    buildings.push({ uid: uid("pack"), defId: tier.residenceId, x: h.x, y: h.y, rotation: 0, locked: false });
    houseCount++;
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

  return { buildings, roads, fields: [], houses: houseCount, servicesPlaced };
}
