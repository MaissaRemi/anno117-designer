import { uid } from "../model/factories";
import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { economy } from "../economy/economy";
import type { DefLookup } from "../engine/rules";
import { needsWater, planWater, type WaterPlanResult } from "./waterPlan";

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
  debug?: (msg: string) => void; // instrumentation (tests/diag)
}

export interface LatticeResult {
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  fields: FieldTile[];
  houses: number;
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
  const svcDefs = [...new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b))]
    .filter((id) => !wanted || wanted.has(id))
    .map((id) => lookup(id))
    .filter((d): d is BuildingDef => !!d && rangeOf(d) > 0)
    .sort((a, b) => rangeOf(b) - rangeOf(a)); // grand → petit (espace contigu d'abord)

  const occ = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!grid.usable[i]) occ[i] = 1;
  const roadAt = new Uint8Array(N);
  const bldAdj = new Uint8Array(N);

  let x0 = W, y0 = H, x1 = -1, y1 = -1, landCount = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid.usable[y * W + x]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    landCount++; sumX += x; sumY += y;
  }
  if (x1 < 0) return { buildings: [], roads: [], fields: [], houses: 0, servicesPlaced: {} };
  const gx = Math.round(sumX / landCount), gy = Math.round(sumY / landCount);

  // --- routes : grille régulière (lignes H tous STEPH, épines V tous STEPV) ---
  const STEPH = 2 * rh + 1;
  const STEPV = Math.max(rw + 2, Math.min(2 * rw + 1, 11));
  // « prises d'eau » : cases réservées SANS route près des consommateurs d'eau —
  // une conduite ne peut pas terminer sur une route, donc un anneau complet rend
  // le bâtiment irraccordable (cause du 0/20 raccordés)
  const waterGate = new Uint8Array(N);
  const layRoad = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (occ[i] || roadAt[i] || waterGate[i]) return;
    roadAt[i] = 1;
  };
  for (let y = y0; y <= y1; y += STEPH) for (let x = x0; x <= x1; x++) layRoad(x, y);
  for (let x = x0; x <= x1; x += STEPV) for (let y = y0; y <= y1; y++) layRoad(x, y);

  // --- helpers ---
  const buildings: PlacedBuilding[] = [];
  const servicesPlaced: Record<string, number> = {};
  const placements = new Map<string, { x: number; y: number; w: number; h: number }[]>();

  const fitsBld = (w: number, h: number, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (y + j) * W + (x + i);
      if (!grid.usable[c] || occ[c]) return false;
      // ne JAMAIS écraser la route d'accès d'un bâtiment déjà posé (son anneau) —
      // sinon les wonders posés dos-à-dos au centroïde s'emmurent mutuellement
      if (roadAt[c] && bldAdj[c]) return false;
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
  const layRing = (x: number, y: number, w: number, h: number): number[] => {
    const ring: number[] = [];
    const tryLay = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = py * W + px;
      if (roadAt[i]) { ring.push(i); return; }
      if (occ[i] || !grid.usable[i] || waterGate[i]) return; // prise d'eau : pas de route
      roadAt[i] = 1; ring.push(i);
    };
    for (let i = -1; i <= w; i++) { tryLay(x + i, y - 1); tryLay(x + i, y + h); }
    for (let j = 0; j < h; j++) { tryLay(x - 1, y + j); tryLay(x + w, y + j); }
    return ring;
  };
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
          if (!ringSet.has(nb)) return;
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
          prev.set(n, c); next.push(n);
        }
      }
      frontier = next;
    }
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
    const arr = placements.get(def.id) ?? [];
    arr.push({ x, y, w, h });
    placements.set(def.id, arr);
    markAdj(x, y, w, h);
    // consommateur d'eau : réserver la prise AVANT l'anneau (sinon il l'enferme)
    if (needsWater(def)) reserveWaterGate(x, y, w, h);
    const ring = layRing(x, y, w, h);
    if (ring.length) connectRing(ring);
  };
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
  const stretch = 1 + (1 - floor) * 0.6;
  const effR = (d: BuildingDef): number => Math.max(8, Math.round((rangeOf(d) - STEPH) * stretch));

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

  const SMALL_RANGE_MAX = 40; // gros (Théâtre/Biblio/Bains/Temple/Forum/MJeu) vs petits
  const placeLattice = (d: BuildingDef) => {
    const r = effR(d);
    // candidats : grille FINE (pas r/2) + centroïde en tête. Le greedy max-gain
    // borné ci-dessous est un min-set-cover approché par type : terrain ouvert →
    // converge vers le quinconce (~aire/2r² copies) ; contours irréguliers → il
    // s'adapte (les ancres quinconce strictes tombaient dans l'eau → rim non couvert).
    const cstep = Math.max(4, Math.floor(r / 2));
    const anchors: { x: number; y: number }[] = [{ x: gx, y: gy }];
    for (let ly = y0; ly <= y1; ly += cstep) {
      for (let lx = x0; lx <= x1; lx += cstep) anchors.push({ x: lx, y: ly });
    }
    // greedy par GAIN : une ancre n'est posée que si son diamant L1 apporte assez de
    // terre pas encore couverte par CE type (élimine copies de coin / sur l'eau).
    // Copies bornées par construction ≈ 2 × aire/2r² (pas d'explosion de réparation).
    const distMap = new Int32Array(N).fill(N);
    const minGain = Math.max(60, Math.floor(2 * r * r * 0.25));
    const maxCopies = Math.ceil(landCount / (2 * r * r)) * 2 + 2;
    for (let iter = 0; iter < maxCopies; iter++) {
      let bi = -1, bGain = minGain - 1;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (a.x < 0) continue; // consommée
        let g = 0;
        for (let dy = -r; dy <= r; dy++) {
          const ay = a.y + dy;
          if (ay < 0 || ay >= H) continue;
          const span = r - Math.abs(dy);
          for (let dx = -span; dx <= span; dx++) {
            const ax = a.x + dx;
            if (ax < 0 || ax >= W) continue;
            const c = ay * W + ax;
            if (grid.usable[c] && distMap[c] > r) g++;
          }
        }
        if (g > bGain) { bGain = g; bi = i; }
      }
      if (bi < 0) break; // plus aucune ancre utile
      const a = anchors[bi];
      anchors[bi] = { x: -1, y: -1 };
      const before = (placements.get(d.id) ?? []).length;
      placeNear(d, a.x, a.y, Math.floor(r / 2) + 4);
      const arr = placements.get(d.id) ?? [];
      if (arr.length === before) continue; // rien ne tient ici
      const p = arr[arr.length - 1];
      const seeds: number[] = [];
      for (let j = 0; j < p.h; j++) for (let i2 = 0; i2 < p.w; i2++) seeds.push((p.y + j) * W + (p.x + i2));
      l1Update(distMap, seeds, r + 1);
    }
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
    for (const d of smallByH) {
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
    for (let iter = 0; iter < maxStrips; iter++) {
      let bi = -1, bGain = minGain - 1;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (a.x < 0) continue;
        let g = 0;
        for (let dy = -rC; dy <= rC; dy++) {
          const ay = a.y + dy;
          if (ay < 0 || ay >= H) continue;
          const span = rC - Math.abs(dy);
          for (let dx = -span; dx <= span; dx++) {
            const ax = a.x + dx;
            if (ax < 0 || ax >= W) continue;
            const c = ay * W + ax;
            if (grid.usable[c] && distMap[c] > rC) g++;
          }
        }
        if (g > bGain) { bGain = g; bi = i; }
      }
      if (bi < 0) break;
      const a = anchors[bi];
      anchors[bi] = { x: -1, y: -1 };
      // strip atomique : essai en glissant le long de la ligne
      const nBefore = buildings.length;
      let ok = false;
      for (const dx of [0, -3, 3, -6, 6, -9, 9, -12, 12]) {
        if (tryStrip(a.x + dx, a.y)) { ok = true; break; }
      }
      if (!ok) continue;
      const seeds: number[] = [];
      for (let bIdx = nBefore; bIdx < buildings.length; bIdx++) {
        const b = buildings[bIdx];
        const pdef = lookup(b.defId)!;
        const w = b.rotation === 90 ? pdef.size.h : pdef.size.w, h = b.rotation === 90 ? pdef.size.w : pdef.size.h;
        for (let j = 0; j < h; j++) for (let i2 = 0; i2 < w; i2++) seeds.push((b.y + j) * W + (b.x + i2));
      }
      l1Update(distMap, seeds, rC + 1);
    }
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

  // --- VÉRIFICATION + DENSIFICATION : tout type sous le seuil reçoit des copies ---
  const covByType = new Map<string, Uint8Array>();
  const refreshType = (tc: TypeCov) => { bfsType(tc); covByType.set(tc.def.id, coveredOrigins(tc)); };
  for (const tc of typeCov.values()) refreshType(tc);

  // budget par TYPE (≈ moitié du lattice initial en copies de secours) : borné par
  // construction, contrairement à la réparation ouverte de districtPlan.
  const repairBudget = new Map<string, number>();
  for (const tc of typeCov.values()) {
    const r = effR(tc.def);
    repairBudget.set(tc.def.id, Math.max(3, Math.ceil(landCount / (2 * r * r))));
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
    // densifier : poser une copie au barycentre du plus gros trou (max demande non couverte)
    const cov = covByType.get(worst.def.id)!;
    const miss = new Uint8Array(N);
    for (let i = 0; i < N; i++) miss[i] = demand[i] && !cov[i] ? 1 : 0;
    // SAT pour trouver la fenêtre la plus dense de trous
    const q = Math.max(3, Math.floor((worst.range * 0.6) / Math.SQRT2));
    let bx = -1, by = -1, best = 0;
    for (let cy = y0; cy <= y1; cy += 3) for (let cx = x0; cx <= x1; cx += 3) {
      let s = 0;
      for (let yy = Math.max(y0, cy - q); yy <= Math.min(y1, cy + q); yy += 2)
        for (let xx = Math.max(x0, cx - q); xx <= Math.min(x1, cx + q); xx += 2) s += miss[yy * W + xx];
      if (s > best) { best = s; bx = cx; by = cy; }
    }
    if (bx < 0 || best === 0) { repairBudget.set(worst.def.id, 0); continue; }
    if (!placeNear(worst.def, bx, by, Math.max(W, H))) { repairBudget.set(worst.def.id, 0); continue; }
    repairBudget.set(worst.def.id, (repairBudget.get(worst.def.id) ?? 1) - 1);
    // l'emprise posée a pu écraser routes/slots → demande live + type recalculé
    rebuildDemand();
    refreshType(worst);
  }

  // --- EAU (avant les maisons !) : services posés = consommateurs connus ; les
  // conduites ne partagent pas les cases route → si on posait les maisons d'abord,
  // les poches seraient pleines et il ne resterait AUCUN passage. Routées ici, les
  // maisons contournent les corridors (cases conduite occupées).
  let water: WaterPlanResult | undefined;
  if (opts.water) {
    const roadsNow: RoadTile[] = [];
    for (let i = 0; i < N; i++) if (roadAt[i]) roadsNow.push({ x: i % W, y: (i / W) | 0 });
    water = planWater(grid, buildings, roadsNow, lookup);
    for (const s of water.sources) {
      const d = lookup(s.defId)!;
      const w = s.rotation === 90 || s.rotation === 270 ? d.size.h : d.size.w;
      const h = s.rotation === 90 || s.rotation === 270 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const c = (s.y + j) * W + (s.x + i);
        if (c >= 0 && c < N) { occ[c] = 1; if (roadAt[c]) roadAt[c] = 0; }
      }
      buildings.push(s);
    }
    for (const a of water.aqueducts) {
      const c = a.y * W + a.x;
      if (!roadAt[c]) occ[c] = 1; // croisement : la route reste, la conduite enjambe
    }
  }

  // refresh FINAL de tous les types : les stamps tardifs ont pu invalider les BFS
  // précédents (routes écrasées) — le filtre maisons doit voir l'état exact.
  rebuildDemand();
  for (const tc of typeCov.values()) refreshType(tc);
  if (opts.debug) {
    opts.debug(`demandTotal=${demandTotal}`);
    let inter = 0;
    for (let i = 0; i < N; i++) {
      if (!demand[i]) continue;
      let all = true;
      for (const tc of typeCov.values()) if (!covByType.get(tc.def.id)![i]) { all = false; break; }
      if (all) inter++;
    }
    opts.debug(`intersection(all types)=${inter} (${demandTotal ? Math.round((100 * inter) / demandTotal) : 0}%)`);
    for (const tc of typeCov.values()) {
      const cov = covByType.get(tc.def.id)!;
      let c = 0;
      for (let i = 0; i < N; i++) if (demand[i] && cov[i]) c++;
      opts.debug(`  ${tc.def.name} range=${tc.range} effR=${effR(tc.def)} copies=${servicesPlaced[tc.def.id] ?? 0} covDemand=${demandTotal ? Math.round((100 * c) / demandTotal) : 0}%`);
    }
  }

  // --- MAISONS : tout slot accessible, gardé ssi couvert par tous (floor) ---
  const types = [...typeCov.values()].filter((tc) => (placements.get(tc.def.id) ?? []).length > 0);
  const covArr = types.map((tc) => covByType.get(tc.def.id) ?? coveredOrigins(tc));

  // 2 passes : slots COMPLETS d'abord (une maison partielle acceptée tôt en scan
  // row-major bloquait des slots complets en aval), puis remplissage partiel sous
  // quota (chaque type reste ≥ floor sur l'ensemble gardé).
  let houses = 0, total = 0;
  const covCount = new Array<number>(types.length).fill(0);
  const tryPlaceHouse = (x: number, y: number, allowPartial: boolean): void => {
    if (!fitsHouse(x, y) || !touchesRoad(x, y)) return;
    const o = y * W + x;
    let failing = 0;
    for (let t = 0; t < types.length; t++) if (!covArr[t][o]) failing++;
    if (failing > 0) {
      if (!allowPartial || floor >= 1) return;
      for (let t = 0; t < types.length; t++) {
        if (covCount[t] + (covArr[t][o] ? 1 : 0) < floor * (total + 1) - 1e-9) return;
      }
    }
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) occ[(y + j) * W + (x + i)] = 1;
    buildings.push({ uid: uid("lat"), defId: residenceId, x, y, rotation: 0, locked: false });
    markAdj(x, y, rw, rh);
    houses++; total++;
    for (let t = 0; t < types.length; t++) if (covArr[t][o]) covCount[t]++;
  };
  for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) tryPlaceHouse(x, y, false);
  if (floor < 1) {
    for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) tryPlaceHouse(x, y, true);
  }

  // --- ÉLAGAGE routes : adjacentes aux bâtiments + chemins maison→service ---
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (roadAt[i] && bldAdj[i]) keep[i] = 1;
  const housesPlaced = buildings.filter((b) => b.defId === tier.residenceId);
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
  const roads: RoadTile[] = [];
  for (let i = 0; i < N; i++) if (keep[i]) roads.push({ x: i % W, y: (i / W) | 0 });

  return { buildings, roads, fields: [], houses, servicesPlaced, water };
}
