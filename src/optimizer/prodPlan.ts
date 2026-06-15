import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { chainFertilities, economy } from "../economy/economy";
import { solve, type SolveResult } from "../economy/solve";
import { anneal } from "./anneal";
import { DEFAULT_WEIGHTS } from "./types";
import { blockMountains, MOUNTAIN_BLOCK_RADIUS } from "./waterPlan";

// zone posable/traversable autour d'un slot montagne (alignée sur waterPlan)
const MOUNTAIN_ZONE = MOUNTAIN_BLOCK_RADIUS + 2;

/**
 * Plan d'île PRODUCTION (archetype « île d'export », cf. session refonte) :
 * objectif = un bien + un débit (u/min) → chaîne amont complète + main-d'œuvre
 * LOCALE (pas de navettage inter-île en vanilla [WEB]) + entrepôts.
 *
 *  1. Solveur économie : bâtiments de prod (chaîne explosée) + maisons ouvrières
 *     + leurs services (cascade workforce → pop → besoins).
 *  2. Placement de masse : recuit existant (étagères, routes auto, champs de ferme).
 *  3. MINES (SlotFactoryBuilding7) : déplacées sur les slots MONTAGNE (1 slot = 1
 *     mine), reliées au réseau routier par un stub.
 *  4. ENTREPÔTS : semés en min-cover — chaque prod doit avoir un entrepôt à
 *     ≤ transporterRange en DISTANCE-RUE (donnée exacte du jeu, défaut 30) sinon
 *     les biens ne partent pas. Couverture par BFS le long des routes.
 */

export interface ProdPlanResult {
  mode: "production";
  good: string;
  ratePerMin: number;
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  fields: FieldTile[];
  houses: number;
  prodsTotal: number;
  prodsCovered: number; // prods avec entrepôt à portée
  warehousesPlaced: number;
  placed: number; // bâtiments demandés effectivement posés (recuit)
  requested: number;
  solution: SolveResult;
  // fertilités/gisements exigés par la chaîne (available=false ⇒ chaîne impossible
  // sur cette île tant que la fertilité n'est pas débloquée)
  requiredFertilities: { guid: string; name: string; available: boolean }[];
  gaps: string[];
}

const WAREHOUSE_TPL = "Warehouse";
const MINE_TPL = "SlotFactoryBuilding7";
const DEFAULT_RANGE = 30;

