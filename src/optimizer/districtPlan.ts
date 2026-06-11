import { uid } from "../model/factories";
import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { economy } from "../economy/economy";
import type { DefLookup } from "../engine/rules";

const SMALL_RANGE_MAX = 40; // services à portée <= 40 = locaux (groupés par district)

export interface DistrictOpts {
  /** Seuil de couverture par service (0..1, défaut 1). Si < 1, des maisons
   *  partiellement couvertes sont ajoutées tant que CHAQUE type reste ≥ seuil. */
  coverageFloor?: number;
  /** Restreint les services à placer/couvrir (mode « seuils d'upgrade » : seuls
   *  les besoins retenus comptent). Absent = tous les services du tier. */
  serviceIds?: string[];
}

export interface DistrictResult {
  buildings: PlacedBuilding[]; // services (petits + gros) + maisons
  roads: RoadTile[];
  fields: FieldTile[];
  houses: number;
  servicesPlaced: Record<string, number>; // defId -> nb
}

// Portée de PLANIFICATION = streetRange d'abord : la vraie mécanique du jeu est la
// distance LE LONG DES RUES (EffectScope StreetDistance, cf. GAME_MECHANICS.md §1).
// radius.range en repli (l'analyseur l'utilise en euclidien pour ces services-là ;
// notre BFS-rue avec cette valeur est plus strict → conservateur).
const rangeOf = (d: BuildingDef): number => d.streetRange || d.radius?.range || 0;

/**
 * Générateur de districts v3 — couverture par DISTANCE-RUE (mécanique réelle).
 *
 *  1. Peigne de routes double-rangée + épines verticales (accès maisons).
 *  2. Carte de demande = positions où une maison TIENT (terre + accès route).
 *  3. GROS services d'abord, puis PETITS en clusters : positions choisies par un
 *     proxy euclidien rapide (table de sommes), mais couverture MARQUÉE EXACTEMENT
 *     par BFS le long des routes (graines = routes orthogonales au bâtiment,
 *     distance ≤ streetRange — même sémantique que streetCoverage de l'analyseur).
 *  4. Garantie (type à 0 copie) + réparation (zones à ≤2 types manquants).
 *  5. Maisons : posées ssi une route orthogonalement adjacente est ATTEINTE par
 *     chaque type (BFS final recalculé proprement). Remplissage partiel si floor<1.
 *  6. Élagage routes : on garde routes adjacentes aux bâtiments + l'UNION DES
 *     CHEMINS BFS maison→service (les chemins ne passent que par des cases
 *     atteintes → les distances ne changent pas → couverture préservée).
 */
