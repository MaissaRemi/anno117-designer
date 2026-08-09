import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import { economy, goodName, priceOf } from "../economy/economy";
import type { DefLookup } from "../engine/rules";
import type { BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { MOUNTAIN_BLOCK_RADIUS } from "./waterPlan";
import { pickWarehouseDef } from "./kontor";

/**
 * EXPLOITATION DES EMPLACEMENTS DE TERRAIN LAISSÉS LIBRES.
 *
 * Une île porte des `slots` extraits de ses fichiers : montagne, rivière, marais. Le
 * planificateur n'en utilisait qu'un usage — les sources d'aqueduc, sur les slots montagne.
 * Tous les autres restaient inertes, alors qu'ils portent les seules productions que le
 * terrain rend possibles : mines et carrières sur la montagne, argile / esturgeons sur la
 * rivière, tourbe / anguilles / bœufs sur le marais.
 *
 * L'EAU RESTE PRIORITAIRE : ce module ne voit que le complément, `slots − usedSlots`
 * (cf. `WaterPlanResult.usedSlots`). Il est appelé APRÈS le routage d'eau, jamais avant.
 *
 * Le lien bâtiment ↔ slot vient de `Factory7/RawResourceType` (Mountain / River), extrait
 * dans le catalogue sous `slotType`. Sans cette donnée on ne pouvait que deviner par le nom.
 *
 * Une exploitation ne sert à rien si ses marchandises ne partent pas : chaque bâtiment posé
 * doit voir un entrepôt à moins de `transporterRange` **en distance-rue** (donnée exacte du
 * jeu, 30 par défaut). Le module pose donc aussi les entrepôts manquants, en couverture
 * gloutonne, et raccorde tout au réseau routier.
 */

const DEFAULT_RANGE = 30;
/** Rayon de recherche autour d'un slot, aligné sur la zone montagne réservée. */
const PLACE_RADIUS = MOUNTAIN_BLOCK_RADIUS + 2;
/** Un slot est considéré consommé par l'eau si une source a été prise à cette distance. */
const SLOT_MATCH = 2;

export interface SlotPlanOptions {
  /** Fertilités/gisements déclarés de l'île. Vide/absent = toutes supposées présentes. */
  fertilities?: string[];
  /**
   * PRÉFÉRENCE par type d'emplacement — « sur les slots montagne, mets du fer ».
   *
   * Elle ne peut que restreindre le choix : un bâtiment hors région, sans le gisement déclaré
   * ou que l'île ne saura pas armer reste écarté. Une préférence infaisable est ignorée et
   * signalée, jamais imposée.
   */
  slotPrefs?: Record<string, string>;
  /** Région de l'île ("Roman" / "Celtic") : un bâtiment d'une autre région est écarté. */
  region?: string;
  /**
   * GUICHET DE MAIN-D'ŒUVRE. Une exploitation n'est posée que si l'île peut l'armer — non pas
   * « le palier est hébergeable quelque part », mais « il reste assez d'ouvriers de ce palier
   * après tout ce qui a déjà été engagé ». Le devis est demandé À CHAQUE POSE, et débité.
   *
   * La version précédente filtrait qualitativement, sur un simple ensemble de paliers
   * atteignables : une seule maison plébéienne hébergeable laissait poser quatre laveurs d'or
   * réclamant seize unités.
   */
  workforce?: {
    quote(defIds: string[]): Record<string, number> | null;
    charge(defIds: string[]): void;
  };
}

export interface ExploitedSlot {
  defId: string;
  name: string;
  slotType: string;
  good: string;
  goodName: string;
  perMin: number;
  x: number;
  y: number;
  /** Un entrepôt est-il à portée de charrette ? Sinon la production ne sort pas. */
  served: boolean;
}

export interface SlotPlanResult {
  /** Exploitations + entrepôts posés. */
  buildings: PlacedBuilding[];
  /** Cases de route ajoutées pour les raccordements. */
  roads: RoadTile[];
  /** uids de bâtiments rasés (maisons sur un tracé de raccordement ou sous un entrepôt). */
  removed: string[];
  exploited: ExploitedSlot[];
  warehouses: number;
  gaps: string[];
}

/** Débit d'un producteur, en unités/minute (0 si la donnée manque). */
function ratePerMin(defId: string): { good: string; perMin: number } | null {
  const p = economy.buildingProd[defId];
  const out = p?.outputs?.[0];
  if (!p?.cycleTime || !out?.good) return null;
  return { good: out.good, perMin: (out.amount / p.cycleTime) * 60 };
}

/**
 * Meilleur bâtiment pour un type de slot : celui dont la production a la plus forte
 * VALEUR MARCHANDE par minute (débit × prix de base). Écarte ce qui n'est pas de la région
 * de l'île, et ce dont le gisement requis n'est pas déclaré sur l'île.
 */
export function pickSlotBuilding(
  catalog: BuildingDef[],
  slotType: string,
  opts: SlotPlanOptions = {},
): BuildingDef | undefined {
  const have = opts.fertilities?.length ? new Set(opts.fertilities) : null;
  const scored = catalog
    .filter((d) => d.slotType === slotType)
    .filter((d) => !opts.region || !d.region || d.region === opts.region)
    .filter((d) => {
      const fert = economy.buildingProd[d.id]?.fertility;
      return !fert || !have || have.has(fert);
    })
    // MAIN-D'ŒUVRE : écarte d'emblée ce que l'île ne pourra jamais armer, même en y
    // consacrant toutes ses maisons. Le contrôle fin — « en reste-t-il assez ? » — se fait
    // à la pose, exemplaire par exemplaire.
    .filter((d) => !opts.workforce || opts.workforce.quote([d.id]) !== null)
    .map((d) => {
      const r = ratePerMin(d.id);
      return { d, value: r ? r.perMin * priceOf(r.good) : 0 };
    })
    // valeur décroissante, puis id — déterministe
    .sort((a, b) => b.value - a.value || a.d.id.localeCompare(b.d.id));
  // PRÉFÉRENCE DE L'UTILISATEUR pour ce type d'emplacement. Elle ne peut que RESTREINDRE :
  // un bâtiment d'un autre monde, sans le gisement déclaré, ou que l'île ne saura jamais
  // armer, a déjà été écarté ci-dessus et ne revient pas par cette porte. Une préférence
  // infaisable n'est donc pas une erreur — on retombe simplement sur le meilleur candidat,
  // et l'appelant le signale.
  const wish = opts.slotPrefs?.[slotType];
  if (wish) {
    const hit = scored.find((x) => x.d.id === wish);
    if (hit) return hit.d;
  }
  return scored[0]?.d;
}

export function planSlots(
  grid: GridShape,
  catalog: BuildingDef[],
  lookup: DefLookup,
  existing: PlacedBuilding[],
  roads: RoadTile[],
  usedSlots: { x: number; y: number }[],
  demolishable: (defId: string) => boolean,
  opts: SlotPlanOptions = {},
): SlotPlanResult {
  const W = grid.w, H = grid.h, N = W * H;
  const gaps: string[] = [];
  const out: SlotPlanResult = {
    buildings: [], roads: [], removed: [], exploited: [], warehouses: 0, gaps,
  };

  const slots = (grid.slots ?? []).filter((s) => s.type === "mountain" || s.type === "river" || s.type === "marsh");
  if (!slots.length) return out;

  // --- état d'occupation partagé -----------------------------------------------------
  const roadAt = new Uint8Array(N);
  for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;
  const owner = new Int32Array(N).fill(-1); // index dans `all`
  const all = [...existing];
  const stampOcc = (b: PlacedBuilding, idx: number) => {
    const d = lookup(b.defId);
    if (!d) return;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) owner[y * W + x] = idx;
    }
  };
  all.forEach(stampOcc);
  const removed = new Set<string>();

  const nb4 = (c: number): number[] => {
    const x = c % W, y = (c / W) | 0;
    const o: number[] = [];
    if (x > 0) o.push(c - 1);
    if (x < W - 1) o.push(c + 1);
    if (y > 0) o.push(c - W);
    if (y < H - 1) o.push(c + W);
    return o;
  };

  // Une exploitation de slot se pose SUR le relief : la case peut être hors du masque
  // constructible (montagne, berge) tant qu'elle est proche du slot. Ailleurs, terre exigée.
  const nearSlot = (x: number, y: number, s: { x: number; y: number }) =>
    Math.abs(x - s.x) <= PLACE_RADIUS && Math.abs(y - s.y) <= PLACE_RADIUS;
  const freeFor = (x: number, y: number, w: number, h: number, s: { x: number; y: number }): boolean => {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (y + j) * W + (x + i);
      if (owner[c] >= 0 || roadAt[c]) return false;
      if (!grid.usable[c] && !nearSlot(x + i, y + j, s)) return false;
    }
    return true;
  };

  /**
   * Raccorde une emprise au réseau routier ; rase les résidences sur le tracé.
   *
   * `anchor` (le slot) élargit la tolérance : les cases de RIVIÈRE et de MONTAGNE sont hors
   * du masque constructible, or c'est précisément là que ces bâtiments se posent. Sans
   * cette tolérance, un puits d'argile ou une mine ne pouvait même pas amorcer son BFS
   * depuis son propre périmètre — il restait sans route, donc sans entrepôt à portée.
   */
  const linkToRoads = (x: number, y: number, w: number, h: number, anchor?: { x: number; y: number }, maxLen = 80): boolean => {
    const perim: number[] = [];
    for (let i = -1; i <= w; i++) {
      for (const yy of [y - 1, y + h]) {
        if (yy >= 0 && yy < H && x + i >= 0 && x + i < W) perim.push(yy * W + x + i);
      }
    }
    for (let j = 0; j < h; j++) {
      for (const xx of [x - 1, x + w]) {
        if (xx >= 0 && xx < W && y + j >= 0 && y + j < H) perim.push((y + j) * W + xx);
      }
    }
    if (perim.some((c) => roadAt[c])) return true; // déjà au bord d'une route
    const passable = (c: number): boolean => {
      const cx = c % W, cy = (c / W) | 0;
      if (!grid.usable[c] && !(anchor && nearSlot(cx, cy, anchor))) return false;
      const o = owner[c];
      return o < 0 || demolishable(all[o].defId);
    };
    const prev = new Int32Array(N).fill(-2);
    let fr: number[] = [];
    for (const c of perim) {
      if (prev[c] !== -2 || !passable(c)) continue;
      prev[c] = -1; fr.push(c);
    }
    for (let depth = 0; depth < maxLen && fr.length; depth++) {
      const next: number[] = [];
      for (const c of fr) {
        for (const n of nb4(c)) {
          if (prev[n] !== -2) continue;
          if (roadAt[n]) {
            for (let cur = c; cur >= 0; cur = prev[cur]) {
              const o = owner[cur];
              if (o >= 0) { removed.add(all[o].uid); owner[cur] = -1; }
              roadAt[cur] = 1;
              out.roads.push({ x: cur % W, y: (cur / W) | 0 });
            }
            return true;
          }
          if (!passable(n)) continue;
          prev[n] = c; next.push(n);
        }
      }
      fr = next;
    }
    return false;
  };

  // --- 1. slots encore libres (l'eau a servi en premier) ------------------------------
  const taken = (s: { x: number; y: number }) =>
    usedSlots.some((u) => Math.abs(u.x - Math.round(s.x)) <= SLOT_MATCH && Math.abs(u.y - Math.round(s.y)) <= SLOT_MATCH);
  const free = slots.filter((s) => !taken(s));

  // --- 2. pose d'une exploitation par slot libre ---------------------------------------
  const byType = new Map<string, BuildingDef | undefined>();
  const placedIdx: number[] = []; // index dans `all` des exploitations posées
  for (const s of free) {
    if (!byType.has(s.type)) byType.set(s.type, pickSlotBuilding(catalog, s.type, opts));
    const def = byType.get(s.type);
    if (!def) continue;
    // Devis AVANT de poser : le vivier peut s'épuiser en cours de route, chaque exemplaire
    // consommant sa part. C'est ce que le filtre qualitatif ne voyait pas.
    if (opts.workforce && !opts.workforce.quote([def.id])) {
      out.gaps.push(`${def.name} : main-d'œuvre insuffisante pour un exemplaire de plus`);
      break;
    }
    const sx = Math.round(s.x), sy = Math.round(s.y);
    const dims: [number, number, 0 | 90][] = [
      [def.size.w, def.size.h, 0],
      [def.size.h, def.size.w, 90],
    ];
    let done = false;
    for (let r = 0; r <= PLACE_RADIUS && !done; r++) {
      for (let dy = -r; dy <= r && !done; dy++) for (let dx = -r; dx <= r && !done; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const [w, h, rot] of dims) {
          const x = sx + dx - (w >> 1), y = sy + dy - (h >> 1);
          if (!freeFor(x, y, w, h, { x: sx, y: sy })) continue;
          const b: PlacedBuilding = { uid: uid("slot"), defId: def.id, x, y, rotation: rot, locked: false };
          const idx = all.length;
          all.push(b);
          stampOcc(b, idx);
          out.buildings.push(b);
          opts.workforce?.charge([def.id]);
          placedIdx.push(idx);
          linkToRoads(x, y, w, h, { x: sx, y: sy });
          const r0 = ratePerMin(def.id);
          out.exploited.push({
            defId: def.id, name: def.name, slotType: s.type,
            good: r0?.good ?? "", goodName: goodName(r0?.good ?? null),
            perMin: Math.round((r0?.perMin ?? 0) * 100) / 100,
            x, y, served: false,
          });
          done = true;
          break;
        }
      }
    }
    if (!done) gaps.push(`${def.name} : emplacement ${s.type} inexploitable (encombrement)`);
  }
  if (!out.exploited.length) {
    if (free.length) gaps.push("Emplacements libres non exploitables : aucun bâtiment compatible (région ou gisement absent)");
    return out;
  }

  // --- 3. entrepôts : couverture en DISTANCE-RUE ---------------------------------------
  // Un producteur n'expédie que si un entrepôt est à ≤ transporterRange le long des routes.
  const whDef = pickWarehouseDef(catalog, opts.region);
  if (!whDef) {
    gaps.push("Aucun entrepôt au catalogue : les exploitations ne peuvent pas expédier");
    return out;
  }

  // cases route atteintes par chaque exploitation, dans sa portée de charrette
  const reachOf = new Map<number, number[]>(); // case route → indices d'exploitation
  const epoch = new Int32Array(N);
  out.exploited.forEach((e, ei) => {
    const def = lookup(e.defId)!;
    const b = all[placedIdx[ei]];
    const fp = footprintSize(def, b.rotation);
    const range = def.transporterRange ?? DEFAULT_RANGE;
    const stamp = ei + 1;
    let fr: number[] = [];
    for (let i = -1; i <= fp.w; i++) {
      for (const yy of [b.y - 1, b.y + fp.h]) {
        const c = yy * W + b.x + i;
        if (yy >= 0 && yy < H && b.x + i >= 0 && b.x + i < W && roadAt[c] && epoch[c] !== stamp) { epoch[c] = stamp; fr.push(c); }
      }
    }
    for (let j = 0; j < fp.h; j++) {
      for (const xx of [b.x - 1, b.x + fp.w]) {
        const c = (b.y + j) * W + xx;
        if (xx >= 0 && xx < W && roadAt[c] && epoch[c] !== stamp) { epoch[c] = stamp; fr.push(c); }
      }
    }
    const seen = [...fr];
    for (let d = 1; d < range && fr.length; d++) {
      const next: number[] = [];
      for (const c of fr) for (const n of nb4(c)) {
        if (!roadAt[n] || epoch[n] === stamp) continue;
        epoch[n] = stamp; seen.push(n); next.push(n);
      }
      fr = next;
    }
    for (const c of seen) {
      const arr = reachOf.get(c);
      if (arr) arr.push(ei);
      else reachOf.set(c, [ei]);
    }
  });

  const ww = whDef.size.w, wh = whDef.size.h;
  const fitsWh = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x + ww > W || y + wh > H) return false;
    for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) {
      const c = (y + j) * W + (x + i);
      if (!grid.usable[c] || roadAt[c]) return false;
      const o = owner[c];
      if (o >= 0 && !demolishable(all[o].defId)) return false;
    }
    return true;
  };
  const servedBy = (x: number, y: number): number[] => {
    const s = new Set<number>();
    for (let i = 0; i < ww; i++) {
      for (const yy of [y - 1, y + wh]) {
        if (yy >= 0 && yy < H) for (const ei of reachOf.get(yy * W + x + i) ?? []) s.add(ei);
      }
    }
    for (let j = 0; j < wh; j++) {
      for (const xx of [x - 1, x + ww]) {
        if (xx >= 0 && xx < W) for (const ei of reachOf.get((y + j) * W + xx) ?? []) s.add(ei);
      }
    }
    return [...s];
  };

  const covered = new Set<number>();
  // les entrepôts DÉJÀ présents (comptoir compris) couvrent peut-être déjà des exploitations
  for (const b of existing) {
    const d = lookup(b.defId);
    if (!d?.roadRoot) continue;
    for (const ei of servedBy(b.x, b.y)) covered.add(ei);
  }
  // glouton : à chaque tour, la position qui sert le plus d'exploitations non couvertes
  for (let iter = 0; iter < 40 && covered.size < out.exploited.length; iter++) {
    let bx = -1, by = -1, best: number[] = [];
    for (const [c] of reachOf) {
      const rx = c % W, ry = (c / W) | 0;
      for (const [px, py] of [[rx + 1, ry], [rx - ww, ry], [rx, ry + 1], [rx, ry - wh]] as const) {
        if (!fitsWh(px, py)) continue;
        const gain = servedBy(px, py).filter((ei) => !covered.has(ei));
        if (gain.length > best.length) { best = gain; bx = px; by = py; }
      }
    }
    if (bx < 0 || !best.length) break;
    const b: PlacedBuilding = { uid: uid("wh"), defId: whDef.id, x: bx, y: by, rotation: 0, locked: false };
    const idx = all.length;
    all.push(b);
    // l'emprise peut recouvrir des résidences : elles sont rasées
    for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) {
      const c = (by + j) * W + (bx + i);
      const o = owner[c];
      if (o >= 0 && o !== idx) removed.add(all[o].uid);
    }
    stampOcc(b, idx);
    out.buildings.push(b);
    out.warehouses++;
    linkToRoads(bx, by, ww, wh);
    for (const ei of best) covered.add(ei);
  }

  for (const ei of covered) out.exploited[ei].served = true;
  const unserved = out.exploited.length - covered.size;
  if (unserved) gaps.push(`${unserved} exploitation(s) sans entrepôt à portée de charrette`);
  out.removed = [...removed];
  return out;
}
