import { uid } from "../model/factories";
import { footprintSize, partieEauPosee, routeSeule } from "../engine/geometry";
import type { BuildingDef, GridShape, PlacedBuilding, RoadTile, Rotation } from "../model/types";
import { terrainConvient, type DefLookup } from "../engine/rules";
import {
  casesAuContact, casesSousLosange, coinDe, coutDe, estLosange, estRoute, FileDeNoeuds, idDeRoute, losangeSur,
  noeudsAuContactRect, noeudsLies, noeudsLiesDuReseau, poserLosange, reseauDeRoutes, retirerLosange, routeDe,
  routesAuContactRect, tailleReseau, voisins, type ReseauRoutier,
} from "../engine/reseauRoutier";

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
  rotation: Rotation;
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
  // SUR LA PLUS GRANDE TERRE. `keepMainLandmass` ne garde ensuite que la terre reliée au
  // comptoir : posé sur un fragment de côte coupé du reste, il condamnait l'île entière.
  // Mesuré dans le repère diagonal, où la côte s'émiette (une case diagonale exige ses 4 cases
  // droites) : roman_island_large_03 n'y gardait que le comptoir, aucune maison.
  const principale = composantePrincipale(grid);
  const coastMain = coast.filter((c) => principale[c]);
  if (coastMain.length) coast.splice(0, coast.length, ...coastMain);
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

  // LE COMPTOIR EST À MOITIÉ DANS L'EAU. Son `.ifo` déclare une partie dans l'eau (6 colonnes
  // sur 8 pour le comptoir romain) : le poser entièrement à terre, au contact de l'eau, le
  // laissait à l'intérieur des terres, et l'éditeur le marquait sur un mauvais terrain. Même
  // règle que les bâtiments côtiers (cf. `terrainConvient`), dans les quatre orientations.
  if (def.partieEau) {
    for (const c of coast) {
      const cx = c % W, cy = (c / W) | 0;
      for (const rot of (def.rotatable ? [0, 90, 180, 270] : [0]) as Rotation[]) {
        const { w, h } = footprintSize(def, rot);
        for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
          const x = cx - ox, y = cy - oy;
          if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
          if (!terrainConvient(grid, def, x, y, rot, 1)) continue;
          // l'emprise et sa partie dans l'eau sortent des deux masques : ni maison ni pêcheur
          const usable = grid.usable.slice(), eau = water.slice();
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { usable[(y + j) * W + x + i] = false; eau[(y + j) * W + x + i] = false; }
          const p = partieEauPosee(def, rot)!;
          for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
            const xx = x + p.x + i, yy = y + p.y + j;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H) eau[yy * W + xx] = false;
          }
          return { def, x, y, rotation: rot, grid: { ...grid, usable, water: eau } };
        }
      }
    }
  }

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

/**
 * ═══ UNE SEULE MASSE CONTINENTALE ══════════════════════════════════════════════════════
 *
 * Retire du masque constructible tout ce qui n'est pas d'un seul tenant avec le comptoir.
 *
 * Les « îles » du jeu ne sont pas des blocs pleins : leur masque de terre compte des dizaines
 * de composantes séparées — bancs, récifs, lobes détachés. Mesuré : 85 composantes sur
 * `celtic_island_small_06`, 112 sur `celtic_island_small_01` dont une de 1 193 cases, 70 sur
 * `celtic_island_medium_04` dont une de 418.
 *
 * Les moteurs y bâtissaient. Aucune route ne pouvant franchir la mer, ces bâtiments n'ont
 * jamais d'accès au comptoir, donc sont INACTIFS en jeu — et les services qui s'y trouvaient
 * comptaient quand même dans la couverture des maisons. Mesuré sur huit îles : six en avaient,
 * jusqu'à 31 bâtiments morts sur une île de 67 maisons, marchés et puits compris. La
 * réparation de connexité ne pouvait rien : ni un détour plus long (essayé à 96 cases) ni le
 * droit de raser (essayé aussi) ne font traverser la mer.
 *
 * Les îles épargnées le confirment a contrario : `celtic_island_medium_03` et `_07` n'ont que
 * des composantes secondaires de 1 à 3 cases, et aucun bâtiment isolé.
 *
 * Sans comptoir, on garde la plus grande composante — c'est là que le joueur s'installera.
 *
 * UNE RIVIÈRE SE FRANCHIT PAR UN PONT, la mer non. Ses cases relient donc les deux rives (sans
 * devenir constructibles). Tant que les rivières étaient lues en miroir, elles ne coupaient
 * rien d'utile ; à leur vraie place, celle de roman_island_medium_01 isolait toute la moitié
 * nord de l'île, et le plan perdait 60 % de ses maisons.
 */
