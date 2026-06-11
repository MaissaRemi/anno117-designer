import { uid } from "../model/factories";
import type { AqueductTile, BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";

/**
 * Réseau d'eau (cf. GAME_MECHANICS.md §5) — approximations assumées :
 *  - pas d'élévation dans nos masques → la pente est approximée par une LONGUEUR
 *    MAX de conduite depuis la source (MAX_RUN) ;
 *  - la source se pose près d'un slot montagne (en jeu : slot dédié sur montagne).
 *
 * Règle route (confirmée en jeu) : une conduite peut être ADJACENTE à une route et
 * peut la CROISER (l'arche enjambe), mais ne partage jamais une case avec elle en
 * parallèle. Modèle tuiles : une conduite ne franchit une case route qu'EN LIGNE
 * DROITE (entrée/sortie opposées) — jamais de terminus, virage ou jonction dessus.
 */

export const WATER_CAPACITY = 100; // WaterVolumeSupply d'une source
export const MAX_RUN = 140; // longueur max d'une conduite depuis sa source (pente approx.)

const SOURCE_IDS = ["g19691", "g29524"]; // Source d'aqueduc (Roman / Celtic)
const CISTERN_IDS = new Set(["g19753", "g29526"]); // Citerne (distributeur, raccordement requis)

// Conso d'eau (AqueductConsumer Mandatory) — non extraite par build_catalog
// (templates infra) : table par nom, à migrer vers le catalogue plus tard.
const CONSUMPTION: { match: RegExp; amount: number }[] = [
  { match: /^bains/i, amount: 25 },
  { match: /^forum/i, amount: 15 },
];

export interface WaterConsumerReport {
  uid: string;
  name: string;
  amount: number; // 0 = citerne (raccordement seul)
  connected: boolean;
}

export interface WaterPlanResult {
  sources: PlacedBuilding[]; // Sources d'aqueduc posées (slots montagne)
  aqueducts: AqueductTile[]; // conduites (arbre source → consommateurs)
  capacity: number; // somme des sources posées
  used: number; // conso raccordée
  consumers: WaterConsumerReport[];
  gaps: string[];
}

const waterAmountOf = (def: BuildingDef): number => {
  for (const c of CONSUMPTION) if (c.match.test(def.name)) return c.amount;
  return 0;
};

/** Le bâtiment a-t-il besoin du réseau d'eau ? (citerne ou consommateur nommé) */
export const needsWater = (def: BuildingDef): boolean =>
  CISTERN_IDS.has(def.id) || waterAmountOf(def) > 0;

/**
 * Bloque les zones montagne (disque Chebyshev autour des slots) dans une COPIE du
 * masque usable — à donner aux moteurs de placement pour qu'ils n'y posent rien
 * (le masque mapimage marque la montagne comme constructible, c'est faux ; et la
 * source d'aqueduc a besoin de cette place).
 */
export function blockMountains(grid: GridShape, radius = 6): GridShape {
  const slots = (grid.slots ?? []).filter((s) => s.type === "mountain");
  if (!slots.length) return grid;
  const usable = grid.usable.slice();
  for (const s of slots) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = s.x + dx, y = s.y + dy;
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
      usable[y * grid.w + x] = false;
    }
  }
  return { ...grid, usable };
}

interface FP { x: number; y: number; w: number; h: number }

const footprintOf = (b: PlacedBuilding, def: BuildingDef): FP => {
  const rot = b.rotation === 90 || b.rotation === 270;
  return { x: b.x, y: b.y, w: rot ? def.size.h : def.size.w, h: rot ? def.size.w : def.size.h };
};

/**
 * Planifie le réseau d'eau pour une disposition donnée : pose les sources sur les
 * slots montagne, trace les conduites en arbre (BFS, branchement au réseau le plus
 * proche), respecte budget (100/source) et longueur max. Nouvelle source activée si
 * budget/longueur dépassés.
 */
