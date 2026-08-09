import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import type { AqueductTile, BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
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
/** Marge de MONTÉE tolérée (en unités de hauteur quantifiée, 1 q = 16 unités jeu) :
 *  l'eau ne coule pas vers plus haut que sa source — une conduite ne traverse pas
 *  une case plus haute que (source la plus haute + marge). Constante à calibrer
 *  in-game (test #1 de GAME_MECHANICS §13) ; v1 qualitative. */
export const CLIMB_MARGIN_Q = 2;

const SOURCE_IDS = ["g19691", "g29524"]; // Source d'aqueduc (Roman / Celtic)

/** Rayon (Chebyshev) de la zone montagne autour d'un slot : bloquée pour les
 *  moteurs de placement, mais posable/traversable pour source+conduites (avec
 *  une marge de +2). Les rayons dérivés s'expriment en fonction de celui-ci. */
export const MOUNTAIN_BLOCK_RADIUS = 6;
const MOUNTAIN_ZONE_RADIUS = MOUNTAIN_BLOCK_RADIUS + 2;

// Conso d'eau [FICHIERS] (AqueductConsumer Mandatory + WaterConsumption template,
// cf. GAME_MECHANICS.md §4) — par defId du catalogue.
const CONSUMPTION_BY_ID: Record<string, number> = {
  g3620: 25, // Bains (Roman) — Mandatory
  g8062: 25, // Bains (romano-celte) — Mandatory
  g3617: 15, // Forum — Mandatory
  g3621: 50, // Colisée — Mandatory (obligatoire T4, unique)
};
// Citerne : distributeur qui CONSOMME 10u du budget (WaterConsumption=10, template
// AqueductDistributor, non overridé) — une source ≈ 10 citernes max sans wonder.
const CISTERN_CONSUMPTION = 10;

export interface WaterConsumerReport {
  uid: string;
  name: string;
  amount: number; // 0 = citerne (raccordement seul)
  connected: boolean;
}

export interface WaterPlanResult {
  sources: PlacedBuilding[]; // Sources d'aqueduc posées (slots montagne)
  /** Slots montagne CONSOMMÉS par le réseau d'eau (source posée ou tentative échouée).
   *  L'eau est prioritaire : tout le reste ne peut exploiter que le complément. */
  usedSlots: { x: number; y: number }[];
  aqueducts: AqueductTile[]; // conduites (arbre source → consommateurs)
  /**
   * Consommateurs RETIRÉS du plan faute de raccordement (cf. planLattice). Ils ne sont plus
   * dans `consumers`, mais la santé du réseau doit se juger sur ce qu'il FALLAIT alimenter :
   * sans ce compte, une île où aucune source n'est possible verrait tous ses consommateurs
   * disparaître et afficherait un réseau parfait.
   */
  dropped?: number;
  capacity: number; // somme des sources posées
  used: number; // conso raccordée
  consumers: WaterConsumerReport[];
  gaps: string[];
}

const waterAmountOf = (def: BuildingDef): number => {
  // citerne = tout AqueductDistributor (couvre les variantes DLC/celtic sans table)
  if (def.template === "AqueductDistributor") return CISTERN_CONSUMPTION;
  return CONSUMPTION_BY_ID[def.id] ?? 0;
};

/** Le bâtiment a-t-il besoin du réseau d'eau ? (citerne ou consommateur connu) */
export const needsWater = (def: BuildingDef): boolean => waterAmountOf(def) > 0;

/**
 * Bloque les zones montagne (disque Chebyshev autour des slots) dans une COPIE du
 * masque usable — à donner aux moteurs de placement pour qu'ils n'y posent rien
 * (le masque mapimage marque la montagne comme constructible, c'est faux ; et la
 * source d'aqueduc a besoin de cette place).
 */
export function blockMountains(grid: GridShape, radius = MOUNTAIN_BLOCK_RADIUS): GridShape {
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

const footprintOf = (b: PlacedBuilding, def: BuildingDef): FP =>
  ({ x: b.x, y: b.y, ...footprintSize(def, b.rotation) });

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
  heights?: Int8Array | null,
  /**
   * Emprise RÉSERVÉE à un bâtiment que l'appelant posera PLUS TARD — le comptoir.
   *
   * `reserveKontor` protège son emplacement en le retirant du masque de terre. Cela suffit
   * aux moteurs de placement, mais PAS ici : une source d'aqueduc se pose justement sur des
   * cases hors masque, celles des zones montagne. Elle atterrissait donc sur le comptoir.
   * Mesuré sur roman_island_small_02 : 7 cases occupées deux fois, un chevauchement illégal
   * en jeu, detecté par l'invariant `pas-de-chevauchement`.
   */
  reserved?: { x: number; y: number; w: number; h: number },
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
    return { sources: [], usedSlots: [], aqueducts: [], capacity: 0, used: 0, consumers: [], gaps: [] };
  }

  const slots = (grid.slots ?? []).filter((s) => s.type === "mountain");
  if (!slots.length) {
    return {
      sources: [], usedSlots: [], aqueducts: [], capacity: 0, used: 0,
      consumers: consumers.map((c) => ({ uid: c.b.uid, name: c.def.name, amount: c.amount, connected: false })),
      gaps: ["Aucun slot montagne : pas de source d'eau possible (Bains/Forum/Citernes inactifs)"],
    };
  }
  // SOURCE DU BON MONDE. Le premier identifiant de la liste etait pris tel quel : toute ile
  // d'Albion recevait donc la source d'aqueduc ROMAINE, non constructible en jeu. Repli sur
  // n'importe laquelle si le monde de l'ile n'en propose pas.
  const srcWorld = worldOf(regionOfIsland(grid.islandId));
  const srcCands = SOURCE_IDS.map((id) => lookup(id)).filter((d): d is BuildingDef => !!d);
  const srcDef = srcCands.find((d) => !d.region || worldOf(d.region) === srcWorld) ?? srcCands[0];
  if (!srcDef) {
    return {
      sources: [], usedSlots: [], aqueducts: [], capacity: 0, used: 0,
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
  const MZ = MOUNTAIN_ZONE_RADIUS;
  for (const s of slots) {
    for (let dy = -MZ; dy <= MZ; dy++) for (let dx = -MZ; dx <= MZ; dx++) {
      const x = Math.round(s.x) + dx, y = Math.round(s.y) + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) mzone[y * W + x] = 1;
    }
  }
  // case franchissable par une conduite (mer interdite, bâtiments interdits)
  if (reserved) {
    for (let j = 0; j < reserved.h; j++) for (let i = 0; i < reserved.w; i++) {
      const x = reserved.x + i, y = reserved.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) bldOcc[y * W + x] = 1;
    }
  }
  const pass = (c: number): boolean => !bldOcc[c] && (grid.usable[c] || mzone[c] === 1);
  // « l'eau ne monte pas » : une conduite reliée à une source ne grimpe jamais au-dessus
  // de la TÊTE DE CETTE source (+marge). `maxSrcQ` = max global, utilisé comme borne
  // LÂCHE pendant l'expansion BFS ; la contrainte stricte PAR SOURCE (srcMaxQ) est
  // vérifiée à l'arrivée sur le réseau (sinon une source basse hériterait du plafond
  // d'une source haute et l'eau monterait — cf. CLIMB_MARGIN_Q).
  let maxSrcQ = -128;
  const heightOK = (c: number): boolean => !heights || heights[c] <= maxSrcQ + CLIMB_MARGIN_Q;

  // --- réseau : dist depuis la source par case de conduite, -1 = pas de réseau ---
  const netDist = new Int32Array(N).fill(-1);
  const netSrc = new Int32Array(N).fill(-1); // index de source par case réseau
  const aqueducts: AqueductTile[] = [];
  const sources: PlacedBuilding[] = [];
  const srcUsed: number[] = []; // budget consommé par source
  const srcMaxQ: number[] = []; // hauteur de tête par source (plafond de montée propre)

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
    for (let r = 0; r <= MOUNTAIN_ZONE_RADIUS + 2; r++) {
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
          // hauteur de tête de CETTE source (max de son emprise) : son plafond propre
          let myQ = -128;
          if (heights) {
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
              const q = heights[(y + j) * W + (x + i)];
              if (q > myQ) myQ = q;
            }
            if (myQ > maxSrcQ) maxSrcQ = myQ;
          }
          srcMaxQ[srcIdx] = myQ;
          return pb;
        }
      }
    }
    return null;
  };

  // slots restants (propriété unique). Un slot dont la POSE échoue est consommé
  // (l'occupation ne fait que croître : il échouera toujours) ; un slot HORS PORTÉE
  // de la cible n'est PAS consommé — il peut servir à un consommateur plus proche.
  const remainingSlots = [...slots];
  const usedSlots: { x: number; y: number }[] = [];
  const takeSlotNear = (tx: number, ty: number, maxDist = Infinity): boolean => {
    const candidates = remainingSlots
      .filter((s) => Math.hypot(s.x - tx, s.y - ty) <= maxDist)
      .sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
    for (const s of candidates) {
      remainingSlots.splice(remainingSlots.indexOf(s), 1);
      usedSlots.push({ x: Math.round(s.x), y: Math.round(s.y) });
      if (placeSource(Math.round(s.x), Math.round(s.y))) return true;
    }
    return false;
  };

  // 1re source : près du barycentre des consommateurs
  let cx = 0, cy = 0;
  for (const c of consumers) { cx += c.fp.x + c.fp.w / 2; cy += c.fp.y + c.fp.h / 2; }
  cx /= consumers.length; cy /= consumers.length;
  takeSlotNear(cx, cy);
  if (!sources.length) {
    return {
      sources: [], usedSlots: [], aqueducts: [], capacity: 0, used: 0,
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
  // scratch partagé entre raccordements (un BFS ne touche que ~MAX_RUN² états :
  // re-remplir 4N par appel coûtait ~10 Mo de trafic mémoire PAR consommateur).
  // Visite par époque : prevEpoch[s] !== epoch ⇔ état non visité.
  const prevArr = new Int32Array(N * 4);
  const prevEpoch = new Int32Array(N * 4);
  let epoch = 0;
  const connect = (c: { fp: FP; amount: number }): boolean => {
    // terminus jamais sur route : départs = périmètre libre hors-route
    const starts = perimeter(c.fp).filter((p) => (pass(p) && !roadAt[p]) || netDist[p] >= 0);
    // déjà raccordé ? (périmètre touche le réseau hors-route)
    const touching = starts.find((p) => netDist[p] >= 0 && !roadAt[p]);
    if (touching !== undefined && srcUsed[netSrc[touching]] + c.amount <= WATER_CAPACITY) {
      srcUsed[netSrc[touching]] += c.amount;
      return true;
    }
    epoch++;
    const seen = (s: number): boolean => prevEpoch[s] === epoch;
    const setPrev = (s: number, v: number) => { prevEpoch[s] = epoch; prevArr[s] = v; };
    let frontier: number[] = []; // états
    for (const p of starts) {
      if (roadAt[p] || netDist[p] >= 0) continue; // jamais partir DU réseau (no-merge)
      const s = stateOf(p, 0);
      if (seen(s)) continue;
      setPrev(s, -1);
      frontier.push(s);
    }
    for (let depth = 0; depth < MAX_RUN && frontier.length; depth++) {
      const next: number[] = [];
      for (const s of frontier) {
        const p = (s / 4) | 0;
        const din = s % 4;
        // arrivée : case réseau HORS ROUTE (un croisement n'est pas branchable)
        if (netDist[p] >= 0 && !roadAt[p] && prevArr[s] !== -1) {
          const sIdx = netSrc[p];
          if (srcUsed[sIdx] + c.amount > WATER_CAPACITY) continue; // source pleine — autre chemin ?
          if (netDist[p] + depth > MAX_RUN) continue; // trop loin de la source
          // pente PAR SOURCE : le nouveau tronçon ne grimpe pas au-dessus de la tête de
          // CETTE source (+marge). Une source basse ne tire pas l'eau vers une crête,
          // même si une autre source plus haute existe ailleurs sur l'île.
          if (heights) {
            const cap = srcMaxQ[sIdx] + CLIMB_MARGIN_Q;
            let climbs = false;
            for (let cur = prevArr[s]; cur >= 0; cur = prevArr[cur]) {
              if (heights[(cur / 4) | 0] > cap) { climbs = true; break; }
            }
            if (climbs) continue; // ce chemin monte trop pour cette source
          }
          // tracer le chemin (nouvelles conduites), dist réseau croissante
          let cur = prevArr[s], d = netDist[p];
          while (cur >= 0) {
            d++;
            const cell = (cur / 4) | 0;
            if (netDist[cell] < 0) {
              netDist[cell] = d;
              // case route croisée : marquée non-branchable via roadAt (netSrc quand même)
              netSrc[cell] = sIdx;
              aqueducts.push({ x: cell % W, y: (cell / W) | 0 }); // gen posé par le store
            }
            cur = prevArr[cur];
          }
          srcUsed[sIdx] += c.amount;
          return true;
        }
        // NO-MERGE : une case réseau qui n'a pas pu servir de jonction (budget
        // plein, trop loin, croisement-route) est un CUL-DE-SAC — on ne la
        // traverse jamais (sinon le chemin fusionnerait physiquement 2 réseaux).
        if (netDist[p] >= 0) continue;
        // transitions : route → tout droit uniquement ; libre → 4 directions
        const dirs = roadAt[p] ? [din] : [0, 1, 2, 3];
        const x = p % W, y = (p / W) | 0;
        for (const nd of dirs) {
          if ((nd === 0 && x >= W - 1) || (nd === 1 && x <= 0) || (nd === 2 && y >= H - 1) || (nd === 3 && y <= 0)) continue;
          const nb = p + DELTA[nd];
          // NO-MERGE (règle jeu) : 2 réseaux ne se raccordent jamais pour cumuler
          // l'eau → une conduite neuve ne TRAVERSE jamais le réseau existant. Une
          // case réseau ne peut être que l'ARRIVÉE (jonction sur SA source).
          if (!pass(nb) || !heightOK(nb)) continue;
          const ns = stateOf(nb, nd);
          if (seen(ns)) continue;
          setPrev(ns, s);
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
    if (!ok && remainingSlots.length) {
      // source supplémentaire près du consommateur non raccordé — seulement si un
      // slot est à portée de conduite (au-delà de MAX_RUN, la pose serait gaspillée)
      if (takeSlotNear(c.fp.x, c.fp.y, MAX_RUN) && connect(c)) ok = true;
    }
    report.push({ uid: c.b.uid, name: c.def.name, amount: c.amount, connected: ok });
    if (!ok) {
      gaps.push(`${c.def.name} non raccordé au réseau d'eau (inactif)`);
    }
  }

  return {
    sources,
    usedSlots,
    aqueducts,
    capacity: sources.length * WATER_CAPACITY,
    used: srcUsed.reduce((a, b) => a + b, 0),
    consumers: report,
    gaps: [...new Set(gaps)],
  };
}