/** Cases de la plus grande terre d'un seul tenant (ponts sur les rivières compris). */
function composantePrincipale(grid: GridShape): Uint8Array {
  const W = grid.w, N = W * grid.h;
  const relie = (c: number) => grid.usable[c] || routeSeule(grid, c);
  const comp = new Int32Array(N).fill(-1);
  let best = -1, bestSize = 0, n = 0;
  for (let i = 0; i < N; i++) {
    if (!relie(i) || comp[i] >= 0) continue;
    const id = n++;
    let size = 0, fr = [i];
    comp[i] = id;
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) {
        size++;
        const x = c % W;
        for (const v of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (v >= 0 && v < N && relie(v) && comp[v] < 0) { comp[v] = id; next.push(v); }
        }
      }
      fr = next;
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (comp[i] === best) out[i] = 1;
  return out;
}

export function keepMainLandmass(grid: GridShape, seed?: { x: number; y: number }): GridShape {
  const W = grid.w, H = grid.h, N = W * H;
  const relie = (c: number) => grid.usable[c] || routeSeule(grid, c);
  const comp = new Int32Array(N).fill(-1);
  let best = -1, bestSize = 0, seedComp = -1;
  const seedIdx = seed && seed.x >= 0 && seed.y >= 0 && seed.x < W && seed.y < H
    ? seed.y * W + seed.x : -1;
  let nComp = 0;
  for (let i = 0; i < N; i++) {
    if (!relie(i) || comp[i] >= 0) continue;
    const id = nComp++;
    let size = 0;
    let fr = [i];
    comp[i] = id;
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) {
        size++;
        const x = c % W, y = (c / W) | 0;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
          if (n >= 0 && relie(n) && comp[n] < 0) { comp[n] = id; next.push(n); }
        }
      }
      fr = next;
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  // L'ancre du comptoir a ete RETIREE du masque par `reserveKontor` : la lire telle quelle
  // rend -1, et l'on retombait silencieusement sur la plus grande composante — qui n'est pas
  // forcement celle du comptoir. On cherche donc la case utilisable la plus proche.
  // Parmi les terres au voisinage, la PLUS GRANDE, pas la première trouvée : une case isolée
  // collée au comptoir passait avant la terre principale à deux cases de là, et le plan ne
  // gardait qu'elle (mesuré dans le repère diagonal, où la côte s'émiette : 1 case gardée).
  if (seedIdx >= 0) {
    const taille = new Map<number, number>();
    for (let i = 0; i < N; i++) if (comp[i] >= 0) taille.set(comp[i], (taille.get(comp[i]) ?? 0) + 1);
    const sx = seedIdx % W, sy = (seedIdx / W) | 0;
    for (let dy = -16; dy <= 16; dy++) for (let dx = -16; dx <= 16; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = comp[y * W + x];
      if (k >= 0 && (seedComp < 0 || taille.get(k)! > taille.get(seedComp)!)) seedComp = k;
    }
  }
  const keep = seedComp >= 0 ? seedComp : best;
  if (keep < 0 || nComp <= 1) return grid;
  const usable = grid.usable.slice();
  for (let i = 0; i < N; i++) if (usable[i] && comp[i] !== keep) usable[i] = false;
  return { ...grid, usable };
}

