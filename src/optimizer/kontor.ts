import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import type { BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";

/**
 * COMPTOIR (kontor) — racine du réseau de routes et point d'entrée des marchandises.
 *
 * En jeu, prendre possession d'une île pose un comptoir sur la côte ; TOUT le commerce
 * (et donc tout l'import d'une île de population) y transite, et le réseau routier doit
 * y être relié — c'est la sémantique de `rootedRoadSet` (engine/rules.ts).
 *
 * Les moteurs de placement n'en posaient aucun : le plan produit était formellement
 * valide (sans racine, `rootedRoadSet` accepte toutes les routes) mais injouable.
 *
 * Stratégie en deux temps, pour éviter de raser un quartier après coup :
 *  1. `reserveKontor` choisit la position AVANT les moteurs et la retire du masque
 *     constructible (même mécanisme que `blockMountains`) → les moteurs bâtissent autour
 *     et leur peigne de routes longe naturellement l'emprise.
 *  2. `connectKontor` raccorde l'emprise au réseau produit (souvent 0 case : une ligne du
 *     peigne passe déjà contre le comptoir).
 */

/** Templates de comptoir, par ordre de préférence. */
const HARBOR_TPL = "HarborWarehouse";
const PIER_TPL = "TradeBuilding";

/**
 * Comptoir canonique du catalogue. Les `HarborWarehouse` nommés « Harbor Warehouse … »
 * sont les 3 niveaux du comptoir joueur ; les « Harbor … Trader … » sont des comptoirs
 * PNJ (non constructibles) et doivent être écartés. Repli sur la jetée marchande.
 */
export function pickKontorDef(catalog: BuildingDef[], region?: string): BuildingDef | undefined {
  const player = catalog.filter(
    (d) => d.template === HARBOR_TPL && /^Harbor Warehouse/i.test(d.nameInternal ?? ""),
  );
  const byRegion = (list: BuildingDef[]) =>
    (region && list.find((d) => d.region === region)) || list.find((d) => !d.region) || list[0];
  // niveau 1 = plus petit id numérique parmi les comptoirs joueur de la région
  const sorted = [...player].sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0));
  const kontor = byRegion(sorted);
  if (kontor) return kontor;
  const piers = catalog.filter((d) => d.template === PIER_TPL && d.roadRoot);
  return byRegion(piers) ?? catalog.find((d) => d.roadRoot);
}

export interface KontorReservation {
  def: BuildingDef;
  x: number;
  y: number;
  rotation: 0 | 90;
  /** Grille avec l'emprise retirée du masque constructible (à donner aux moteurs). */
  grid: GridShape;
}

/**
 * Réserve une emprise de comptoir sur la CÔTE : toutes les cases sur la terre, au moins
 * une case du périmètre sur la mer. Choisit la position côtière la plus proche du
 * barycentre des terres — le comptoir se retrouve au milieu de la façade maritime, donc
 * à distance-rue raisonnable de tout le futur tissu urbain.
 *
 * Renvoie null si l'île n'a pas de littoral exploitable (grille sans carte `water`, ou
 * aucune emprise ne tient) — l'appelant signale alors un gap.
 */
