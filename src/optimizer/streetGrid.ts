import type { BuildingDef } from "../model/types";

/**
 * Primitives de grille/rue PARTAGÉES par les moteurs de placement (planLattice,
 * packPlan). Avant, ~190 lignes quasi-identiques étaient dupliquées dans les deux
 * fichiers (connectRing octet-pour-octet, bfsType, orthoRoadCells…), avec déjà 2
 * divergences (anti-emmurement bldAdj, prises d'eau waterGate) → un fix de
 * distance-rue devait être recopié à la main ou se désynchronisait.
 *
 * `makeStreetGrid` lie des closures à l'état mutable du moteur (occ/roadAt/bldAdj,
 * en place) ; les 2 divergences sont des OPTIONS (`blockRingInFits`, `reserved`),
 * pas des forks. Les corps sont COPIÉS À L'IDENTIQUE des moteurs → comportement
 * inchangé (garanti par les golden snapshots planLattice/packPlan).
 */
export interface StreetGridParams {
  W: number;
  H: number;
  occ: Uint8Array;
  roadAt: Uint8Array;
  bldAdj: Uint8Array;
  usable: boolean[];
  rw: number; // dims résidence (fitsHouse/touchesRoad)
  rh: number;
  x0: number; // bbox terre (fitsHouse)
  y0: number;
  x1: number;
  y1: number;
  STEPH: number; // pas du peigne H (profondeur max de connectRing)
  /** planLattice : fitsBld refuse d'écraser l'anneau d'accès d'un bâtiment posé. */
  blockRingInFits?: boolean;
  /** planLattice : cases réservées SANS route (prises d'eau) — layRoad/layRing les évitent. */
  reserved?: Uint8Array;
}

/** TypeCov minimal commun (packPlan ajoute `covered`, ignoré ici). */
export interface ReachState {
  def: BuildingDef;
  range: number;
  reach: Uint8Array;
  reachList: number[];
  parent: Int32Array;
}

export type Footprint = { x: number; y: number; w: number; h: number };

export function makeStreetGrid(p: StreetGridParams) {
  const { W, H, occ, roadAt, bldAdj, usable, rw, rh, x0, y0, x1, y1, STEPH, reserved } = p;
  const N = W * H;

  const fitsBld = (w: number, h: number, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (y + j) * W + (x + i);
      if (!usable[c] || occ[c]) return false; // routes OK (écrasées)
      // planLattice : ne JAMAIS écraser la route d'accès d'un bâtiment déjà posé
      if (p.blockRingInFits && roadAt[c] && bldAdj[c]) return false;
    }
    return true;
  };

  // fitsHouse borne par la bbox terre (x0..x1) du moteur.
  const fitsHouse = (x: number, y: number): boolean => {
    if (x < x0 || y < y0 || x + rw - 1 > x1 || y + rh - 1 > y1) return false;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const c = (y + j) * W + (x + i);
      if (!usable[c] || occ[c] || roadAt[c]) return false;
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

  const layRoad = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (occ[i] || roadAt[i] || reserved?.[i]) return;
    roadAt[i] = 1;
  };

  const layRing = (x: number, y: number, w: number, h: number): number[] => {
    const ring: number[] = [];
    const tryLay = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return;
      const i = py * W + px;
      if (roadAt[i]) { ring.push(i); return; }
      if (occ[i] || !usable[i] || reserved?.[i]) return;
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
          if (roadAt[n] || !usable[n] || occ[n]) continue;
          prev.set(n, c); next.push(n);
        }
      }
      frontier = next;
    }
  };

  // BFS multi-source le long des routes depuis toutes les copies d'un type.
  const bfsType = (tc: ReachState, placements: Map<string, Footprint[]>) => {
    tc.reach = new Uint8Array(N);
    tc.reachList = [];
    tc.parent = new Int32Array(N).fill(-2);
    const dist = new Int32Array(N).fill(-1);
    let frontier: number[] = [];
    for (const pl of placements.get(tc.def.id) ?? []) {
      for (const c of orthoRoadCells(pl.x, pl.y, pl.w, pl.h)) {
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

  // Tables de sommes (summed-area) pour le proxy euclidien de choix de position.
  const makeSAT = () => {
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
    return { buildSAT, rectSum };
  };

  return { fitsBld, fitsHouse, orthoRoadCells, touchesRoad, markAdj, layRoad, layRing, connectRing, bfsType, makeSAT };
}