/**
 * ENTREPÔT DE L'ÎLE, du bon monde.
 *
 * Albion ne nomme pas son entrepôt comme le Latium : ses trois niveaux portent le template
 * `Warehouse_Marsh` (« Warehouse Roman Celtic 01/02/03 ») là où le Latium utilise `Warehouse`.
 * Les deux appelants ne cherchaient que `Warehouse` : ils ne trouvaient donc JAMAIS la version
 * celtique et retombaient sur l'entrepôt romain, non constructible sur Albion. `prodPlan`
 * faisait pire encore, en codant `region === "Roman"` en dur quelle que soit l'île.
 *
 * Détecté par l'invariant `monde-unique` : « 11 bâtiment(s) d'un autre monde que l'île
 * (Entrepôt) » sur celtic_island_large_07, avec exploitations et production locale.
 */
const WAREHOUSE_TPLS = ["Warehouse", "Warehouse_Marsh"];

export function pickWarehouseDef(catalog: BuildingDef[], region?: string): BuildingDef | undefined {
  const all = catalog.filter((d) => WAREHOUSE_TPLS.includes(d.template ?? ""));
  // niveau 1 d'abord : le plus petit GUID du monde voulu
  const mine = all.filter((d) => !region || d.region === region).sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0));
  return mine[0] ?? all.sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0))[0];
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
  opts: OptionsLiaison = {},
): KontorPlacement {
  const W = grid.w, H = grid.h, N = W * H;
  const { w, h } = footprintSize(res.def, res.rotation);
  const building: PlacedBuilding = {
    uid: uid("kontor"), defId: res.def.id, x: res.x, y: res.y, rotation: res.rotation, locked: false,
  };

  // le réseau en graphe (`engine/reseauRoutier`) : cases droites, et losanges s'il y en a
  const reseau = reseauDeRoutes(W, H, roads);
  const roadAt = reseau.droite;
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

  // PÉRIMÈTRE ORTHO — sans les coins.
  //
  // Il courait de -1 à w, coins compris. Or un coin est DIAGONAL à l'emprise, et l'accès
  // routier du jeu est orthogonal : une route posée là faisait répondre « déjà raccordé »,
  // le raccordement s'arrêtait aussitôt, et l'anneau du comptoir restait vide. Mesuré sur
  // celtic_island_large_05 : 0 route sur les 30 cases ortho du comptoir, dont 29 sur terre,
  // pour un plan qui compte 13 933 cases de route — et 147 services isolés en conséquence,
  // puisque `rootedRoadSet` ne trouvait aucune racine. Sur roman_island_small_02, une seule.
  //
  // Même forme que `orthoRoadCells` (streetGrid), qui sert partout ailleurs.
  const perimeter: number[] = [];
  for (let i = 0; i < w; i++) {
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
  // déjà raccordé ? (une ligne du peigne longe l'emprise, ou un losange en touche le bord)
  if (routesAuContactRect(reseau, res.x, res.y, w, h).length) {
    return { building, roads: [], removed: [], connected: true };
  }
  const MAX_STUB = 60;

  {
    // Le plus court chemin qui épargne les maisons (`prixCaseRasee`), en losanges aussi avec
    // `diagonales`. Le chemin ne traverse pas l'emprise du comptoir, absente de `buildings`.
    const interdit = new Uint8Array(N);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = res.x + i, y = res.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) interdit[y * W + x] = 1;
    }
    const t = terrainDeLiaison(grid, reseau, owner, buildings, demolishable, interdit, opts);
    const departs: { id: number; cout: number }[] = [];
    noeudsAuContactRect(reseau, res.x, res.y, w, h, (id) => {
      if (t.posable(id)) departs.push({ id, cout: t.coutEntree(id) });
    });
    const chemin = cheminMele(reseau, departs, (n) => estRoute(reseau, n), t.posable, t.coutEntree, MAX_STUB);
    if (chemin) {
      const removed = new Set<string>();
      for (const n of chemin) for (const c of t.casesDe(n)) if (owner[c] >= 0) removed.add(buildings[owner[c]].uid);
      return { building, roads: chemin.map((n) => routeDe(reseau, n)), removed: [...removed], connected: true };
    }
    // aucun chemin dans la longueur permise, prix compris, ou deux losanges qui se
    // chevaucheraient : le tracé historique, le plus court à travers les maisons
  }

  const passable = (c: number): boolean => {
    if (!grid.usable[c] && !routeSeule(grid, c)) return false; // pont sur une rivière
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
  // remonter le chemin depuis `fin` : poser les routes, noter les bâtiments rasés
  const chemin = (fin: number): KontorPlacement => {
    const out: RoadTile[] = [];
    const removed = new Set<string>();
    for (let cur = fin; cur >= 0; cur = prev[cur]) {
      const o = owner[cur];
      if (o >= 0) removed.add(buildings[o].uid);
      out.push({ x: cur % W, y: (cur / W) | 0 });
    }
    return { building, roads: out, removed: [...removed], connected: true };
  };
  for (let depth = 0; depth < MAX_STUB && frontier.length; depth++) {
    const next: number[] = [];
    for (const c of frontier) {
      // la case est sous un losange de route : jonction par recouvrement, le réseau diagonal est atteint
      if (losangeSur(reseau, c) >= 0) return chemin(c);
      const x = c % W, y = (c / W) | 0;
      for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
        if (nb < 0 || prev[nb] !== -2) continue;
        if (roadAt[nb]) return chemin(c);
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
  /**
   * Bâtiments que le raccordement a le droit de RASER pour s'ouvrir un passage — les
   * résidences, en pratique. Sans lui, la réparation ne traversait que des cases LIBRES ;
   * or après le placement il n'en reste aucune, et tout îlot enclavé dans le tissu urbain
   * était déclaré irrécupérable. Mesuré sur huit îles : six en avaient, jusqu'à 31 bâtiments
   * inactifs sur une île de 73 maisons — marchés, puits et fana compris, donc des maisons
   * comptées comme desservies alors qu'elles ne le sont pas.
   *
   * `connectKontor` s'autorise exactement la même chose, et pour la même raison.
   */
  demolishable?: (defId: string) => boolean,
  opts: OptionsLiaison = {},
): {
  roads: RoadTile[]; added: number; dropped: number; orphans: number;
  stranded: PlacedBuilding[];
  /** uids rasés pour rouvrir un passage vers le comptoir */
  removed: string[];
} {
  const W = grid.w, H = grid.h, N = W * H;
  // le réseau en graphe (`engine/reseauRoutier`) ; les tableaux de routes sont indexés par nœud
  const reseau = reseauDeRoutes(W, H, roads);
  const roadAt = reseau.droite;
  const T = tailleReseau(reseau);
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
  // noyau = composante atteignable depuis les racines (comptoir/entrepôt)
  const inCore = new Uint8Array(T);
  const seeds: number[] = [];
  for (const b of buildings) {
    const d = lookup(b.defId);
    if (!d?.roadRoot) continue;
    const fp = footprintSize(d, b.rotation);
    // Les routes AU CONTACT de la racine : par un côté, ou un losange par sa pointe. Les 4 cases
    // EN COIN de l'emprise, comptées jusqu'au 30/10/2026, ne sont pas un raccordement en jeu
    // (cf. `connectKontor`, `rootedRoadSet`) : une route posée là faisait croire le noyau relié.
    seeds.push(...routesAuContactRect(reseau, b.x, b.y, fp.w, fp.h));
  }
  if (!seeds.length) return { roads, added: 0, dropped: 0, orphans: 0, stranded: [], removed: [] };
  const grow = (from: number[]) => {
    let fr = from.filter((c) => !inCore[c]);
    for (const c of fr) inCore[c] = 1;
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) voisins(reseau, c, (n) => { if (!inCore[n]) { inCore[n] = 1; next.push(n); } });
      fr = next;
    }
  };
  grow(seeds);

  // un bâtiment a-t-il déjà un accès sur le réseau enraciné ?
  const servedByCore = new Uint8Array(buildings.length);
  for (let c = 0; c < T; c++) {
    if (!inCore[c]) continue;
    casesAuContact(reseau, c, (n) => { if (owner[n] >= 0) servedByCore[owner[n]] = 1; });
  }

  // îlots : composantes de routes hors noyau, traitées une par une
  const drop = new Uint8Array(T);
  const extra: number[] = [];
  const seen = new Uint8Array(T);
  let added = 0, dropped = 0, orphans = 0;
  // Bâtiments dont le SEUL accès passe par un îlot irrécupérable : inactifs en jeu. C'est
  // d'eux que l'utilisateur a besoin, pas du nombre de cases de route concernées.
  const strandedIdx = new Set<number>();
  const razedIdx = new Set<number>();
  const terrain = terrainDeLiaison(grid, reseau, owner, buildings, demolishable, new Uint8Array(N), opts);
  // les îlots : composantes de routes hors noyau
  const ilots: number[][] = [];
  for (let i = 0; i < T; i++) {
    if (!estRoute(reseau, i) || inCore[i] || seen[i]) continue;
    const comp: number[] = [];
    let fr = [i];
    seen[i] = 1;
    while (fr.length) {
      const next: number[] = [];
      for (const c of fr) {
        comp.push(c);
        voisins(reseau, c, (n) => { if (!seen[n]) { seen[n] = 1; next.push(n); } });
      }
      fr = next;
    }
    ilots.push(comp);
  }

  /** Pose les nœuds d'un chemin qui ne sont pas déjà des routes ; ce qu'il traverse est rasé. */
  const poserChemin = (chemin: number[]) => {
    for (const cur of chemin) {
      if (estRoute(reseau, cur)) continue;
      for (const c of terrain.casesDe(cur)) if (owner[c] >= 0) razedIdx.add(owner[c]);
      if (cur < N) roadAt[cur] = 1;
      else { const t = routeDe(reseau, cur); poserLosange(reseau, t.x, t.y); }
      extra.push(cur);
      added++;
    }
  };

  /** Raccroche l'îlot au noyau par un court chemin ; vrai si c'est fait. */
  const raccrocher = (comp: number[]): boolean => {
    let linked = false;
    {
      // le plus court chemin qui épargne les maisons, en losanges aussi avec `diagonales` ;
      // à défaut, le BFS historique ci-dessous, le plus court à travers les maisons
      const chemin = cheminMele(
        reseau, comp.map((id) => ({ id, cout: 0 })), (n) => inCore[n] === 1, terrain.posable, terrain.coutEntree, maxDetour,
      );
      if (chemin) { poserChemin(chemin); linked = true; }
    }
    // raccrochage : BFS court depuis l'îlot, à travers les cases LIBRES, vers le noyau
    const prev = new Map<number, number>();
    let frontier: number[] = [];
    for (const c of comp) { prev.set(c, -1); frontier.push(c); }
    for (let depth = 0; depth <= maxDetour && frontier.length && !linked; depth++) {
      const next: number[] = [];
      for (const c of frontier) {
        // liés à `c` : les cases droites (gauche, droite, haut, bas), puis les losanges qui la recouvrent
        noeudsLiesDuReseau(reseau, c, (n) => {
          if (linked || prev.has(n)) return;
          if (inCore[n]) {
            for (let cur = c; cur >= 0 && !estRoute(reseau, cur); cur = prev.get(cur)!) {
              // la case appartenait à une résidence : elle tombe, tout entière
              if (owner[cur] >= 0) razedIdx.add(owner[cur]);
              roadAt[cur] = 1;
              extra.push(cur);
              added++;
            }
            linked = true;
            return;
          }
          // le raccord se trace en cases droites : un losange hors du noyau ne se traverse pas
          if (estLosange(reseau, n)) return;
          // les cases de route (y compris d'AUTRES îlots) sont traversables : un îlot peut
          // rejoindre le noyau en passant par un îlot voisin. La mer bloque toujours ; un
          // bâtiment aussi, SAUF s'il est démolissable — une poignée de maisons contre une
          // dizaine de bâtiments rendus actifs est un échange évident.
          // une rivière se franchit par un pont, comme partout ailleurs dans le moteur
          // (`routeSeule`) : sans cela, une rive bâtie restait coupée du comptoir — mesuré
          // dans le repère diagonal de roman_island_medium_01, 256 maisons rasées
          if (!grid.usable[n] && !routeSeule(grid, n)) return;
          if (occ[n] && !(owner[n] >= 0 && demolishable?.(buildings[owner[n]].defId))) return;
          prev.set(n, c);
          next.push(n);
        });
        if (linked) break;
      }
      frontier = next;
    }
    return linked;
  };

  // PASSES JUSQU'À STABILITÉ. Un îlot ne se raccroche souvent qu'À TRAVERS un autre, raccroché
  // plus tard dans l'ordre de la grille : traités une seule fois, du haut vers le bas, les îlots
  // du fond restaient isolés pour toujours. Mesuré sur roman_island_small_05 : tout le quartier
  // nord, derrière un îlot du milieu, coupé du comptoir — 495 cases de route orphelines, 87
  // bâtiments isolés, 74 maisons rasées et 16 services inactifs. On repasse donc sur les échecs
  // tant qu'un raccrochage a réussi : le noyau a grandi, ils en sont peut-être à portée.
  let enAttente = ilots;
  for (let progres = true; progres && enAttente.length;) {
    progres = false;
    const echecs: number[][] = [];
    for (const comp of enAttente) {
      if (inCore[comp[0]]) continue; // absorbé par un raccord voisin
      if (raccrocher(comp)) { grow(comp); progres = true; } else echecs.push(comp);
    }
    enAttente = echecs;
  }

  const recompterServis = () => {
    servedByCore.fill(0);
    for (let c = 0; c < T; c++) {
      if (!inCore[c]) continue;
      casesAuContact(reseau, c, (n) => { if (owner[n] >= 0) servedByCore[owner[n]] = 1; });
    }
  };

  // RACCORDER LE BÂTIMENT, PAS SEULEMENT SON ÎLOT. Le chemin partait des seules cases de
  // l'îlot : une source d'aqueduc, dont la route est creusée côté montagne, ne pouvait pas
  // revenir vers la ville, alors que de l'autre côté de son emprise le noyau était à 2 ou 3
  // cases (mesuré sur roman_island_large_02 et medium_02). Pour chaque bâtiment qu'un îlot
  // irrécupérable laissait seul, on cherche donc aussi un chemin depuis tout son pourtour —
  // sans jamais traverser le bâtiment lui-même.
  recompterServis();
  for (const comp of enAttente) {
    if (inCore[comp[0]]) continue;
    const seuls = new Set<number>();
    for (const c of comp) casesAuContact(reseau, c, (n) => { if (owner[n] >= 0 && !servedByCore[owner[n]]) seuls.add(owner[n]); });
    for (const bi of seuls) {
      if (servedByCore[bi]) continue; // servi entre-temps par un autre raccord
      const b = buildings[bi], d = lookup(b.defId);
      if (!d?.needsRoad || d.roadRoot) continue;
      const fp = footprintSize(d, b.rotation);
      const horsDuBatiment = (n: number) => terrain.posable(n) && !terrain.casesDe(n).some((c) => owner[c] === bi);
      const departs: { id: number; cout: number }[] = [];
      noeudsAuContactRect(reseau, b.x, b.y, fp.w, fp.h, (id) => {
        if (horsDuBatiment(id)) departs.push({ id, cout: estRoute(reseau, id) ? 0 : terrain.coutEntree(id) });
      });
      const chemin = cheminMele(reseau, departs, (n) => inCore[n] === 1, horsDuBatiment, terrain.coutEntree, maxDetour);
      if (!chemin) continue;
      poserChemin(chemin);
      grow(chemin);
      recompterServis();
    }
  }

  // les bâtiments desservis par le noyau, une fois tous les raccords posés
  recompterServis();
  for (const comp of enAttente) {
    // Irrécupérable. Deux cas très différents :
    //  - tous les bâtiments qu'il dessert touchent déjà le réseau enraciné → l'îlot ne sert
    //    À RIEN (reliquat d'élagage : case d'accès secondaire d'une maison). On le SUPPRIME,
    //    c'est du sol rendu et une route de moins à payer.
    //  - sinon des bâtiments n'ont d'accès QUE par cet îlot → ils seraient inactifs en jeu.
    //    On garde et on signale : supprimer masquerait l'anomalie.
    const served = new Set<number>();
    for (const c of comp) casesAuContact(reseau, c, (n) => { if (owner[n] >= 0) served.add(owner[n]); });
    const useless = [...served].every((bi) => servedByCore[bi]);
    if (useless) {
      for (const c of comp) {
        drop[c] = 1;
        if (c < N) roadAt[c] = 0;
        else { const t = routeDe(reseau, c); retirerLosange(reseau, t.x, t.y); }
      }
      dropped += comp.length;
    } else {
      orphans += comp.length;
      for (const bi of served) if (!servedByCore[bi]) strandedIdx.add(bi);
    }
  }
  const out: RoadTile[] = [];
  for (const r of roads) {
    const id = idDeRoute(reseau, r);
    if (id < 0 || !drop[id]) out.push(r);
  }
  for (const c of extra) out.push(routeDe(reseau, c));
  return {
    roads: out, added, dropped, orphans,
    stranded: [...strandedIdx].filter((bi) => !razedIdx.has(bi)).map((bi) => buildings[bi]),
    removed: [...razedIdx].map((bi) => buildings[bi].uid),
  };
}

