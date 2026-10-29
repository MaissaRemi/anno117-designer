import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import type { AqueductTile, BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";
import { worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import type { DefLookup } from "../engine/rules";
import { casesSousLosange, coinDe, reseauDeRoutes, routesAuContactRect } from "../engine/reseauRoutier";
import { facadeDe, posesSurEmplacement } from "./emplacements";

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

/**
 * DÉBORD HORS DE LA TERRE CONSTRUCTIBLE, en cases. Le jeu laisse l'aqueduc sortir de la grille
 * constructible (`MeshGraphBuildModeFeature/AqueductOutsideBuildabilityGridRestrictions`,
 * `AllowedCliffDistance` = 5 ; les murs ont la même règle, à 3,5), jamais sur l'eau
 * (`BlockedByWater`). Lu ici comme : sur le relief, à 5 cases au plus de la terre
 * constructible. Sans ce débord, une poche de terre fermée par une falaise restait sèche alors
 * que le réseau passait de l'autre côté : sur roman_island_small_01, l'Amphithéâtre, donc tout
 * le palier des Patriciens.
 */
export const DEBORD_AQUEDUC = 5;

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
  /** Consommateurs DÉPLACÉS pour être raccordés (option `deplacer`) : nouvelle position. */
  moved?: { uid: string; x: number; y: number }[];
  gaps: string[];
}

const waterAmountOf = (def: BuildingDef): number => {
  // citerne = tout AqueductDistributor (couvre les variantes DLC/celtic sans table)
  if (def.template === "AqueductDistributor") return CISTERN_CONSUMPTION;
  return CONSUMPTION_BY_ID[def.id] ?? 0;
};

/** Unités d'eau qu'un bâtiment prélève sur sa source (0 s'il n'en consomme pas). */
export const waterDemandOf = (def: BuildingDef): number => waterAmountOf(def);

/** Le bâtiment a-t-il besoin du réseau d'eau ? (citerne ou consommateur connu) */
export const needsWater = (def: BuildingDef): boolean => waterAmountOf(def) > 0;

/**
 * Réserve les emplacements de montagne dans une COPIE du masque usable — à donner aux moteurs
 * de placement pour qu'ils n'y posent rien : la source d'aqueduc ou la mine en a besoin.
 *
 * La montagne elle-même n'est plus bloquée ici : le masque des pentes la retire déjà de la
 * terre constructible (cf. data/terrain). Le carré de 13 × 13 qu'on bloquait autour de chaque
 * emplacement couvrait surtout la prairie DEVANT lui — là où passe sa route d'accès.
 */
export function blockMountains(grid: GridShape): GridShape {
  const slots = (grid.slots ?? []).filter((s) => s.type === "mountain");
  if (!slots.length) return grid;
  const usable = grid.usable.slice();
  const voies = grid.voies?.slice() ?? new Array<boolean>(grid.w * grid.h).fill(false);
  for (const s of slots) {
    // l'emprise que la source ou la mine y prendra, et sa façade, réservée à la route d'accès
    // (cf. emplacements.ts) : un îlot ou une maison posés devant la laissaient sans route
    const pose = posesSurEmplacement(grid, EMPRISE_MONTAGNE, s)[0];
    if (!pose) continue;
    for (let j = 0; j < pose.h; j++) for (let i = 0; i < pose.w; i++) usable[(pose.y + j) * grid.w + pose.x + i] = false;
    for (const c of facadeDe(grid, pose)) if (grid.usable[c]) { usable[c] = false; voies[c] = true; }
  }
  return { ...grid, usable, voies };
}

/**
 * Emprise des bâtiments d'emplacement de montagne : mines, carrières et source d'aqueduc font
 * toutes 8 × 3 au catalogue. Sert à réserver l'emplacement avant de savoir ce qui s'y posera.
 */
const EMPRISE_MONTAGNE = { size: { w: 8, h: 3 }, rotatable: true };

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
  /**
   * Ordre de raccordement. `volume` (défaut) : les gros consommateurs d'abord, pour le budget
   * des sources. `petits` : les citernes d'abord — dans un tissu dense où chaque consommateur
   * n'a qu'une prise, la conduite d'un gros consommateur raccordé en premier occupe l'allée
   * dont une citerne avait besoin, et la règle « deux réseaux ne se croisent jamais » la
   * condamne. Les gros, eux, ont de grandes emprises et plusieurs prises.
   */
  ordre: "volume" | "petits" = "volume",
  /**
   * DÉPLACER plutôt que perdre. Un consommateur qu'aucune conduite n'atteint là où il est posé
   * — enfermé par d'autres bâtiments, ou derrière un réseau qu'il ne peut pas traverser — est
   * reposé au plus près, contre une route, là où il se raccorde. Sans cela, il était retiré du
   * plan et laissait un trou dans la couverture : 2 citernes sur 9 sur roman_island_large_03.
   * Réservé à l'appelant qui pose les maisons APRÈS l'eau (planLattice) : il reste alors de la
   * terre libre autour des services.
   */
  deplacer = false,
): WaterPlanResult {
  const W = grid.w, H = grid.h, N = W * H;
  const gaps: string[] = [];
  // le réseau en graphe (`engine/reseauRoutier`) : cases droites, et losanges s'il y en a
  const reseau = reseauDeRoutes(W, H, roads);
  const roadAt = reseau.droite;
  // CONDUITE ET ROUTE DIAGONALE. Une conduite droite franchit une route droite à angle droit
  // (l'arche enjambe) ; franchir une route en biais, le jeu le permet-il, et sur combien de
  // cases ? Pas encore vérifié en jeu (question Q3 de la conception du réseau en graphe). En
  // attendant, règle prudente : aucune conduite ni source sur une case dont un losange de route
  // couvre la moitié.
  const sousLosange = new Uint8Array(N);
  if (reseau.losanges) {
    for (let k = 0; k < reseau.losange.length; k++) {
      if (!reseau.losange[k]) continue;
      const { X, Y } = coinDe(reseau, reseau.N + k);
      casesSousLosange(reseau, X, Y, (c) => { sousLosange[c] = 1; });
    }
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
  // relief à portée de débord de la terre constructible (cf. DEBORD_AQUEDUC)
  const debord = new Uint8Array(N);
  if (grid.relief) {
    let f: number[] = [];
    const d = new Int8Array(N).fill(-1);
    for (let c = 0; c < N; c++) if (grid.usable[c] || grid.voies?.[c]) { d[c] = 0; f.push(c); }
    for (let k = 1; k <= DEBORD_AQUEDUC && f.length; k++) {
      const nx: number[] = [];
      for (const c of f) {
        const x = c % W;
        for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (nb < 0 || nb >= N || d[nb] >= 0 || !grid.relief[nb]) continue;
          d[nb] = k; debord[nb] = 1; nx.push(nb);
        }
      }
      f = nx;
    }
  }
  const pass = (c: number): boolean =>
    !bldOcc[c] && !sousLosange[c] && (grid.usable[c] || mzone[c] === 1 || debord[c] === 1);
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

  // pose la source SUR l'emplacement, dans l'orientation qu'il prévoit (cf. emplacements.ts)
  const placeSource = (sx: number, sy: number): PlacedBuilding | null => {
    for (const { x, y, w, h, rot } of posesSurEmplacement(grid, srcDef, { x: sx, y: sy })) {
      let ok = true;
      for (let j = 0; j < h && ok; j++) for (let i = 0; i < w; i++) {
        const c = (y + j) * W + (x + i);
        if (!pass(c) || roadAt[c]) { ok = false; break; } // jamais sur une route
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

  // ── DÉPLACEMENT d'un consommateur irraccordable ──
  // Emprise libre (terre, ni bâtiment, ni route, ni conduite), contre une route — un service
  // sans rue ne dessert personne — et raccordable. Les positions qui touchent déjà le réseau
  // ne coûtent rien à tester ; les autres coûtent une recherche de conduite, d'où un plafond.
  const RAYON_DEPLACEMENT = 24, ESSAIS_CONDUITE = 8;
  const moved: { uid: string; x: number; y: number }[] = [];
  const deplacerVers = (c: { b: PlacedBuilding; fp: FP; amount: number }): boolean => {
    const { w, h } = c.fp;
    const libre = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const q = (y + j) * W + (x + i);
        if (!grid.usable[q] || bldOcc[q] || roadAt[q] || sousLosange[q] || netDist[q] >= 0) return false;
      }
      return true;
    };
    const marquer = (fp: FP, v: 0 | 1) => {
      for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) bldOcc[(fp.y + j) * W + fp.x + i] = v;
    };
    const cands: { x: number; y: number; d: number; touche: boolean }[] = [];
    for (let dy = -RAYON_DEPLACEMENT; dy <= RAYON_DEPLACEMENT; dy++) {
      for (let dx = -RAYON_DEPLACEMENT; dx <= RAYON_DEPLACEMENT; dx++) {
        if (!dx && !dy) continue;
        const x = c.fp.x + dx, y = c.fp.y + dy;
        if (!libre(x, y)) continue;
        const per = perimeter({ x, y, w, h });
        // contre une route : le périmètre, coins compris (écart au jeu gardé tel quel, le corriger
        // change des plans), ou un losange touché par un coin
        const contreUneRoute = per.some((q) => roadAt[q])
          || (reseau.losanges > 0 && routesAuContactRect(reseau, x, y, w, h).length > 0);
        if (!contreUneRoute) continue;
        cands.push({ x, y, d: Math.abs(dx) + Math.abs(dy), touche: per.some((q) => netDist[q] >= 0 && !roadAt[q]) });
      }
    }
    cands.sort((a, b) => Number(b.touche) - Number(a.touche) || a.d - b.d);
    marquer(c.fp, 0);
    let essais = 0;
    for (const k of cands) {
      if (!k.touche && essais++ >= ESSAIS_CONDUITE) break;
      const fp = { x: k.x, y: k.y, w, h };
      marquer(fp, 1);
      if (connect({ fp, amount: c.amount })) {
        c.fp = fp;
        moved.push({ uid: c.b.uid, x: k.x, y: k.y });
        return true;
      }
      marquer(fp, 0);
    }
    marquer(c.fp, 1);
    return false;
  };

  // gros consommateurs d'abord (budget), puis citernes (raccordement seul)
  const ordered = [...consumers].sort((a, b) => (ordre === "petits" ? a.amount - b.amount : b.amount - a.amount));
  const report: WaterConsumerReport[] = [];
  for (const c of ordered) {
    let ok = connect(c);
    if (!ok && remainingSlots.length) {
      // source supplémentaire près du consommateur non raccordé — seulement si un
      // slot est à portée de conduite (au-delà de MAX_RUN, la pose serait gaspillée)
      if (takeSlotNear(c.fp.x, c.fp.y, MAX_RUN) && connect(c)) ok = true;
    }
    if (!ok && deplacer) ok = deplacerVers(c);
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
    ...(moved.length ? { moved } : {}),
    gaps: [...new Set(gaps)],
  };
}