export function planDistricts(
  grid: GridShape,
  tierGuid: string,
  lookup: DefLookup,
  opts: DistrictOpts = {},
): DistrictResult {
  const floor = Math.min(1, Math.max(0.3, opts.coverageFloor ?? 1));
  const tier = economy.tiers.find((t) => t.guid === tierGuid);
  if (!tier || !tier.residenceId) throw new Error("Tier-cible invalide.");
  const resDef = lookup(tier.residenceId)!;
  const rw = resDef.size.w, rh = resDef.size.h;
  const W = grid.w, H = grid.h;
  const N = W * H;

  // services requis à portée connue, séparés petits / gros
  const wanted = opts.serviceIds ? new Set(opts.serviceIds) : null;
  const svcDefs = [...new Set(tier.services.map((s) => s.building).filter((b): b is string => !!b))]
    .filter((id) => !wanted || wanted.has(id))
    .map((id) => lookup(id))
    .filter((d): d is BuildingDef => !!d && rangeOf(d) > 0);
  const small = svcDefs.filter((d) => rangeOf(d) <= SMALL_RANGE_MAX);
  const big = svcDefs.filter((d) => rangeOf(d) > SMALL_RANGE_MAX);

  // occupation : 1 = bloqué (hors-terre / bâtiment) ; routes suivies à part (roadAt)
  const occ = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!grid.usable[i]) occ[i] = 1;
  const roadAt = new Uint8Array(N);
  const bldAdj = new Uint8Array(N); // cases 4-adjacentes à un bâtiment (élagage + ancres)

  // bbox terre + centroïde
  let x0 = W, y0 = H, x1 = -1, y1 = -1, landCount = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid.usable[y * W + x]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    landCount++; sumX += x; sumY += y;
  }
  if (x1 < 0) return { buildings: [], roads: [], fields: [], houses: 0, servicesPlaced: {} };
  const gx = Math.round(sumX / landCount), gy = Math.round(sumY / landCount);

  // --- 1. peigne de routes : double-rangée (2 rangées de maisons par poche) ---
  const STEPH = 2 * rh + 1;
  // épines verticales assez DENSES pour que le détour de rue entre 2 lignes comb
  // (≈ STEPH + STEPV) reste sous la plus petite portée des services locaux — sinon
  // chaque service ne sert que SA ligne et l'intersection des types est vide.
  const minSmallRange = Math.min(...svcDefs.filter((d) => rangeOf(d) <= SMALL_RANGE_MAX).map(rangeOf), 28);
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
      if (!grid.usable[c] || occ[c]) return false; // routes OK (écrasées + stub)
    }
    return true;
  };
  // maison : ne PAS écraser de route
  const fitsHouse = (x: number, y: number): boolean => {
    if (x < x0 || y < y0 || x + rw - 1 > x1 || y + rh - 1 > y1) return false;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const c = (y + j) * W + (x + i);
      if (!grid.usable[c] || occ[c] || roadAt[c]) return false;
    }
    return true;
  };
  // cases route ORTHOGONALEMENT adjacentes à une emprise (graines BFS / ancres maison)
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
  // anneau de route périmétrique : reconnecte les lignes du peigne coupées par le
  // bâtiment (sinon les gros services décimaient le réseau local → BFS confiné à des
  // fragments) + garantit l'accès route. Renvoie les cases de l'anneau.
  const layRing = (x: number, y: number, w: number, h: number): number[] => {
    const ring: number[] = [];
    const tryLay = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = py * W + px;
      if (roadAt[i]) { ring.push(i); return; } // route existante = fait partie de l'anneau
      if (occ[i] || !grid.usable[i]) return;
      roadAt[i] = 1; ring.push(i);
    };
    for (let i = -1; i <= w; i++) { tryLay(x + i, y - 1); tryLay(x + i, y + h); }
    for (let j = 0; j < h; j++) { tryLay(x - 1, y + j); tryLay(x + w, y + j); }
    return ring;
  };
  // l'anneau est-il relié au reste du réseau ? sinon, tracer un stub (chemin libre)
  const connectRing = (ring: number[]) => {
    if (!ring.length) return;
    const ringSet = new Set(ring);
    // BFS sur ROUTES depuis l'anneau : route hors-anneau atteinte → déjà connecté
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
    // isolé → BFS cases libres depuis l'anneau vers une route hors-anneau
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
          if (roadAt[n] && !ringSet.has(n)) { // route du réseau trouvée → tracer
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
  // (ancien stub conservé pour les cas sans anneau possible)
  const connectStub = (x: number, y: number, w: number, h: number) => {
    if (orthoRoadCells(x, y, w, h).length) return;
    const maxDepth = 2 * STEPH + 2;
    const prev = new Map<number, number>();
    let frontier: number[] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const px = x + i + dx, py = y + j + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const c = py * W + px;
        if (!grid.usable[c] || occ[c] || prev.has(c)) continue;
        prev.set(c, -1);
        frontier.push(c);
      }
    }
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: number[] = [];
      for (const c of frontier) {
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const px = cx + dx, py = cy + dy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const n = py * W + px;
          if (roadAt[n]) {
            let cur = c;
            while (cur >= 0) { roadAt[cur] = 1; cur = prev.get(cur)!; }
            return;
          }
          if (!grid.usable[n] || occ[n] || prev.has(n)) continue;
          prev.set(n, c);
          next.push(n);
        }
      }
      frontier = next;
    }
  };

  // --- état de couverture STREET par type de service ---
  interface TypeCov {
    def: BuildingDef;
    range: number;
    reach: Uint8Array; // cases ROUTE atteintes (dist <= range) par n'importe quelle copie
    reachList: number[]; // les mêmes, en liste (marquage sans scan O(N))
    parent: Int32Array; // arbre BFS (élagage par chemins)
    covered: Uint8Array; // origines de maison couvertes (route ortho-adjacente atteinte)
  }
  const typeCov = new Map<string, TypeCov>();
  for (const d of svcDefs) typeCov.set(d.id, {
    def: d, range: rangeOf(d), reach: new Uint8Array(N), reachList: [], parent: new Int32Array(N), covered: new Uint8Array(N),
  });

  // BFS multi-source le long des routes depuis TOUTES les copies d'un type.
  // Sémantique = streetCoverage de l'analyseur : graines (routes ortho-adjacentes) à
  // distance 1, expansion tant que dist < range.
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
        tc.reachList.push(c);
        frontier.push(c);
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
          tc.reachList.push(nb);
          next.push(nb);
        }
      }
      frontier = next; d++;
    }
  };

  // re-marque les origines couvertes d'un type depuis son reach (idempotent).
  // route atteinte (rx,ry) -> origines de maison qui l'ont en ortho-adjacence.
  const markCoveredFromReach = (tc: TypeCov, onNewCovered?: (origin: number) => void) => {
    for (const c of tc.reachList) {
      const rx = c % W, ry = (c / W) | 0;
      // route au-dessus/dessous d'une maison : origine (x, ry+1) ou (x, ry-rh), x ∈ [rx-rw+1, rx]
      for (let x = rx - rw + 1; x <= rx; x++) {
        for (const oy of [ry + 1, ry - rh]) {
          if (x < 0 || oy < 0 || x + rw > W || oy + rh > H) continue;
          const o = oy * W + x;
          if (!tc.covered[o]) { tc.covered[o] = 1; onNewCovered?.(o); }
        }
      }
      // route à gauche/droite : origine (rx+1, y) ou (rx-rw, y), y ∈ [ry-rh+1, ry]
      for (let y = ry - rh + 1; y <= ry; y++) {
        for (const ox of [rx + 1, rx - rw]) {
          if (ox < 0 || y < 0 || ox + rw > W || y + rh > H) continue;
          const o = y * W + ox;
          if (!tc.covered[o]) { tc.covered[o] = 1; onNewCovered?.(o); }
        }
      }
    }
  };

  const stamp = (def: BuildingDef, x: number, y: number) => {
    for (let j = 0; j < def.size.h; j++) for (let i = 0; i < def.size.w; i++) {
      const c = (y + j) * W + (x + i);
      occ[c] = 1;
      if (roadAt[c]) roadAt[c] = 0; // un bâtiment écrase la route sous lui
    }
    buildings.push({ uid: uid("dist"), defId: def.id, x, y, rotation: 0, locked: false });
    servicesPlaced[def.id] = (servicesPlaced[def.id] ?? 0) + 1;
    const arr = placements.get(def.id) ?? [];
    arr.push({ x, y, w: def.size.w, h: def.size.h });
    placements.set(def.id, arr);
    markAdj(x, y, def.size.w, def.size.h);
    const ring = layRing(x, y, def.size.w, def.size.h);
    if (ring.length) connectRing(ring);
    else connectStub(x, y, def.size.w, def.size.h);
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

  // --- 2. carte de demande : où une maison TIENT (avant services) ---
  const touchesRoad = (x: number, y: number): boolean => orthoRoadCells(x, y, rw, rh).length > 0;
  const demand = new Uint8Array(N);
  let demandTotal = 0;
  for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) {
    if (fitsHouse(x, y) && touchesRoad(x, y)) { demand[y * W + x] = 1; demandTotal++; }
  }

  // --- tables de sommes (proxy euclidien pour CHOISIR les positions) ---
  const sat = new Int32Array((W + 1) * (H + 1)); // masque de score courant
  const satDemand = new Int32Array((W + 1) * (H + 1)); // demande totale (statique)
  const buildSATInto = (buf: Int32Array, mask: Uint8Array) => {
    for (let y = 0; y < H; y++) {
      const r0 = y * (W + 1), r1 = (y + 1) * (W + 1);
      for (let x = 0; x < W; x++) buf[r1 + x + 1] = mask[y * W + x] + buf[r0 + x + 1] + buf[r1 + x] - buf[r0 + x];
    }
  };
  const buildSAT = (mask: Uint8Array) => buildSATInto(sat, mask);
  const rectSumIn = (buf: Int32Array, xa: number, ya: number, xb: number, yb: number): number => {
    xa = Math.max(0, xa); ya = Math.max(0, ya); xb = Math.min(W - 1, xb); yb = Math.min(H - 1, yb);
    if (xa > xb || ya > yb) return 0;
    return buf[(yb + 1) * (W + 1) + xb + 1] - buf[ya * (W + 1) + xb + 1] - buf[(yb + 1) * (W + 1) + xa] + buf[ya * (W + 1) + xa];
  };
  const rectSum = (xa: number, ya: number, xb: number, yb: number): number => rectSumIn(sat, xa, ya, xb, yb);
  // malus d'empiètement : demande écrasée par une emprise (bâtiment + anneau)
  const FOOT_PENALTY = 3;
  const footprintCost = (x: number, y: number, w: number, h: number): number =>
    rectSumIn(satDemand, x - 1, y - 1, x + w, y + h);
  // la distance-rue sur peigne ≈ Manhattan : portée euclidienne effective ≈ 0.7 × rue
  const proxyQ = (range: number): number => Math.max(2, Math.floor((range * 0.7) / Math.SQRT2));
  buildSATInto(satDemand, demand); // demande statique (malus d'empiètement)

  // pose UNE copie max-cover d'un type (proxy SAT), renvoie le gain street réel (-1 si pas de place)
  const placeOneMaxCover = (d: BuildingDef, uncov: Uint8Array, penalty = FOOT_PENALTY): number => {
    const tc = typeCov.get(d.id)!;
    const q = proxyQ(tc.range);
    buildSAT(uncov);
    let bx = -1, by = -1, bestGain = -Infinity;
    const stride = 3;
    for (let cy = y0; cy + d.size.h - 1 <= y1; cy += stride) for (let cx = x0; cx + d.size.w - 1 <= x1; cx += stride) {
      const ccx = cx + d.size.w / 2, ccy = cy + d.size.h / 2;
      // gain de couverture − malus de demande écrasée (pousse les gros HORS de la
      // zone résidentielle dense ; leur portée 50-70 suffit depuis la bordure)
      const g = rectSum(Math.round(ccx - q), Math.round(ccy - q), Math.round(ccx + q), Math.round(ccy + q))
        - penalty * footprintCost(cx, cy, d.size.w, d.size.h);
      if (g > bestGain && fitsBld(d.size.w, d.size.h, cx, cy)) { bestGain = g; bx = cx; by = cy; }
    }
    if (bx < 0 || bestGain <= -Infinity) return -1; // aucune position possible
    stamp(d, bx, by);
    bfsType(tc);
    let gained = 0;
    markCoveredFromReach(tc, (o) => { if (uncov[o]) { uncov[o] = 0; gained++; } });
    return gained;
  };

  // --- défs PETITS services : cluster atomique en rangée flush ---
  const smallByH = [...small].sort((a, b) => b.size.h - a.size.h);
  const minSmallR = small.length ? Math.min(...small.map(rangeOf)) : 0;
  // proxy de CHOIX de position (0.7 ≈ rue→euclide) — marquage street EXACT ensuite
  const effRCluster = Math.max(6, minSmallR * 0.7);

  // cluster EN RANGÉE, FLUSH contre une même ligne du peigne : toutes les graines BFS
  // partagent la ligne → l'intersection des portées est garantie le long de la route.
  // Placement ATOMIQUE : on cherche un segment de ligne où TOUTE la rangée tient
  // (simulation), sinon rien — les replis individuels dispersaient le cluster et
  // rendaient l'intersection vide sur les îles encombrées.
  // 3 variantes : alterné dessus/dessous, tout au-dessus, tout en-dessous (plus de
  // candidats sur les îles encombrées)
  const simulateRow = (cx: number, ly: number, mode: 0 | 1 | 2): { d: BuildingDef; x: number; y: number }[] | null => {
    let xa = cx, xb = cx, above = mode !== 2;
    const pos: { d: BuildingDef; x: number; y: number }[] = [];
    for (const d of smallByH) {
      const ty = above ? ly - d.size.h : ly + 1; // flush contre la route
      const tx = above ? xa : xb;
      if (!fitsBld(d.size.w, d.size.h, tx, ty)) return null;
      pos.push({ d, x: tx, y: ty });
      if (above) xa += d.size.w + 1; else xb += d.size.w + 1;
      if (mode === 0) above = !above;
    }
    return pos;
  };
  // meilleur segment sur toute l'île selon scoreMask (SAT déjà construite par l'appelant)
  const placeClusterAtomic = (minScore: number): boolean => {
    const q = Math.max(2, Math.floor(effRCluster / Math.SQRT2));
    let best: { d: BuildingDef; x: number; y: number }[] | null = null;
    let bestScore = -Infinity;
    let nFit = 0, topG = 0;
    for (let ly = y0; ly <= y1; ly += STEPH) {
      for (let cx = x0; cx <= x1; cx += 3) {
        for (const mode of [0, 1, 2] as const) {
          const pos = simulateRow(cx, ly, mode);
          if (!pos) continue;
          nFit++;
          const xeMax = Math.max(...pos.map((p) => p.x + p.d.size.w));
          const cm = Math.round((cx + xeMax) / 2);
          const g = rectSum(cm - q, ly - q, cm + q, ly + q);
          if (g < minScore) continue;
          // PAS de malus d'emprise ici : le cluster doit aller AU max de demande non
          // couverte (un malus l'exilait dans les zones vides — l'écrasement local est
          // compensé par les maisons validées tout autour, portée 26+)
          if (g > topG) topG = g;
          if (g > bestScore) { bestScore = g; best = pos; }
        }
      }
    }
    if (!best) return false;
    for (const p of best) stamp(p.d, p.x, p.y);
    return true;
  };

  // état de couverture clusters + une itération = 1 cluster posé (gain street réel)
  const smallUncov = demand.slice(); // origines pas couvertes par TOUS les petits types
  let smallRemaining = demandTotal;
  const allSmallCovered = (o: number): boolean => {
    for (const d of small) if (!typeCov.get(d.id)!.covered[o]) return false;
    return true;
  };
  // score = demande pas-encore-complète ET déjà couverte par TOUS les gros posés
  // (cible directement l'intersection finale ; sans gros posés → smallUncov seul)
  const scoreMask = new Uint8Array(N);
  const rebuildScoreMask = () => {
    for (let i = 0; i < N; i++) {
      let ok = smallUncov[i] === 1;
      if (ok && big.length) {
        for (const d of big) {
          const tc = typeCov.get(d.id)!;
          if ((placements.get(d.id) ?? []).length && !tc.covered[i]) { ok = false; break; }
        }
      }
      scoreMask[i] = ok ? 1 : 0;
    }
  };
  const clusterMinGain = 2 * rw; // ~2 maisons d'origines
  const clusterIteration = (): number => {
    rebuildScoreMask();
    buildSAT(scoreMask);
    const prev = smallRemaining;
    if (!placeClusterAtomic(clusterMinGain)) return -1; // plus aucun segment viable
    for (const d of small) {
      const tc = typeCov.get(d.id)!;
      bfsType(tc);
      markCoveredFromReach(tc, (o) => {
        if (smallUncov[o] && allSmallCovered(o)) { smallUncov[o] = 0; smallRemaining--; }
      });
    }
    return prev - smallRemaining;
  };

  // --- 3. ORDRE CLEF : le 1er cluster définit le CŒUR résidentiel, AVANT les gros
  // (sinon les gros squattent le centre dense et le cluster est exilé en périphérie).
  if (small.length && demandTotal > 0) clusterIteration();

  // --- 3a. GROS services, VAGUE 1 : UNE copie de CHAQUE type, du plus gros au plus
  // petit (l'espace contigu d'abord), malus d'emprise → ils s'installent AUTOUR du cœur.
  const bigByArea = [...big].sort((a, b) => b.size.w * b.size.h - a.size.w * a.size.h);
  const bigUncov = new Map<string, Uint8Array>();
  for (const d of bigByArea) {
    if (demandTotal === 0) break;
    const uncov = demand.slice(); // origines pas couvertes par CE type
    bigUncov.set(d.id, uncov);
    placeOneMaxCover(d, uncov);
  }

  // --- 4. clusters suivants : ciblent l'intersection avec les gros posés ---
  if (small.length && demandTotal > 0) {
    const targetRemaining = demandTotal * (1 - floor);
    for (let iter = 0; iter < 250 && smallRemaining > targetRemaining; iter++) {
      const gained = clusterIteration();
      // gain RÉEL street : un cluster entier pour moins de ~2 maisons → stop
      if (gained < 2 * rw) break;
    }
  }

  // --- 5. garantie : tout type requis à 0 copie est posé près du centroïde ---
  for (const d of svcDefs) {
    if (!servicesPlaced[d.id]) placeNear(d, gx, gy, Math.max(W, H));
  }

  // recalcul PROPRE de tous les types (BFS + couverture) — base des phases suivantes
  const refreshAll = () => {
    for (const tc of typeCov.values()) {
      tc.covered = new Uint8Array(N);
      bfsType(tc);
      markCoveredFromReach(tc);
    }
  };
  refreshAll();

  // types réellement posés (les non-posés sont rapportés en trous, pas bloquants)
  const types = [...typeCov.values()].filter((tc) => (placements.get(tc.def.id) ?? []).length > 0);

  // --- 6. réparation GÉNÉRIQUE (set-multi-cover) : sur les slots ENCORE POSABLES
  // (live, pas la demande statique), choisir le type le plus manquant et poser une
  // copie max-cover de ses échecs. Itérer — chaque round réduit le « miss » moyen,
  // même les slots à 5-6 types manquants finissent complets si l'espace le permet.
  const REPAIR_BUDGET = 24;
  const exhausted = new Set<string>(); // types sans position utile → ne plus essayer
  for (let round = 0; round < REPAIR_BUDGET; round++) {
    const failCount = new Map<string, number>();
    for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) {
      if (!fitsHouse(x, y) || !touchesRoad(x, y)) continue;
      const o = y * W + x;
      for (const t of types) if (!t.covered[o]) failCount.set(t.def.id, (failCount.get(t.def.id) ?? 0) + 1);
    }
    let worst: string | null = null, worstN = 2 * rw; // seuil : ~2 maisons récupérables
    for (const [id, n] of failCount) if (!exhausted.has(id) && n > worstN) { worstN = n; worst = id; }
    if (!worst) break;
    const tc = typeCov.get(worst)!;
    // slots où CE type manque → max-cover proxy d'une copie supplémentaire
    const failMask = new Uint8Array(N);
    for (let y = y0; y + rh - 1 <= y1; y++) for (let x = x0; x + rw - 1 <= x1; x++) {
      const o = y * W + x;
      if (!tc.covered[o] && fitsHouse(x, y) && touchesRoad(x, y)) failMask[o] = 1;
    }
    const gained = placeOneMaxCover(tc.def, failMask, 1); // malus léger : rester PRÈS des échecs
    if (gained < 2 * rw) { exhausted.add(worst); continue; } // copie inutile, type épuisé
    // le stamp peut écraser des routes → recalcul complet (cheap, garde tout exact)
    refreshAll();
  }

  // --- 7. maisons : couverture street totale d'abord, remplissage partiel si floor<1 ---
  let houses = 0, total = 0;
  const covCount = new Array<number>(types.length).fill(0);
  const inR = new Array<boolean>(types.length);
  for (let y = y0; y + rh - 1 <= y1; y++) {
    for (let x = x0; x + rw - 1 <= x1; x++) {
      if (!fitsHouse(x, y) || !touchesRoad(x, y)) continue;
      const o = y * W + x;
      let failing = 0;
      for (let t = 0; t < types.length; t++) { inR[t] = types[t].covered[o] === 1; if (!inR[t]) failing++; }
      if (failing > 0) {
        if (floor >= 1) continue;
        let ok = true;
        for (let t = 0; t < types.length && ok; t++) {
          if (covCount[t] + (inR[t] ? 1 : 0) < floor * (total + 1) - 1e-9) ok = false;
        }
        if (!ok) continue;
      }
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) occ[(y + j) * W + (x + i)] = 1;
      buildings.push({ uid: uid("dist"), defId: tier.residenceId, x, y, rotation: 0, locked: false });
      markAdj(x, y, rw, rh);
      houses++; total++;
      for (let t = 0; t < types.length; t++) if (inR[t]) covCount[t]++;
    }
  }

  // --- 8. élagage : routes adjacentes aux bâtiments + chemins BFS maison→service ---
  // Un chemin BFS ne traverse que des cases atteintes (dist croissante) → les garder
  // toutes laisse les distances intactes → la couverture mesurée ne change pas.
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (roadAt[i] && bldAdj[i]) keep[i] = 1;
  const housesPlaced = buildings.filter((b) => b.defId === tier.residenceId);
  // chainKept ≠ keep : early-exit valide seulement si l'AMONT de la chaîne est garanti
  // gardé, ce que keep (ancres bldAdj) ne garantit pas.
  const chainKept = new Map<string, Uint8Array>();
  for (const t of types) chainKept.set(t.def.id, new Uint8Array(N));
  for (const hb of housesPlaced) {
    const anchors = orthoRoadCells(hb.x, hb.y, rw, rh);
    for (const t of types) {
      const ck = chainKept.get(t.def.id)!;
      // 1re ancre atteinte par ce type → remonter la chaîne parent jusqu'à la graine
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

  return { buildings, roads, fields: [], houses, servicesPlaced };
}