// ═══ LIAISONS EN DIAGONALE (trame mêlée, étape 6) ═════════════════════════════════════════
//
// Le comptoir et les îlots de route se raccordaient en cases droites seulement : un couloir en
// biais se traversait en escalier, et le chemin rasait les maisons qu'il croisait. Avec
// `diagonales`, la liaison se cherche dans le réseau mêlé (`engine/reseauRoutier`) : elle peut
// poser des losanges de route, longs de √2, là où c'est plus court. Expérimental et désactivé
// par défaut : l'éditeur, le rendu et la persistance ne savent pas encore dessiner un losange.

/** Options de tracé des liaisons (comptoir, réparation des îlots). */
export interface OptionsLiaison {
  /** Tracer aussi en diagonale : le chemin peut poser des losanges de route. */
  diagonales?: boolean;
  /** Conduites d'eau : un losange ne se pose pas dessus (règle prudente, question Q3). */
  aqueducs?: readonly { x: number; y: number }[];
  /**
   * Prix d'une case de maison traversée, en longueur de route (défaut `PRIX_CASE_RASEE`) : 0,
   * le plus court chemin à travers les maisons ; plus, un détour qui les épargne.
   */
  prixCaseRasee?: number;
}

/**
 * ═══ UNE MAISON RASÉE COÛTE PLUS QU'UN DÉTOUR ═════════════════════════════════════════════
 *
 * Le raccordement du comptoir et la réparation des îlots prenaient le plus court chemin, à
 * travers les maisons, sans les compter : toutes les îles en rasaient (263 sur 27 îles
 * romaines, Patriciens, pavée). Une case de maison traversée coûte désormais ce prix, en cases
 * de route. Mesuré sur ces 27 îles (étape 6 de la trame mêlée) : à 3, 197 maisons rasées,
 * +1 364 habitants, 23 îles en hausse, aucune en baisse ; à 1, +1 163 ; à 6 et 10, +1 284 et
 * +1 271, les détours s'allongent et medium_02 recule.
 */