export function planWater(
  grid: GridShape,
  buildings: PlacedBuilding[],
  roads: RoadTile[],
  lookup: DefLookup,
): WaterPlanResult {
  const W = grid.w, H = grid.h, N = W * H;
  const gaps: string[] = [];
  const roadAt = new Uint8Array(N);
  for (const r of roads) {
    if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;
  }

  // consommateurs présents dans la disposition
  const consumers: { b: PlacedBuilding; def: BuildingDef; fp: FP; amount: number }[] = [];
  for (const b of buildings) {
    const def = lookup(b.defId);
    if (!def || !needsWater(def)) continue;
    consumers.push({ b, def, fp: footprintOf(b, def), amount: waterAmountOf(def) });
  }
  if (!consumers.length) {
    return { sources: [], aqueducts: [], capacity: 0, used: 0, consumers: [], gaps: [] };
  }

  const slots = (grid.slots ?? []).filter((s) => s.type === "mountain");
  if (!slots.length) {
    return {
      sources: [], aqueducts: [], capacity: 0, used: 0,
      consumers: consumers.map((c) => ({ uid: c.b.uid, name: c.def.name, amount: c.amount, connected: false })),
      gaps: ["Aucun slot montagne : pas de source d'eau possible (Bains/Forum/Citernes inactifs)"],
    };
  }
  const srcDef = SOURCE_IDS.map((id) => lookup(id)).find((d): d is BuildingDef => !!d);
  if (!srcDef) {
    return {
      sources: [], aqueducts: [], capacity: 0, used: 0,
      consumers: consumers.map((c) => ({ uid: c.b.uid, name: c.def.name, amount: c.amount, connected: false })),
      gaps: ["Source d'aqueduc absente du catalogue"],
    };
  }

  // bâtiments seuls (les conduites traversent routes/champs, pas les bâtiments)
  const bldOcc = new Uint8Array(N);
  for (const b of buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    const fp = footprintOf(b, def);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = fp.x + i, y = fp.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) bldOcc[y * W + x] = 1;
    }
  }
  // zone montagne (autour des slots) : traversable/posable même si le masque la dit
  // non-constructible — la source et ses conduites partent de là
  const mzone = new Uint8Array(N);
  for (const s of slots) {
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const x = Math.round(s.x) + dx, y = Math.round(s.y) + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) mzone[y * W + x] = 1;
    }
  }
  // case franchissable par une conduite (mer interdite, bâtiments interdits)
  const pass = (c: number): boolean => !bldOcc[c] && (grid.usable[c] || mzone[c] === 1);

  // --- réseau : dist depuis la source par case de conduite, -1 = pas de réseau ---
  const netDist = new Int32Array(N).fill(-1);
  const netSrc = new Int32Array(N).fill(-1); // index de source par case réseau
  const aqueducts: AqueductTile[] = [];
  const sources: PlacedBuilding[] = [];
  const srcUsed: number[] = []; // budget consommé par source

  const perimeter = (fp: FP): number[] => {
    const out: number[] = [];
    for (let i = -1; i <= fp.w; i++) {
      for (const y of [fp.y - 1, fp.y + fp.h]) {
        const x = fp.x + i;
        if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
      }
    }
    for (let j = 0; j < fp.h; j++) {
      for (const x of [fp.x - 1, fp.x + fp.w]) {
        const y = fp.y + j;
        if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
      }
    }
    return out;
  };

  // pose une source au plus près d'un slot (essaie les 2 orientations)
  const placeSource = (sx: number, sy: number): PlacedBuilding | null => {
    const dims: [number, number, 0 | 90][] = [
      [srcDef.size.w, srcDef.size.h, 0],
      [srcDef.size.h, srcDef.size.w, 90],
    ];
    for (let r = 0; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const [w, h, rot] of dims) {
          const x = sx + dx - (w >> 1), y = sy + dy - (h >> 1);
          if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
          let ok = true;
          for (let j = 0; j < h && ok; j++) for (let i = 0; i < w; i++) {
            if (!pass((y + j) * W + (x + i))) { ok = false; break; }
          }
          if (!ok) continue;
          const pb: PlacedBuilding = { uid: uid("aqua"), defId: srcDef.id, x, y, rotation: rot, locked: false };
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bldOcc[(y + j) * W + (x + i)] = 1;
          // graines réseau : périmètre de la source à dist 0 (jamais sur une route :
          // une conduite ne peut pas se brancher/terminer sur une case route)
          const srcIdx = sources.length;
          for (const c of perimeter({ x, y, w, h })) {
            if (!pass(c) || roadAt[c]) continue;
            if (netDist[c] < 0) { netDist[c] = 0; netSrc[c] = srcIdx; }
          }
          sources.push(pb);
          srcUsed.push(0);
          return pb;
        }
      }
    }
    return null;
  };

  // slots triés par proximité au barycentre des consommateurs
  let cx = 0, cy = 0;
  for (const c of consumers) { cx += c.fp.x + c.fp.w / 2; cy += c.fp.y + c.fp.h / 2; }
  cx /= consumers.length; cy /= consumers.length;
  const slotQueue = [...slots].sort(
    (a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy),
  );

  // 1re source
  let slotPtr = 0;
  while (slotPtr < slotQueue.length && !placeSource(Math.round(slotQueue[slotPtr].x), Math.round(slotQueue[slotPtr].y))) slotPtr++;
  slotPtr++;
  if (!sources.length) {
    return {
      sources: [], aqueducts: [], capacity: 0, used: 0,
      consumers: consumers.map((c) => ({ uid: c.b.uid, name: c.def.name, amount: c.amount, connected: false })),
      gaps: ["Aucune source posable près des slots montagne (encombrement)"],
    };
  }

  // raccorde un consommateur au réseau (BFS depuis son périmètre vers la case réseau
  // la plus proche, en respectant budget + longueur). Renvoie true si raccordé.
  // BFS à ÉTATS (case × direction d'entrée) : sur une case ROUTE, la conduite ne
  // peut que CONTINUER TOUT DROIT (l'arche enjambe) — jamais virer/terminer/brancher.
  // Cases libres : direction indifférente (état canonique d=0).
  const DELTA = [1, -1, W, -W]; // 0:+x  1:-x  2:+y  3:-y
  const stateOf = (cell: number, d: number): number => (roadAt[cell] ? cell * 4 + d : cell * 4);
  const connect = (c: { fp: FP; amount: number }): boolean => {
    // terminus jamais sur route : départs = périmètre libre hors-route
    const starts = perimeter(c.fp).filter((p) => (pass(p) && !roadAt[p]) || netDist[p] >= 0);
    // déjà raccordé ? (périmètre touche le réseau hors-route)
    const touching = starts.find((p) => netDist[p] >= 0 && !roadAt[p]);
    if (touching !== undefined && srcUsed[netSrc[touching]] + c.amount <= WATER_CAPACITY) {
      srcUsed[netSrc[touching]] += c.amount;
      return true;
    }
    const prev = new Int32Array(N * 4).fill(-2); // par état ; -1 = départ
    let frontier: number[] = []; // états
    for (const p of starts) {
      if (roadAt[p]) continue;
      const s = stateOf(p, 0);
      if (prev[s] !== -2) continue;
      prev[s] = -1;
      frontier.push(s);
    }
    for (let depth = 0; depth < MAX_RUN && frontier.length; depth++) {
      const next: number[] = [];
      for (const s of frontier) {
        const p = (s / 4) | 0;
        const din = s % 4;
        // arrivée : case réseau HORS ROUTE (un croisement n'est pas branchable)
        if (netDist[p] >= 0 && !roadAt[p] && prev[s] !== -1) {
          const sIdx = netSrc[p];
          if (srcUsed[sIdx] + c.amount > WATER_CAPACITY) continue; // source pleine — autre chemin ?
          if (netDist[p] + depth > MAX_RUN) continue; // trop loin de la source
          // tracer le chemin (nouvelles conduites), dist réseau croissante
          let cur = prev[s], d = netDist[p];
          while (cur >= 0) {
            d++;
            const cell = (cur / 4) | 0;
            if (netDist[cell] < 0) {
              netDist[cell] = d;
              // case route croisée : marquée non-branchable via roadAt (netSrc quand même)
              netSrc[cell] = sIdx;
              aqueducts.push({ x: cell % W, y: (cell / W) | 0, gen: true });
            }
            cur = prev[cur];
          }
          srcUsed[sIdx] += c.amount;
          return true;
        }
        // transitions : route → tout droit uniquement ; libre → 4 directions
        const dirs = roadAt[p] ? [din] : [0, 1, 2, 3];
        const x = p % W, y = (p / W) | 0;
        for (const nd of dirs) {
          if ((nd === 0 && x >= W - 1) || (nd === 1 && x <= 0) || (nd === 2 && y >= H - 1) || (nd === 3 && y <= 0)) continue;
          const nb = p + DELTA[nd];
          if (!pass(nb) && netDist[nb] < 0) continue; // bâtiment/mer (réseau existant OK)
          const ns = stateOf(nb, nd);
          if (prev[ns] !== -2) continue;
          prev[ns] = s;
          next.push(ns);
        }
      }
      frontier = next;
    }
    return false;
  };

  // gros consommateurs d'abord (budget), puis citernes (raccordement seul)
  const ordered = [...consumers].sort((a, b) => b.amount - a.amount);
  const report: WaterConsumerReport[] = [];
  for (const c of ordered) {
    let ok = connect(c);
    if (!ok && slotPtr <= slotQueue.length - 1) {
      // tenter une source supplémentaire près du consommateur non raccordé
      const near = [...slotQueue.slice(slotPtr)].sort(
        (a, b) => Math.hypot(a.x - c.fp.x, a.y - c.fp.y) - Math.hypot(b.x - c.fp.x, b.y - c.fp.y),
      )[0];
      const idx = slotQueue.indexOf(near);
      if (placeSource(Math.round(near.x), Math.round(near.y))) {
        slotQueue.splice(idx, 1);
        ok = connect(c);
      } else {
        slotPtr++;
      }
    }
    report.push({ uid: c.b.uid, name: c.def.name, amount: c.amount, connected: ok });
    if (!ok) {
      gaps.push(`${c.def.name} non raccordé au réseau d'eau${c.amount ? "" : " (citerne inactive)"}`);
    }
  }

  return {
    sources,
    aqueducts,
    capacity: sources.length * WATER_CAPACITY,
    used: srcUsed.reduce((a, b) => a + b, 0),
    consumers: report,
    gaps: [...new Set(gaps)],
  };
}