export function reserveKontor(grid: GridShape, def: BuildingDef): KontorReservation | null {
  const W = grid.w, H = grid.h, N = W * H;
  if (!grid.water) return null;
  const water = grid.water;

  // littoral : case de terre ayant au moins un voisin ortho en mer
  let sumX = 0, sumY = 0, land = 0;
  const coast: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!grid.usable[i]) continue;
      land++; sumX += x; sumY += y;
      const sea =
        (x > 0 && water[i - 1]) || (x < W - 1 && water[i + 1]) ||
        (y > 0 && water[i - W]) || (y < H - 1 && water[i + W]);
      if (sea) coast.push(i);
    }
  }
  if (!land || !coast.length) return null;
  const gx = sumX / land, gy = sumY / land;
  // les cases côtières les plus proches du centre de l'île d'abord (ordre déterministe :
  // distance² entière puis index, donc indépendant de l'ordre de parcours)
  coast.sort((a, b) => {
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0;
    const da = (ax - gx) ** 2 + (ay - gy) ** 2, db = (bx - gx) ** 2 + (by - gy) ** 2;
    return da - db || a - b;
  });

  const fits = (x: number, y: number, w: number, h: number): boolean => {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!grid.usable[(y + j) * W + (x + i)]) return false;
    }
    return true;
  };
  const touchesSea = (x: number, y: number, w: number, h: number): boolean => {
    for (let i = -1; i <= w; i++) {
      for (const yy of [y - 1, y + h]) {
        const c = yy * W + x + i;
        if (yy >= 0 && yy < H && x + i >= 0 && x + i < W && water[c]) return true;
      }
    }
    for (let j = 0; j < h; j++) {
      for (const xx of [x - 1, x + w]) {
        const c = (y + j) * W + xx;
        if (xx >= 0 && xx < W && water[c]) return true;
      }
    }
    return false;
  };

  const dims: [number, number, 0 | 90][] = [];
  const d0 = footprintSize(def, 0), d90 = footprintSize(def, 90);
  dims.push([d0.w, d0.h, 0]);
  if (def.rotatable && (d90.w !== d0.w || d90.h !== d0.h)) dims.push([d90.w, d90.h, 90]);

  for (const c of coast) {
    const cx = c % W, cy = (c / W) | 0;
    for (const [w, h, rot] of dims) {
      // ancrages qui contiennent la case côtière (l'emprise glisse autour d'elle)
      for (let oy = 0; oy < h; oy++) {
        for (let ox = 0; ox < w; ox++) {
          const x = cx - ox, y = cy - oy;
          if (!fits(x, y, w, h) || !touchesSea(x, y, w, h)) continue;
          const usable = grid.usable.slice();
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) usable[(y + j) * W + (x + i)] = false;
          return { def, x, y, rotation: rot, grid: { ...grid, usable } };
        }
      }
    }
  }
  void N;
  return null;
}

export interface KontorPlacement {
  building: PlacedBuilding;
  /** Cases de route ajoutées pour raccorder le comptoir (souvent vide). */
  roads: RoadTile[];
  /** uids de bâtiments rasés par le raccordement (maisons sur le chemin). */
  removed: string[];
  connected: boolean;
}

/**
 * Pose le comptoir réservé et le raccorde au réseau routier produit par le moteur.
 * BFS depuis le périmètre de l'emprise : traverse les cases libres et les RÉSIDENCES
 * (qu'il rase — quelques maisons contre un réseau enraciné), jamais un service.
 */