export const PRIX_CASE_RASEE = 3;

/** Ce qu'une liaison peut traverser, et ce que chaque pas lui coûte. */
function terrainDeLiaison(
  grid: GridShape,
  reseau: ReseauRoutier,
  owner: Int32Array,
  buildings: PlacedBuilding[],
  demolishable: ((defId: string) => boolean) | undefined,
  interdit: Uint8Array,
  opts: OptionsLiaison,
) {
  const { W, N } = reseau;
  const sousConduite = new Uint8Array(N);
  for (const a of opts.aqueducs ?? []) if (a.x >= 0 && a.y >= 0 && a.x < W && a.y < grid.h) sousConduite[a.y * W + a.x] = 1;
  const prix = opts.prixCaseRasee ?? PRIX_CASE_RASEE;
  const caseOk = (c: number): boolean => {
    if (interdit[c] || (!grid.usable[c] && !routeSeule(grid, c))) return false;
    const o = owner[c];
    return o < 0 || !!demolishable?.(buildings[o].defId);
  };
  const casesDe = (n: number): number[] => {
    if (n < N) return [n];
    const out: number[] = [];
    const { X, Y } = coinDe(reseau, n);
    casesSousLosange(reseau, X, Y, (c) => out.push(c));
    return out;
  };
  /** Un losange se pose si ses 4 demi-cases sont dans la grille, posables, hors conduite, et s'il
   *  ne chevauche aucun losange de route (seuls ses voisins par un côté ne le chevauchent pas). */
  const losangePosable = (n: number): boolean => {
    if (!opts.diagonales) return false;
    const { X, Y } = coinDe(reseau, n);
    if (X < 1 || Y < 1 || X >= reseau.W || Y >= reseau.H) return false;
    for (const c of casesDe(n)) if (!caseOk(c) || sousConduite[c]) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (reseau.losange[(Y + dy) * (W + 1) + X + dx]) return false;
    }
    return true;
  };
  const posable = (n: number): boolean => (n < N ? caseOk(n) : estRoute(reseau, n) || losangePosable(n));
  const coutEntree = (n: number): number => {
    let rasees = 0;
    for (const c of casesDe(n)) if (owner[c] >= 0) rasees++;
    return coutDe(reseau, n) + prix * (n < N ? rasees : rasees / 2);
  };
  return { posable, coutEntree, casesDe };
}