export function planIslandProduction(
  catalog: BuildingDef[],
  grid: GridShape,
  lookup: DefLookup,
  good: string,
  ratePerMin: number,
  opts: { timeMs?: number; islandFertilities?: string[] } = {},
  onProgress?: (step: number, total: number) => void,
): ProdPlanResult {
  const gaps: string[] = [];
  const W = grid.w, H = grid.h, N = W * H;

  // --- 1. solveur : chaîne + workforce locale + services ouvriers ---
  // région de l'île → préférence de producteur (pas de chaîne celtique sur île romaine)
  const islandRegion = grid.islandId?.includes("celtic") ? "Celtic" : "Roman";
  onProgress?.(1, 4);
  const sol = solve(
    [],
    { includeProduction: true, includeServices: true, includeWorkforce: true, capacities: {}, region: islandRegion },
    { [good]: ratePerMin },
  );
  if (!sol.items.length) throw new Error("Aucun producteur connu pour ce bien.");
  if (!sol.converged) gaps.push("Cascade main-d'œuvre non convergée : résultat = besoins directs");

  // fertilités exigées par la chaîne ; si l'île ne les a pas (saisie utilisateur),
  // la chaîne est impossible en jeu → gap explicite (sélection vide = toutes supposées OK)
  const haveFert = opts.islandFertilities && opts.islandFertilities.length ? new Set(opts.islandFertilities) : null;
  const requiredFertilities = [...chainFertilities(good, islandRegion)].map((guid) => ({
    guid, name: economy.fertilities[guid] ?? guid, available: !haveFert || haveFert.has(guid),
  }));
  for (const f of requiredFertilities) {
    if (!f.available) gaps.push(`Fertilité absente de l'île : ${f.name} (chaîne impossible)`);
  }

  const mines: { defId: string; qty: number }[] = [];
  const others: { defId: string; qty: number }[] = [];
  for (const it of sol.items) {
    (lookup(it.defId)?.template === MINE_TPL ? mines : others).push(it);
  }

  // --- 2. placement de masse (recuit : étagères + routes + champs) ---
  // Les ENTREPÔTS sont injectés dans le recuit (posés DANS les étagères, accès
  // route garanti) — les caser après coup échouait sur les zones denses en champs.
  onProgress?.(2, 4);
  const whDef = catalog.find((d) => d.template === WAREHOUSE_TPL && d.region === "Roman")
    ?? catalog.find((d) => d.template === WAREHOUSE_TPL);
  const prodCount = sol.items.reduce((s, it) => s + (lookup(it.defId)?.production ? it.qty : 0), 0);
  const annealItems = whDef && prodCount
    ? [...others, { defId: whDef.id, qty: Math.ceil(prodCount / 8) + 1 }]
    : others;
  const planGrid = blockMountains(grid);
  const { out } = anneal({
    catalog,
    grid: planGrid,
    lockedBuildings: [],
    existingRoads: [],
    existingFields: [],
    items: annealItems,
    weights: DEFAULT_WEIGHTS,
    timeMs: opts.timeMs ?? 3000,
  });
  const buildings = [...out.buildings];
  const roads: RoadTile[] = [...out.roads];
  const fields: FieldTile[] = [...out.fields];

  // occupation + routes (pour mines, stubs et entrepôts)
  const occ = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!grid.usable[i]) occ[i] = 1;
  const roadAt = new Uint8Array(N);
  for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;
  const fpOf = (b: PlacedBuilding): { x: number; y: number; w: number; h: number } | null => {
    const d = lookup(b.defId);
    return d ? { x: b.x, y: b.y, ...footprintSize(d, b.rotation) } : null;
  };
  for (const b of buildings) {
    const fp = fpOf(b);
    if (!fp) continue;
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = fp.x + i, y = fp.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1;
    }
  }
  // champs marqués SÉPARÉMENT : un entrepôt peut les écraser (perte de quelques
  // tuiles de champ = perte de prod mineure, comme en vrai jeu), pas un bâtiment.
  const fieldAt = new Uint8Array(N);
  for (const f of fields) if (f.x >= 0 && f.y >= 0 && f.x < W && f.y < H) { occ[f.y * W + f.x] = 1; fieldAt[f.y * W + f.x] = 1; }

  // --- 3. mines sur slots MONTAGNE + stub route ---
  onProgress?.(3, 4);
  const slots = (grid.slots ?? []).filter((s) => s.type === "mountain");
  const freeSlots = [...slots];
  const placeMine = (def: BuildingDef): boolean => {
    for (let si = 0; si < freeSlots.length; si++) {
      const s = freeSlots[si];
      // spirale autour du slot (zone montagne non-usable : autorisée pour les mines)
      for (let r = 0; r <= MOUNTAIN_ZONE; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = s.x + dx - (def.size.w >> 1), y = s.y + dy - (def.size.h >> 1);
          if (x < 0 || y < 0 || x + def.size.w > W || y + def.size.h > H) continue;
          let ok = true;
          for (let j = 0; j < def.size.h && ok; j++) for (let i = 0; i < def.size.w; i++) {
            const c = (y + j) * W + (x + i);
            // bâtiments interdits ; hors-terre toléré (montagne) ; routes interdites
            if (roadAt[c]) { ok = false; break; }
            if (occ[c] && grid.usable[c]) { ok = false; break; }
            const nearSlot = Math.abs(x + i - s.x) <= MOUNTAIN_ZONE && Math.abs(y + j - s.y) <= MOUNTAIN_ZONE;
            if (!grid.usable[c] && !nearSlot) { ok = false; break; }
          }
          if (!ok) continue;
          buildings.push({ uid: uid("mine"), defId: def.id, x, y, rotation: 0, locked: false });
          for (let j = 0; j < def.size.h; j++) for (let i = 0; i < def.size.w; i++) occ[(y + j) * W + (x + i)] = 1;
          // stub route : BFS cases libres depuis le périmètre vers le réseau
          stubToRoads(x, y, def.size.w, def.size.h);
          freeSlots.splice(si, 1);
          return true;
        }
      }
    }
    return false;
  };
  const stubToRoads = (x: number, y: number, w: number, h: number) => {
    const prev = new Map<number, number>();
    let frontier: number[] = [];
    for (let i = -1; i <= w; i++) for (let j = -1; j <= h; j++) {
      const edge = (i >= 0 && i < w) !== (j >= 0 && j < h);
      if (!edge) continue;
      const px = x + i, py = y + j;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const c = py * W + px;
      if (roadAt[c]) return; // déjà raccordé
      if (occ[c] || !grid.usable[c] || prev.has(c)) continue;
      prev.set(c, -1);
      frontier.push(c);
    }
    for (let depth = 0; depth < 80 && frontier.length; depth++) {
      const next: number[] = [];
      for (const c of frontier) {
        const cx = c % W, cy = (c / W) | 0;
        for (const nb of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, cy > 0 ? c - W : -1, cy < H - 1 ? c + W : -1]) {
          if (nb < 0 || prev.has(nb)) continue;
          if (roadAt[nb]) {
            let cur = c;
            while (cur >= 0) { roadAt[cur] = 1; roads.push({ x: cur % W, y: (cur / W) | 0 }); cur = prev.get(cur)!; }
            return;
          }
          if (occ[nb] || !grid.usable[nb]) continue;
          prev.set(nb, c);
          next.push(nb);
        }
      }
      frontier = next;
    }
  };
  for (const m of mines) {
    const def = lookup(m.defId);
    if (!def) continue;
    for (let k = 0; k < m.qty; k++) {
      if (!placeMine(def)) {
        gaps.push(`${def.name} : plus de slot montagne libre (${m.qty - k} non posée(s))`);
        break;
      }
    }
  }

  // --- 4. entrepôts : min-cover distance-rue sur les prods ---
  // (ceux du recuit comptent d'abord ; le greedy ne fait que COMPLÉTER)
  onProgress?.(4, 4);
  const prods = buildings.filter((b) => {
    const d = lookup(b.defId);
    return d && (d.production || d.template === MINE_TPL);
  });
  let covered = 0;
  let whPlaced = 0;
  if (!whDef) {
    gaps.push("Aucun entrepôt au catalogue");
  } else if (prods.length) {
    // BFS routes par prod → cases route à ≤ transporterRange ; un entrepôt couvre la
    // prod s'il est ortho-adjacent à une de ces cases.
    // visited partagé + époques : un fill(-1) plein-grille par prod coûtait ~2,4 Mo × prods.
    const reachCount = new Map<number, number[]>(); // case route -> indices de prods
    const seenEpoch = new Int32Array(N);
    for (let pi = 0; pi < prods.length; pi++) {
      const fp = fpOf(prods[pi])!;
      const range = lookup(prods[pi].defId)?.transporterRange ?? DEFAULT_RANGE;
      const ep = pi + 1;
      const visit = (c: number): boolean => {
        if (seenEpoch[c] === ep) return false;
        seenEpoch[c] = ep;
        return true;
      };
      let frontier: number[] = [];
      for (let i = 0; i < fp.w; i++) {
        for (const yy of [fp.y - 1, fp.y + fp.h]) {
          const c = yy * W + fp.x + i;
          if (yy >= 0 && yy < H && roadAt[c] && visit(c)) frontier.push(c);
        }
      }
      for (let j = 0; j < fp.h; j++) {
        for (const xx of [fp.x - 1, fp.x + fp.w]) {
          const c = (fp.y + j) * W + xx;
          if (xx >= 0 && xx < W && roadAt[c] && visit(c)) frontier.push(c);
        }
      }
      let d = 1;
      const reach: number[] = [...frontier];
      while (frontier.length && d < range) {
        const next: number[] = [];
        for (const c of frontier) {
          const cx = c % W, cy = (c / W) | 0;
          for (const nb of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, cy > 0 ? c - W : -1, cy < H - 1 ? c + W : -1]) {
            if (nb < 0 || !roadAt[nb] || !visit(nb)) continue;
            reach.push(nb);
            next.push(nb);
          }
        }
        frontier = next;
        d++;
      }
      for (const c of reach) {
        let arr = reachCount.get(c);
        if (!arr) reachCount.set(c, (arr = []));
        arr.push(pi);
      }
    }
    // candidats : emprise sur terre, hors route, hors BÂTIMENT — les CHAMPS sont
    // écrasables (qq tuiles de champ perdues ≪ prod débloquée faute d'entrepôt).
    const ww = whDef.size.w, wh = whDef.size.h;
    const fits = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x + ww > W || y + wh > H) return false;
      for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) {
        const c = (y + j) * W + (x + i);
        if (roadAt[c] || !grid.usable[c]) return false;
        if (occ[c] && !fieldAt[c]) return false; // bâtiment/mer : interdit ; champ : OK
      }
      return true;
    };
    const stampWarehouse = (x: number, y: number) => {
      buildings.push({ uid: uid("wh"), defId: whDef.id, x, y, rotation: 0, locked: false });
      whPlaced++;
      for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) {
        const c = (y + j) * W + (x + i);
        occ[c] = 1;
        if (fieldAt[c]) fieldAt[c] = 0; // tuile de champ consommée par l'entrepôt
      }
    };
    const adjacentReach = (x: number, y: number): number[] => {
      const out = new Set<number>();
      for (let i = 0; i < ww; i++) {
        for (const yy of [y - 1, y + wh]) {
          if (yy < 0 || yy >= H) continue;
          for (const pi of reachCount.get(yy * W + x + i) ?? []) out.add(pi);
        }
      }
      for (let j = 0; j < wh; j++) {
        for (const xx of [x - 1, x + ww]) {
          if (xx < 0 || xx >= W) continue;
          for (const pi of reachCount.get((y + j) * W + xx) ?? []) out.add(pi);
        }
      }
      return [...out];
    };
    const coveredSet = new Set<number>();
    // entrepôts déjà posés par le RECUIT : ils couvrent les prods dont le reach
    // touche leur emprise (accès route garanti par l'étagère)
    for (const b of buildings) {
      if (b.defId !== whDef.id) continue;
      whPlaced++;
      for (const pi of adjacentReach(b.x, b.y)) coveredSet.add(pi);
    }
    for (let iter = 0; iter < 30 && coveredSet.size < prods.length; iter++) {
      let bx = -1, by = -1, bestGain = 0, bestIds: number[] = [];
      // candidats échantillonnés le long des routes (positions autour des cases route)
      for (const [c] of reachCount) {
        const rx = c % W, ry = (c / W) | 0;
        for (const [px, py] of [[rx + 1, ry], [rx - ww, ry], [rx, ry + 1], [rx, ry - wh]] as const) {
          if (!fits(px, py)) continue;
          const ids = adjacentReach(px, py).filter((pi) => !coveredSet.has(pi));
          if (ids.length > bestGain) { bestGain = ids.length; bx = px; by = py; bestIds = ids; }
        }
      }
      if (bx < 0 || bestGain === 0) break;
      stampWarehouse(bx, by);
      for (const pi of bestIds) coveredSet.add(pi);
    }
    // repli : entrepôt COLLÉ aux prods encore non couvertes (distance-rue ~1)
    for (let pi = 0; pi < prods.length; pi++) {
      if (coveredSet.has(pi)) continue;
      const fp = fpOf(prods[pi])!;
      let done = false;
      for (let ring = 1; ring <= 3 && !done; ring++) {
        for (let j = -ring - wh + 1; j <= fp.h + ring - 1 && !done; j++) {
          for (let i = -ring - ww + 1; i <= fp.w + ring - 1 && !done; i++) {
            const px = fp.x + i, py = fp.y + j;
            // emprise hors de la prod, à distance ring de son périmètre
            if (px + ww > fp.x && px < fp.x + fp.w && py + wh > fp.y && py < fp.y + fp.h) continue;
            if (!fits(px, py)) continue;
            stampWarehouse(px, py);
            coveredSet.add(pi);
            done = true;
          }
        }
      }
    }
    covered = coveredSet.size;
    if (covered < prods.length) {
      gaps.push(`${prods.length - covered} bâtiment(s) de production sans entrepôt à portée de charrette`);
    }
  }

  const residenceIds = new Set(catalog.filter((d) => d.category === "residentiel").map((d) => d.id));
  const houses = buildings.filter((b) => residenceIds.has(b.defId)).length;

  return {
    mode: "production",
    good,
    ratePerMin,
    buildings,
    roads,
    fields: fields.filter((f) => fieldAt[f.y * W + f.x] === 1), // champs consommés par entrepôt retirés
    houses,
    prodsTotal: prods.length,
    prodsCovered: covered,
    warehousesPlaced: whPlaced,
    placed: out.buildings.length,
    requested: annealItems.reduce((s, it) => s + it.qty, 0) + mines.reduce((s, it) => s + it.qty, 0),
    solution: sol,
    requiredFertilities,
    gaps: [...new Set(gaps)],
  };
}