export function connectKontor(
  grid: GridShape,
  res: KontorReservation,
  buildings: PlacedBuilding[],
  roads: RoadTile[],
  lookup: DefLookup,
  demolishable: (defId: string) => boolean,
): KontorPlacement {
  const W = grid.w, H = grid.h, N = W * H;
  const { w, h } = footprintSize(res.def, res.rotation);
  const building: PlacedBuilding = {
    uid: uid("kontor"), defId: res.def.id, x: res.x, y: res.y, rotation: res.rotation, locked: false,
  };

  const roadAt = new Uint8Array(N);
  for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;
  // occupation : -1 libre, sinon index du bâtiment occupant
  const owner = new Int32Array(N).fill(-1);
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    const d = lookup(b.defId);
    if (!d) continue;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) owner[y * W + x] = bi;
    }
  }

  const perimeter: number[] = [];
  for (let i = -1; i <= w; i++) {
    for (const yy of [res.y - 1, res.y + h]) {
      const x = res.x + i;
      if (yy >= 0 && yy < H && x >= 0 && x < W) perimeter.push(yy * W + x);
    }
  }
  for (let j = 0; j < h; j++) {
    for (const xx of [res.x - 1, res.x + w]) {
      const y = res.y + j;
      if (xx >= 0 && xx < W && y >= 0 && y < H) perimeter.push(y * W + xx);
    }
  }
  // déjà raccordé ? (une ligne du peigne longe l'emprise)
  if (perimeter.some((c) => roadAt[c])) {
    return { building, roads: [], removed: [], connected: true };
  }

  const passable = (c: number): boolean => {
    if (!grid.usable[c]) return false;
    const o = owner[c];
    return o < 0 || demolishable(buildings[o].defId);
  };
  const prev = new Int32Array(N).fill(-2);
  let frontier: number[] = [];
  for (const c of perimeter) {
    if (prev[c] !== -2 || !passable(c)) continue;
    prev[c] = -1;
    frontier.push(c);
  }
  const MAX_STUB = 60;
  for (let depth = 0; depth < MAX_STUB && frontier.length; depth++) {
    const next: number[] = [];
    for (const c of frontier) {
      const x = c % W, y = (c / W) | 0;
      for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
        if (nb < 0 || prev[nb] !== -2) continue;
        if (roadAt[nb]) {
          // remonter le chemin : poser les routes, noter les bâtiments rasés
          const out: RoadTile[] = [];
          const removed = new Set<string>();
          for (let cur = c; cur >= 0; cur = prev[cur]) {
            const o = owner[cur];
            if (o >= 0) removed.add(buildings[o].uid);
            out.push({ x: cur % W, y: (cur / W) | 0 });
          }
          return { building, roads: out, removed: [...removed], connected: true };
        }
        if (!passable(nb)) continue;
        prev[nb] = c;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return { building, roads: [], removed: [], connected: false };
}

/**
 * RÉPARATION DE CONNEXITÉ du réseau routier.
 *
 * L'élagage des moteurs (`pruneRoads`) conserve deux familles de cases : celles adjacentes
 * à un bâtiment (accès) et les chemins BFS maison→service. Rien ne garantit que l'union des
 * deux soit CONNEXE : une case d'accès dont le connecteur a été élagué devient un îlot, et
 * en jeu un bâtiment desservi par une route isolée du comptoir reste inactif. Mesuré sur une
 * île 320² : 744 cases de route sur 11 329 (6,6 %) hors du réseau enraciné.
 *
 * On repart du comptoir, on marque le réseau atteignable, puis on tente de raccrocher chaque
 * îlot par un court chemin (≤ `maxDetour` cases libres). Les îlots irrécupérables sont
 * renvoyés pour signalement — on ne les supprime pas, sinon les bâtiments qu'ils desservent
 * perdraient leur seul accès et l'anomalie deviendrait invisible.
 */
export function repairRoadConnectivity(
  grid: GridShape,
  buildings: PlacedBuilding[],
  roads: RoadTile[],
  lookup: DefLookup,
  maxDetour = 24,
): { roads: RoadTile[]; added: number; dropped: number; orphans: number } {
  const W = grid.w, H = grid.h, N = W * H;
  const roadAt = new Uint8Array(N);
  for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;
  const occ = new Uint8Array(N);
  const owner = new Int32Array(N).fill(-1);
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    const d = lookup(b.defId);
    if (!d) continue;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) { occ[y * W + x] = 1; owner[y * W + x] = bi; }
    }
  }
  const nb4 = (c: number): number[] => {
    const x = c % W, y = (c / W) | 0;
    const out: number[] = [];
    if (x > 0) out.push(c - 1);
    if (x < W - 1) out.push(c + 1);
    if (y > 0) out.push(c - W);
    if (y < H - 1) out.push(c + W);
    return out;
  };

  // noyau = composante atteignable depuis les racines (comptoir/entrepôt)
  const inCore = new Uint8Array(N);
  const seeds: number[] = [];
  for (const b of buildings) {
    const d = lookup(b.defId);
    if (!d?.roadRoot) continue;
    const fp = footprintSize(d, b.rotation);
    for (let i = -1; i <= fp.w; i++) {
      for (const yy of [b.y - 1, b.y + fp.h]) {
        const x = b.x + i;
        if (yy >= 0 && yy < H && x >= 0 && x < W && roadAt[yy * W + x]) seeds.push(yy * W + x);
      }
    }
    for (let j = 0; j < fp.h; j++) {
      for (const xx of [b.x - 1, b.x + fp.w]) {
        const y = b.y + j;
        if (xx >= 0 && xx < W && y >= 0 && y < H && roadAt[y * W + xx]) seeds.push(y * W + xx);
      }
    }
  }
  if (!seeds.length) return { roads, added: 0, dropped: 0, orphans: 0 };
  const grow = (from: number[]) => {
    let fr = from.filter((c) => !inCore[c]);
    for (const c of fr) inCore[c] = 1;
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) for (const n of nb4(c)) {
        if (roadAt[n] && !inCore[n]) { inCore[n] = 1; next.push(n); }
      }
      fr = next;
    }
  };
  grow(seeds);

  // un bâtiment a-t-il déjà un accès sur le réseau enraciné ?
  const servedByCore = new Uint8Array(buildings.length);
  for (let c = 0; c < N; c++) {
    if (!inCore[c]) continue;
    for (const n of nb4(c)) if (owner[n] >= 0) servedByCore[owner[n]] = 1;
  }

  // îlots : composantes de routes hors noyau, traitées une par une
  const drop = new Uint8Array(N);
  const extra: number[] = [];
  const seen = new Uint8Array(N);
  let added = 0, dropped = 0, orphans = 0;
  for (let i = 0; i < N; i++) {
    if (!roadAt[i] || inCore[i] || seen[i]) continue;
    const comp: number[] = [];
    let fr = [i];
    seen[i] = 1;
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) {
        comp.push(c);
        for (const n of nb4(c)) if (roadAt[n] && !seen[n]) { seen[n] = 1; next.push(n); }
      }
      fr = next;
    }
    // raccrochage : BFS court depuis l'îlot, à travers les cases LIBRES, vers le noyau
    const prev = new Map<number, number>();
    let frontier: number[] = [];
    for (const c of comp) { prev.set(c, -1); frontier.push(c); }
    let linked = false;
    for (let depth = 0; depth <= maxDetour && frontier.length && !linked; depth++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (const n of nb4(c)) {
          if (prev.has(n)) continue;
          if (inCore[n]) {
            for (let cur = c; cur >= 0 && !roadAt[cur]; cur = prev.get(cur)!) {
              roadAt[cur] = 1;
              extra.push(cur);
              added++;
            }
            linked = true;
            break;
          }
          // les cases de route (y compris d'AUTRES îlots) sont traversables : un îlot peut
          // rejoindre le noyau en passant par un îlot voisin. Seuls les bâtiments et la mer
          // bloquent.
          if (occ[n] || !grid.usable[n]) continue;
          prev.set(n, c);
          next.push(n);
        }
        if (linked) break;
      }
      frontier = next;
    }
    if (linked) { grow(comp); continue; }
    // Irrécupérable. Deux cas très différents :
    //  - tous les bâtiments qu'il dessert touchent déjà le réseau enraciné → l'îlot ne sert
    //    À RIEN (reliquat d'élagage : case d'accès secondaire d'une maison). On le SUPPRIME,
    //    c'est du sol rendu et une route de moins à payer.
    //  - sinon des bâtiments n'ont d'accès QUE par cet îlot → ils seraient inactifs en jeu.
    //    On garde et on signale : supprimer masquerait l'anomalie.
    const served = new Set<number>();
    for (const c of comp) for (const n of nb4(c)) if (owner[n] >= 0) served.add(owner[n]);
    const useless = [...served].every((bi) => servedByCore[bi]);
    if (useless) {
      for (const c of comp) { drop[c] = 1; roadAt[c] = 0; }
      dropped += comp.length;
    } else {
      orphans += comp.length;
    }
  }
  const out: RoadTile[] = [];
  for (const r of roads) {
    if (r.x < 0 || r.y < 0 || r.x >= W || r.y >= H || !drop[r.y * W + r.x]) out.push(r);
  }
  for (const c of extra) out.push({ x: c % W, y: (c / W) | 0 });
  return { roads: out, added, dropped, orphans };
}