/** Deux losanges se chevauchent s'ils sont centrés sur des coins voisins par un côté de la grille. */
const losangesSeChevauchent = (reseau: ReseauRoutier, a: number, b: number): boolean => {
  const p = coinDe(reseau, a), q = coinDe(reseau, b);
  return Math.abs(p.X - q.X) + Math.abs(p.Y - q.Y) === 1;
};

/**
 * Le plus court chemin (Dijkstra) depuis `departs` jusqu'à un nœud voisin d'une `arrivee`, par
 * les arêtes du réseau mêlé, à travers des nœuds `posable`s, dans une longueur `budget`.
 * Renvoie les nœuds du chemin, de celui qui touche l'arrivée jusqu'au départ, ou `null` — aussi
 * quand le chemin poserait deux losanges qui se chevauchent (l'appelant retrace alors en droit).
 */
function cheminMele(
  reseau: ReseauRoutier,
  departs: { id: number; cout: number }[],
  arrivee: (n: number) => boolean,
  posable: (n: number) => boolean,
  coutEntree: (n: number) => number,
  budget: number,
): number[] | null {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const file = new FileDeNoeuds();
  for (const { id, cout } of departs) {
    if ((dist.get(id) ?? Infinity) <= cout) continue;
    dist.set(id, cout); prev.set(id, -1); file.pousser(cout, id);
  }
  while (file.taille) {
    const [d, c] = file.extraire();
    if (d > dist.get(c)! + 1e-9) continue; // entrée périmée
    let atteint = false;
    noeudsLies(reseau, c, (n) => {
      if (atteint) return;
      if (arrivee(n)) { atteint = true; return; }
      if (!posable(n)) return;
      const dn = d + coutEntree(n);
      if (dn > budget + 1e-9 || dn >= (dist.get(n) ?? Infinity) - 1e-9) return;
      dist.set(n, dn); prev.set(n, c); file.pousser(dn, n);
    });
    if (!atteint) continue;
    const chemin: number[] = [];
    for (let cur = c; cur >= 0; cur = prev.get(cur)!) chemin.push(cur);
    const poses = chemin.filter((n) => estLosange(reseau, n) && !estRoute(reseau, n));
    for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) {
      if (losangesSeChevauchent(reseau, poses[i], poses[j])) return null;
    }
    return chemin;
  }
  return null;
}
