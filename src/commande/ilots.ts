import type { BuildingDef, GridShape, Layout, PlacedBuilding, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { rootedRoadSet, roadConnected } from "../engine/rules";
import { footprintSize, routeSeule } from "../engine/geometry";
import { cityStatusAttrs, economy, effectOf, residentialChainExtended, tierByGuid } from "../economy/economy";
import { compileTierEvaluator } from "../economy/needsModel";
import { VITAL_ATTRS } from "../economy/attributes";
import { uid } from "../model/factories";
import { blockMountains, MAX_RUN, needsWater, planWater, waterDemandOf } from "../optimizer/waterPlan";
import { connectKontor, keepMainLandmass, pickKontorDef, reserveKontor } from "../optimizer/kontor";
import { pruneDeadEnds } from "../optimizer/roadCleanup";
import { planQuality } from "../optimizer/planQuality";
import { verdictViable } from "../optimizer/viability";
import { nomenclature, type Commande } from "./nomenclature";
import { copiesEnTrop } from "../optimizer/doublons";
import { distancesDeCroissance, type DispositionOpts, type LignePosee, type PlanQuartiers } from "./disposition";
import { planningRange } from "../engine/roads";

/**
 * ═══ LES ÎLOTS : UNE VILLE QUI SE LIT ═════════════════════════════════════════════════
 *
 * Étape 5 de la refonte (`docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`).
 *
 * Premier essai : `planLattice` sur une zone bornée. Mesuré sur 300 Patriciens : 7 Temples et
 * 6 Forums là où un ou deux suffisent, un anneau de routes autour de chaque service, 12 % du
 * sol en maisons, et l'eau qui n'arrivait pas — les conduites ne trouvaient aucun passage dans
 * le tissu. Ce moteur remplit une île ; il ne sait pas dimensionner un quartier.
 *
 * Ici la ville est une TRAME D'ÎLOTS, comme on bâtit en jeu :
 *
 *   route ─────────────────────────────            un îlot = 12 × 6 cases = 8 maisons 3×3,
 *         ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢ ┊                          deux rangées dos à dos, chacune sur sa
 *         ▢▢▢ ▢▢▢ ▢▢▢ ▢▢▢ ┊ ← allée (libre)          route. Entre deux îlots d'une même
 *   route ─────────────────────────────            rangée : une route, ou une ALLÉE libre
 *                                                  par où passent les aqueducs.
 *
 * Les services prennent la place d'îlots : un petit service se range dans un îlot de services
 * (plusieurs par îlot, collés aux routes), un gros fusionne plusieurs îlots et efface les
 * routes intérieures. Chaque copie est posée là où elle couvre le plus de maisons encore non
 * couvertes — distance le long des routes, la sémantique de `rules.ts` — moins les maisons
 * qu'elle déloge. Les maisons délogées reviennent en bordure, et l'on recommence.
 */

export const ILOT = { largeur: 12, hauteur: 6, pasX: 13, pasY: 7, maisons: 8 } as const;
/** Une colonne de séparation sur `ROUTE_TOUTES` est une route, les autres sont des allées. */
const ROUTE_TOUTES = 2;
/** Prix d'une unité d'eau, en maisons : une Citerne (10 u) doit en couvrir cinq de plus. */
const COUT_EAU = 0.5;
/**
 * CORRIDORS D'EAU : toutes les `CORRIDOR_TOUS` rangées d'îlots, la route qui les sépare devient
 * route | voie d'eau | route (+2 rangées). Sans eux l'eau ne circule dans la ville que de haut
 * en bas, par les allées : aucune voie horizontale, si bien qu'un Forum au milieu d'une grande
 * ville restait sec à 46 cases d'une source. Des ponts de route enjambent la voie à chaque
 * colonne de route, pour que le réseau routier ne soit pas coupé en bandes.
 *
 * Ils coûtent ~9 % de sol : on ne les pose qu'en secours, quand le plan sans corridor laisse
 * des consommateurs secs (cf. `disposerQuartiers`).
 */
const CORRIDOR_TOUS = 4;
/** Tours de relocalisation des consommateurs restés secs. Mesuré : au-delà de quatre, les
 *  interdictions s'accumulent et chassent les citernes de toute position utile. */
const TOURS_EAU = 4;


type EtatIlot = "maisons" | "services" | "groupe";

interface Groupe {
  i: number; j: number; k: number; m: number;
  def: BuildingDef; rot: 0 | 90; x: number; y: number;
}

interface PetitService { def: BuildingDef; rot: 0 | 90; x: number; y: number }

/** Taille d'emprise d'un bâtiment dans une orientation. */
const taille = (d: BuildingDef, rot: 0 | 90) => footprintSize(d, rot);

/** Îlots à fusionner (k colonnes × m rangées) pour loger ce bâtiment, et l'orientation. */
export function besoinEnIlots(d: BuildingDef): { k: number; m: number; rot: 0 | 90 } {
  let best: { k: number; m: number; rot: 0 | 90 } | null = null;
  for (const rot of (d.rotatable ? [0, 90] : [0]) as (0 | 90)[]) {
    const { w, h } = taille(d, rot);
    const k = Math.max(1, Math.ceil((w + 1) / ILOT.pasX));
    const m = Math.max(1, Math.ceil((h + 1) / ILOT.pasY));
    if (!best || k * m < best.k * best.m || (k * m === best.k * best.m && rot === 0)) best = { k, m, rot };
  }
  return best!;
}

/** La trame : origine et validité de chaque îlot sur le masque constructible. */
class Trame {
  readonly nI: number; readonly nJ: number;
  /** `corridors` : rangées d'îlots entre deux corridors d'eau, 0 = aucun. */
  constructor(readonly grid: GridShape, readonly ox: number, readonly oy: number, readonly corridors = 0) {
    this.nI = Math.ceil((grid.w - ox) / ILOT.pasX);
    this.nJ = Math.ceil((grid.h - oy) / ILOT.pasY);
  }
  cle(i: number, j: number) { return j * this.nI + i; }
  ij(cle: number) { return { i: cle % this.nI, j: Math.floor(cle / this.nI) }; }
  /** Un corridor d'eau passe-t-il sous la rangée `j` ? */
  corridorSous(j: number) { return this.corridors > 0 && (j + 1) % this.corridors === 0; }
  /** Coin haut-gauche de l'intérieur de l'îlot. Chaque corridor franchi décale de 2 rangées. */
  coin(i: number, j: number) {
    const decalage = this.corridors > 0 ? 2 * Math.floor(j / this.corridors) : 0;
    return { x: this.ox + i * ILOT.pasX + 1, y: this.oy + j * ILOT.pasY + decalage + 1 };
  }
  routeColonne(i: number) { return ((i % ROUTE_TOUTES) + ROUTE_TOUTES) % ROUTE_TOUTES === 0; }
  terre(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.grid.w && y < this.grid.h && this.grid.usable[y * this.grid.w + x];
  }
  /** Une route y passe : la terre, ou une case réservée à la route (cf. `routeSeule`). */
  routable(x: number, y: number) {
    return this.terre(x, y) || (x >= 0 && y >= 0 && x < this.grid.w && y < this.grid.h
      && routeSeule(this.grid, y * this.grid.w + x));
  }
  /** Intérieur tout en terre, et les deux rangées de route qui le bordent aussi. */
  valide(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= this.nI || j >= this.nJ) return false;
    const { x, y } = this.coin(i, j);
    for (let dy = -1; dy <= ILOT.hauteur; dy++) {
      // l'intérieur en terre ; les rangées de route du bord peuvent franchir une rivière
      const ok = dy < 0 || dy >= ILOT.hauteur ? this.routable.bind(this) : this.terre.bind(this);
      for (let dx = 0; dx < ILOT.largeur; dx++) if (!ok(x + dx, y + dy)) return false;
    }
    return true;
  }
}

/** Trame dont les îlots valides les plus proches du comptoir sont les plus nombreux. */
function choisirTrame(base: GridShape, dist: Int32Array, besoin: number, corridors: number): Trame {
  let meilleure: Trame | null = null, score = -1, cout = Infinity;
  // la période verticale inclut le corridor : sa phase se choisit comme celle des îlots
  const periodeY = corridors > 0 ? corridors * ILOT.pasY + 2 : ILOT.pasY;
  for (let oy = -periodeY + 1; oy <= 0; oy++) {
    for (let ox = -ILOT.pasX + 1; ox <= 0; ox++) {
      const t = new Trame(base, ox, oy, corridors);
      const d: number[] = [];
      for (let j = 0; j < t.nJ; j++) for (let i = 0; i < t.nI; i++) {
        if (!t.valide(i, j)) continue;
        const { x, y } = t.coin(i, j);
        const c = (y + 2) * base.w + x + 5;
        if (dist[c] >= 0) d.push(dist[c]);
      }
      d.sort((a, b) => a - b);
      // à nombre d'îlots égal, la trame la plus serrée autour du comptoir
      const n = Math.min(d.length, besoin);
      const somme = d.slice(0, n).reduce((a, b) => a + b, 0);
      if (n > score || (n === score && somme < cout)) { meilleure = t; score = n; cout = somme; }
    }
  }
  return meilleure!;
}

interface Maison { cle: number; x: number; y: number }

/**
 * Plus court chemin de route du périmètre d'une emprise (sans les coins : l'accès est
 * orthogonal) jusqu'au réseau, par des cases de terre libres — ni bâtiment, ni conduite.
 * Sert au comptoir et aux sources d'aqueduc. `null` si aucun chemin n'existe.
 */
export function routeVersReseau(
  grid: GridShape,
  k: { x: number; y: number; w: number; h: number },
  buildings: PlacedBuilding[],
  roads: RoadTile[],
  aqueducs: { x: number; y: number }[],
  lookup: DefLookup,
): RoadTile[] | null {
  const W = grid.w, H = grid.h, N = W * H;
  // terre, ou case réservée à la route (rivière franchie par un pont, façade d'emplacement)
  const sol = (c: number) => grid.usable[c] || routeSeule(grid, c);
  const route = new Uint8Array(N);
  for (const r of roads) route[r.y * W + r.x] = 1;
  const pris = new Uint8Array(N);
  for (const b of buildings) {
    const d = lookup(b.defId);
    if (!d) continue;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) pris[y * W + x] = 1;
    }
  }
  const conduite = new Uint8Array(N);
  for (const a of aqueducs) conduite[a.y * W + a.x] = 1;
  for (let j = 0; j < k.h; j++) for (let i = 0; i < k.w; i++) pris[(k.y + j) * W + k.x + i] = 1;
  const depart: number[] = [];
  for (let i = 0; i < k.w; i++) for (const y of [k.y - 1, k.y + k.h]) if (y >= 0 && y < H) depart.push(y * W + k.x + i);
  for (let j = 0; j < k.h; j++) for (const x of [k.x - 1, k.x + k.w]) if (x >= 0 && x < W) depart.push((k.y + j) * W + x);
  if (depart.some((c) => route[c])) return [];
  const prev = new Int32Array(N).fill(-2);
  let front: number[] = [];
  for (const c of depart) if (sol(c) && !pris[c] && prev[c] === -2) { prev[c] = -1; front.push(c); }
  const chemin = (fin: number): RoadTile[] => {
    const out: RoadTile[] = [];
    for (let cur = fin; cur >= 0; cur = prev[cur]) out.push({ x: cur % W, y: (cur / W) | 0 });
    return out;
  };
  /** Case voisine de `c` dans la direction `d` (±1 : horizontale, ±W : verticale), ou -1. */
  const voisine = (c: number, d: number): number => {
    const x = c % W;
    if ((d === 1 && x === W - 1) || (d === -1 && x === 0)) return -1;
    const n = c + d;
    return n >= 0 && n < N ? n : -1;
  };
  // UNE ROUTE FRANCHIT UNE CONDUITE À ANGLE DROIT, comme une conduite franchit une route.
  // Interdire toute case de conduite coupait le comptoir de la ville dès qu'un aqueduc longeait
  // le bas des quartiers : le chemin échouait, le raccord de secours s'accrochait à un bout de
  // route isolé, et les 300 maisons de roman_island_medium_01 (Patriciens, routes pavées,
  // données du patch 200) se retrouvaient sans accès au comptoir. Le franchissement va tout
  // droit, sur une conduite qui passe perpendiculairement, vers une case libre ou une route.
  const franchit = (n: number, d: number): boolean => {
    if (!conduite[n]) return false;
    const avant = voisine(n, -d), apres = voisine(n, d);
    return !(avant >= 0 && conduite[avant]) && !(apres >= 0 && conduite[apres]);
  };
  while (front.length) {
    const next: number[] = [];
    for (const c of front) {
      for (const d of [1, -1, W, -W]) {
        const n = voisine(c, d);
        if (n < 0 || prev[n] !== -2) continue;
        if (route[n]) return chemin(c);
        if (!sol(n) || pris[n]) continue;
        if (conduite[n]) {
          if (!franchit(n, d)) continue;
          const au = voisine(n, d);
          if (au < 0 || prev[au] !== -2) continue;
          if (route[au]) { prev[n] = c; return chemin(n); }
          if (!sol(au) || pris[au] || conduite[au]) continue;
          prev[n] = c;
          prev[au] = n;
          next.push(au);
          continue;
        }
        prev[n] = c;
        next.push(n);
      }
    }
    front = next;
  }
  return null;
}

/**
 * Pose les quartiers d'une commande en îlots, sur une île (grille TUILE, celle des moteurs).
 * Les positions sont déterministes ; les `uid`, horodatés, ne le sont pas.
 */
export function disposerQuartiers(
  grid: GridShape,
  commande: Commande,
  catalog: BuildingDef[],
  lookup: DefLookup,
  opts: DispositionOpts = {},
): PlanQuartiers {
  const simple = disposer(grid, commande, catalog, lookup, opts);
  if (opts.corridors !== undefined || !simple.manques.some((m) => m.startsWith(SANS_EAU))) return simple;
  // Des consommateurs secs : on retente avec des corridors d'eau, et l'on garde le plan qui
  // loge le plus. Les corridors coûtent du sol ; ils ne gagnent que si l'eau bloquait vraiment.
  const avecCorridors = disposer(grid, commande, catalog, lookup, { ...opts, corridors: CORRIDOR_TOUS });
  return avecCorridors.habitants > simple.habitants ? avecCorridors : simple;
}

/** Préfixe du manque qui signale des consommateurs d'eau restés secs. */
const SANS_EAU = "Sans eau";

function disposer(
  grid: GridShape,
  commande: Commande,
  catalog: BuildingDef[],
  lookup: DefLookup,
  opts: DispositionOpts,
): PlanQuartiers {
  const W = grid.w, H = grid.h, N = W * H;
  let terre = 0;
  for (const u of grid.usable) if (u) terre++;
  const nom = nomenclature({ ...commande, terre: commande.terre ?? terre }, catalog, lookup);
  const avertissements = [...nom.avertissements];
  const manques: string[] = [];

  // ─── COMPTOIR, MASSE CONTINENTALE, DISTANCES ────────────────────────────────────────
  const kontorDef = pickKontorDef(catalog, commande.region);
  const kontor = kontorDef ? reserveKontor(grid, kontorDef) : null;
  if (!kontor) avertissements.push("Aucun comptoir posable : pas de littoral exploitable");
  const base = blockMountains(keepMainLandmass(kontor?.grid ?? grid, kontor ?? undefined));
  const kontorRect = kontor ? { x: kontor.x, y: kontor.y, ...footprintSize(kontor.def, kontor.rotation) } : undefined;
  const graines: number[] = [];
  if (kontorRect) {
    for (let x = kontorRect.x - 1; x <= kontorRect.x + kontorRect.w; x++) {
      for (const y of [kontorRect.y - 1, kontorRect.y + kontorRect.h]) if (x >= 0 && y >= 0 && x < W && y < H) graines.push(y * W + x);
    }
    for (let y = kontorRect.y; y < kontorRect.y + kontorRect.h; y++) {
      for (const x of [kontorRect.x - 1, kontorRect.x + kontorRect.w]) if (x >= 0 && y >= 0 && x < W && y < H) graines.push(y * W + x);
    }
  }
  if (!graines.some((g) => base.usable[g])) {
    const premiere = base.usable.findIndex((u) => u);
    if (premiere >= 0) graines.push(premiere);
  }
  const dist = distancesDeCroissance(base, graines);

  // ─── CE QU'IL FAUT LOGER, ET AVEC QUOI ──────────────────────────────────────────────
  const tierDeResidence = new Map(economy.tiers.filter((t) => t.residenceId).map((t) => [t.residenceId!, t]));
  const besoins = nom.lignes
    .filter((l) => l.role === "residence" || l.role === "ouvriers")
    .map((l) => ({ tierGuid: tierDeResidence.get(l.defId)!.guid, defId: l.defId, nombre: l.nombre, role: l.role, nom: l.nom }));
  const totalMaisons = besoins.reduce((s, b) => s + b.nombre, 0);
  const sommet = besoins.map((b) => tierByGuid(b.tierGuid)!).sort((a, b) => b.capacityDefault - a.capacityDefault)[0];
  const paliersDemandes = [...new Set(besoins.map((b) => b.tierGuid))].map((g) => tierByGuid(g)!);
  const evals = new Map<string, { chaine: ReturnType<typeof residentialChainExtended>; ev: ReturnType<typeof compileTierEvaluator> }>();
  const evalDe = (g: string) => {
    let e = evals.get(g);
    if (!e) {
      const ch = residentialChainExtended(g);
      e = { chaine: ch, ev: compileTierEvaluator(ch, { goodsMet: true }) };
      evals.set(g, e);
    }
    return e;
  };
  const rangeOf = (d: BuildingDef) => planningRange(d, commande.routes);
  const types = nom.lignes
    .filter((l) => l.role === "service" || l.role === "institution")
    .map((l) => ({ def: lookup(l.defId)!, institution: l.role === "institution" }))
    .filter((t) => !!t.def && rangeOf(t.def) > 0);

  const besoinIlots = Math.ceil(totalMaisons / ILOT.maisons);
  const trame = choisirTrame(base, dist, besoinIlots * 2, opts.corridors ?? 0);
  const valides: number[] = [];
  const distIlot = new Map<number, number>();
  for (let j = 0; j < trame.nJ; j++) for (let i = 0; i < trame.nI; i++) {
    if (!trame.valide(i, j)) continue;
    const { x, y } = trame.coin(i, j);
    const d = dist[(y + 2) * W + x + 5];
    if (d < 0) continue;
    const cle = trame.cle(i, j);
    valides.push(cle);
    distIlot.set(cle, d);
  }
  const estValide = new Set(valides);

  // ─── LE CENTRE DE LA VILLE ──────────────────────────────────────────────────────────
  // La ville poussait DEPUIS le comptoir : sur une île étroite elle s'allongeait le long de la
  // côte (113 × 143 cases pour 300 maisons sur `roman_island_medium_01`), et un Temple de portée
  // 68 n'en couvrait que les deux tiers. On la centre donc sur la partie la plus pleine de
  // l'île, à portée raisonnable du comptoir : le disque qui contient le plus d'îlots valides,
  // et parmi les quasi-ex-aequo (à 5 % près), le plus proche du comptoir. Une route l'y relie.
  const casesServices = nom.lignes
    .filter((l) => l.role === "service" || l.role === "institution")
    .reduce((s, l) => s + l.nombre * l.emprise, 0);
  const ilotsServices = Math.ceil(casesServices / (ILOT.largeur * ILOT.hauteur));
  const rayon = Math.sqrt(((besoinIlots + ilotsServices) * ILOT.pasX * ILOT.pasY) / Math.PI) * 1.15;
  const ri = Math.ceil(rayon / ILOT.pasX), rj = Math.ceil(rayon / ILOT.pasY);
  const plein = new Map<number, number>();
  for (const c of valides) {
    const { i, j } = trame.ij(c);
    let n = 0;
    for (let dj = -rj; dj <= rj; dj++) for (let di = -ri; di <= ri; di++) {
      if ((di * ILOT.pasX) ** 2 + (dj * ILOT.pasY) ** 2 > rayon * rayon) continue;
      if (estValide.has(trame.cle(i + di, j + dj)) && i + di >= 0 && i + di < trame.nI) n++;
    }
    plein.set(c, n);
  }
  // À PORTÉE D'AQUEDUC. Le centre le plus plein de `roman_island_small_01` était à plus de
  // cent cases de toute montagne : ni le Forum ni aucune citerne n'y recevaient d'eau, et 240
  // maisons sur 300 restaient sous leur palier. On ne retient que des centres à moins de
  // 60 % de la longueur maximale d'une conduite d'un emplacement de montagne, s'il en est.
  const montagnes = (grid.slots ?? []).filter((sl) => sl.type === "mountain");
  const prochesEau = valides.filter((c) => {
    const q = trame.coin(trame.ij(c).i, trame.ij(c).j);
    return montagnes.some((sl) => Math.hypot(sl.x - (q.x + 6), sl.y - (q.y + 3)) <= 0.6 * MAX_RUN);
  });
  const vivier = prochesEau.length ? prochesEau : valides;
  const maxPlein = Math.max(0, ...vivier.map((c) => plein.get(c)!));
  const centre = vivier
    .filter((c) => plein.get(c)! >= 0.95 * maxPlein)
    .sort((a, b) => distIlot.get(a)! - distIlot.get(b)! || a - b)[0];
  const centreVille = centre !== undefined
    ? (() => { const q = trame.coin(trame.ij(centre).i, trame.ij(centre).j); return { x: q.x + 6, y: q.y + 3 }; })()
    : kontorRect ? { x: kontorRect.x + kontorRect.w / 2, y: kontorRect.y + kontorRect.h / 2 } : { x: W / 2, y: H / 2 };
  if (centre !== undefined) {
    const { i, j } = trame.ij(centre);
    const { x, y } = trame.coin(i, j);
    const dc = distancesDeCroissance(base, [(y + 2) * W + x + 5]);
    for (const c of valides) {
      const q = trame.coin(trame.ij(c).i, trame.ij(c).j);
      distIlot.set(c, dc[(q.y + 2) * W + q.x + 5]);
    }
  }
  valides.sort((a, b) => distIlot.get(a)! - distIlot.get(b)! || a - b);

  // ─── ÉTAT DE LA VILLE ───────────────────────────────────────────────────────────────
  const etat = new Map<number, EtatIlot>();
  const groupes: Groupe[] = [];
  const petits = new Map<number, PetitService[]>();
  const occIlot = new Map<number, Uint8Array>(); // 12×6 par îlot de services
  /**
   * Un îlot n'entre dans la ville que si ses routes rejoignent celles qui y sont déjà. Classés
   * par distance le long de la terre, deux îlots peuvent être voisins de part et d'autre d'un
   * bras de mer : mesuré sur `celtic_island_small_01`, 102 maisons sans aucun accès au comptoir.
   * Un îlot écarté maintenant peut devenir rattachable plus tard, quand ses voisins arrivent :
   * on reparcourt donc la liste à chaque appel au lieu d'avancer un curseur.
   */
  const rattachable = (c: number): boolean => {
    if (!etat.size) return true;
    const { x, y } = trame.coin(trame.ij(c).i, trame.ij(c).j);
    for (let dx = -1; dx <= ILOT.largeur; dx++) {
      for (const yy of [y - 1, y + ILOT.hauteur]) {
        const xx = x + dx;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && route[yy * W + xx]) return true;
      }
    }
    return false;
  };
  const ajouterIlotsDeMaisons = (n: number) => {
    let ajoutes = 0;
    for (let progres = true; progres && ajoutes < n; ) {
      progres = false;
      for (const c of valides) {
        if (ajoutes >= n) break;
        if (etat.has(c) || !rattachable(c)) continue;
        etat.set(c, "maisons");
        route = routes();
        ajoutes++;
        progres = true;
        break; // l'ordre de proximité prime : on repart du début après chaque ajout
      }
    }
    return ajoutes;
  };

  /** Routes de la ville dans son état courant. */
  const routes = (): Uint8Array => {
    const r = new Uint8Array(N);
    const poser = (x: number, y: number) => { if (trame.routable(x, y)) r[y * W + x] = 1; };
    for (const c of etat.keys()) {
      const { i, j } = trame.ij(c);
      const { x, y } = trame.coin(i, j);
      for (let dx = -1; dx <= ILOT.largeur; dx++) { poser(x + dx, y - 1); poser(x + dx, y + ILOT.hauteur); }
      // sous un corridor, la colonne de route le franchit : c'est le pont
      const fin = trame.corridorSous(j) ? ILOT.hauteur + 1 : ILOT.hauteur - 1;
      for (let dy = 0; dy <= fin; dy++) {
        if (trame.routeColonne(i)) poser(x - 1, y + dy);
        if (trame.routeColonne(i + 1)) poser(x + ILOT.largeur, y + dy);
      }
    }
    // Un groupe n'efface QUE les routes sous son bâtiment. Effacer tout son intérieur laissait
    // autour d'un Amphithéâtre ou d'un Temple des bandes sans aucune route, donc sans maison :
    // mesuré, le quart de la zone de ville restait vide.
    for (const g of groupes) {
      const t = taille(g.def, g.rot);
      for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) r[(g.y + dy) * W + g.x + dx] = 0;
    }
    return r;
  };
  let route = routes();

  /**
   * Maisons qui tiennent dans le reste d'un intérieur occupé : contre la route du haut ou du
   * bas, de gauche à droite. C'est ce qui rend au logement la place qu'un service laisse
   * libre — un Puits 2×2 dans un îlot y laisse encore quatre maisons.
   */
  const libres = (occ: Uint8Array, w: number, h: number, ox: number, oy: number, cle: number): Maison[] => {
    const out: Maison[] = [];
    const pris = occ.slice();
    for (const r of h >= 6 ? [0, h - 3] : [0]) {
      for (let x = 0; x + 3 <= w; ) {
        let ok = true;
        for (let dy = 0; dy < 3 && ok; dy++) for (let dx = 0; dx < 3; dx++) if (pris[(r + dy) * w + x + dx]) { ok = false; break; }
        if (!ok) { x++; continue; }
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) pris[(r + dy) * w + x + dx] = 1;
        out.push({ cle, x: ox + x, y: oy + r });
        x += 3;
      }
    }
    return out;
  };
  /**
   * Maisons qui tiennent dans les RESTES d'un groupe : îlot par îlot, comme ailleurs, puisque
   * les routes de la trame y survivent hors de l'emprise du bâtiment (cf. `routes`). Une maison
   * de la rangée haute s'appuie sur la route du dessus, celle du bas sur la route du dessous :
   * il faut qu'un bout de cette route ait survécu au bâtiment. Les allées restent entre les
   * îlots, donc libres pour l'eau.
   */
  const maisonsDeGroupe = (
    gi: number, gj: number, k: number, m: number,
    bx: number, by: number, bw: number, bh: number, cle: number,
  ): Maison[] => {
    const sous = (x: number, y: number) => x >= bx && x < bx + bw && y >= by && y < by + bh;
    const out: Maison[] = [];
    for (let dj = 0; dj < m; dj++) for (let di = 0; di < k; di++) {
      const { x: cx, y: cy } = trame.coin(gi + di, gj + dj);
      const occ = new Uint8Array(ILOT.largeur * ILOT.hauteur);
      for (let dy = 0; dy < ILOT.hauteur; dy++) for (let dx = 0; dx < ILOT.largeur; dx++) {
        if (sous(cx + dx, cy + dy)) occ[dy * ILOT.largeur + dx] = 1;
      }
      for (const ms of libres(occ, ILOT.largeur, ILOT.hauteur, cx, cy, cle)) {
        const ry = ms.y === cy ? cy - 1 : cy + ILOT.hauteur;
        let route = false;
        for (let dx = 0; dx < 3; dx++) if (!sous(ms.x + dx, ry) && trame.terre(ms.x + dx, ry)) route = true;
        if (route) out.push(ms);
      }
    }
    return out;
  };

  /** Toutes les maisons de la ville : îlots d'habitation, et restes des îlots de services. */
  const maisons = (): Maison[] => {
    const out: Maison[] = [];
    for (const [c, e] of etat) {
      const { i, j } = trame.ij(c);
      const { x, y } = trame.coin(i, j);
      if (e === "maisons") {
        for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) out.push({ cle: c, x: x + 3 * k, y: y + 3 * r });
      } else if (e === "services") {
        out.push(...libres(occIlot.get(c)!, ILOT.largeur, ILOT.hauteur, x, y, c));
      }
    }
    for (const g of groupes) {
      const t = taille(g.def, g.rot);
      out.push(...maisonsDeGroupe(g.i, g.j, g.k, g.m, g.x, g.y, t.w, t.h, trame.cle(g.i, g.j)));
    }
    return out;
  };

  /** Routes atteintes depuis une emprise, à `portee` près (graines à 1, comme `rules.ts`). */
  const atteintes = (x: number, y: number, w: number, h: number, portee: number): Uint8Array => {
    const vu = new Uint8Array(N);
    let front: number[] = [];
    const graine = (cx: number, cy: number) => {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
      const c = cy * W + cx;
      if (route[c] && !vu[c]) { vu[c] = 1; front.push(c); }
    };
    for (let dx = 0; dx < w; dx++) { graine(x + dx, y - 1); graine(x + dx, y + h); }
    for (let dy = 0; dy < h; dy++) { graine(x - 1, y + dy); graine(x + w, y + dy); }
    for (let d = 1; d < portee && front.length; d++) {
      const next: number[] = [];
      for (const c of front) {
        const cx = c % W;
        for (const n of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
          if (n >= 0 && route[n] && !vu[n]) { vu[n] = 1; next.push(n); }
        }
      }
      front = next;
    }
    return vu;
  };
  /** La maison touche-t-elle une route atteinte ? */
  const couverte = (m: Maison, vu: Uint8Array): boolean => {
    for (let d = 0; d < 3; d++) {
      if (m.y > 0 && vu[(m.y - 1) * W + m.x + d]) return true;
      if (m.y + 3 < H && vu[(m.y + 3) * W + m.x + d]) return true;
      if (m.x > 0 && vu[(m.y + d) * W + m.x - 1]) return true;
      if (m.x + 3 < W && vu[(m.y + d) * W + m.x + 3]) return true;
    }
    return false;
  };

  // ─── PLACER UN SERVICE ──────────────────────────────────────────────────────────────
  interface Candidat {
    cles: number[]; x: number; y: number; w: number; h: number; rot: 0 | 90;
    groupe: { i: number; j: number; k: number; m: number } | null;
  }
  /** Où loger ce bâtiment dans l'îlot `c` (îlot de services existant, ou îlot à convertir). */
  /** Positions où un consommateur est resté SEC : on n'y repose pas le même bâtiment. */
  /** Indices, dans `lesMaisons`, des maisons qu'une copie de `d` couvrirait posée là. */
  const maisonsVues = (d: BuildingDef, x: number, y: number, rot: 0 | 90, lesMaisons: Maison[]): number[] => {
    const { w, h } = taille(d, rot);
    const vu = atteintes(x, y, w, h, rangeOf(d));
    const out: number[] = [];
    lesMaisons.forEach((m, i) => { if (couverte(m, vu)) out.push(i); });
    return out;
  };
  const interdits = new Map<string, Set<number>>();
  const interdit = (d: BuildingDef, x: number, y: number) => interdits.get(d.id)?.has(y * W + x) ?? false;
  /**
   * Cases d'allée déjà prises par un aqueduc lors d'une évaluation où quelqu'un est resté sec.
   * Deux réseaux ne se croisent ni ne fusionnent : un consommateur dont la seule prise d'eau est
   * une conduite d'une source PLEINE ne sera jamais raccordé. Il doit aller chercher une allée
   * encore libre, où un second réseau pourra passer.
   */
  const couloirsPris = new Set<number>();
  /** Le bâtiment posé en (x, y) a-t-il une prise d'eau sur une case d'allée encore libre ? */
  const priseLibre = (x: number, y: number, w: number, h: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (const cx of [x - 1, x + w]) {
        const c = (y + dy) * W + cx;
        if (cx >= 0 && cx < W && !route[c] && base.usable[c] && !couloirsPris.has(c)) return true;
      }
    }
    return false;
  };
  const dansIlot = (d: BuildingDef, c: number): Candidat | null => {
    const e = etat.get(c);
    if (e === "groupe") return null;
    const occ = e === "services" ? occIlot.get(c)! : new Uint8Array(ILOT.largeur * ILOT.hauteur);
    const { i, j } = trame.ij(c);
    const coin = trame.coin(i, j);
    // Un consommateur d'eau se colle à l'ALLÉE de son îlot : c'est le seul passage par où une
    // conduite peut l'atteindre, le reste de l'îlot étant cerné de routes et de maisons.
    const eau = needsWater(d);
    for (const rot of (d.rotatable ? [0, 90] : [0]) as (0 | 90)[]) {
      const { w, h } = taille(d, rot);
      if (w > ILOT.largeur || h > ILOT.hauteur) continue;
      const xs = !eau
        ? Array.from({ length: ILOT.largeur - w + 1 }, (_, k) => k)
        : [!trame.routeColonne(i) ? 0 : -1, !trame.routeColonne(i + 1) ? ILOT.largeur - w : -1].filter((x) => x >= 0);
      for (const y of [0, ILOT.hauteur - h]) {
        for (const x of xs) {
          let libre = true;
          for (let dy = 0; dy < h && libre; dy++) for (let dx = 0; dx < w; dx++) {
            if (occ[(y + dy) * ILOT.largeur + x + dx]) { libre = false; break; }
          }
          if (!libre || interdit(d, coin.x + x, coin.y + y)) continue;
          if (eau && !priseLibre(coin.x + x, coin.y + y, w, h)) continue;
          return { cles: [c], x: coin.x + x, y: coin.y + y, w, h, rot, groupe: null };
        }
      }
    }
    return null;
  };
  const enGroupe = (d: BuildingDef, i: number, j: number): Candidat | null => {
    const { k, m, rot } = besoinEnIlots(d);
    const cles: number[] = [];
    for (let dj = 0; dj < m; dj++) for (let di = 0; di < k; di++) {
      const c = trame.cle(i + di, j + dj);
      if (i + di >= trame.nI || j + dj >= trame.nJ || !estValide.has(c)) return null;
      const e = etat.get(c);
      if (e === "groupe" || e === "services") return null;
      cles.push(c);
    }
    const { x, y } = trame.coin(i, j);
    const { w, h } = taille(d, rot);
    // Contre la séparation de gauche, ou de droite si seule celle-ci est une allée — pour un
    // consommateur d'eau, c'est obligatoire ; pour les autres, le côté route laisse les maisons
    // du reste du groupe contre l'allée, ce qui ne coûte rien.
    const gaucheAllee = !trame.routeColonne(i), droiteAllee = !trame.routeColonne(i + k);
    if (needsWater(d) && !gaucheAllee && !droiteAllee) return null;
    const aDroite = needsWater(d) ? !gaucheAllee : false;
    const gx = aDroite ? x + k * ILOT.pasX - 1 - w : x;
    if (interdit(d, gx, y) || (needsWater(d) && !priseLibre(gx, y, w, h))) return null;
    return { cles, x: gx, y, w, h, rot, groupe: { i, j, k, m } };
  };
  const appliquer = (d: BuildingDef, c: Candidat) => {
    if (c.groupe) {
      const g: Groupe = { ...c.groupe, def: d, rot: c.rot, x: c.x, y: c.y };
      groupes.push(g);
      for (const k of c.cles) etat.set(k, "groupe");
      route = routes();
      return;
    }
    const k = c.cles[0];
    if (etat.get(k) !== "services") { etat.set(k, "services"); occIlot.set(k, new Uint8Array(ILOT.largeur * ILOT.hauteur)); }
    const occ = occIlot.get(k)!;
    const coin = trame.coin(trame.ij(k).i, trame.ij(k).j);
    for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) occ[(c.y - coin.y + dy) * ILOT.largeur + c.x - coin.x + dx] = 1;
    const l = petits.get(k) ?? [];
    l.push({ def: d, rot: c.rot, x: c.x, y: c.y });
    petits.set(k, l);
    route = routes(); // un îlot hors ville qui la rejoint apporte ses routes
  };

  /** Îlots candidats : ceux de la ville, et les îlots valides qui la bordent. */
  const candidatsIlots = (): number[] => {
    const s = new Set<number>(etat.keys());
    for (const c of etat.keys()) {
      const { i, j } = trame.ij(c);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = trame.cle(i + di, j + dj);
        if (i + di >= 0 && j + dj >= 0 && i + di < trame.nI && j + dj < trame.nJ && estValide.has(n)) s.add(n);
      }
    }
    return [...s].sort((a, b) => a - b);
  };

  /** Couverture courante d'un type, depuis ses copies posées. */
  const posesDe = (id: string): { x: number; y: number; w: number; h: number }[] => {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const g of groupes) if (g.def.id === id) out.push({ x: g.x, y: g.y, ...taille(g.def, g.rot) });
    for (const l of petits.values()) for (const p of l) if (p.def.id === id) out.push({ x: p.x, y: p.y, ...taille(p.def, p.rot) });
    return out;
  };
  const couvertureDe = (d: BuildingDef): Uint8Array => {
    const tout = new Uint8Array(N);
    for (const p of posesDe(d.id)) {
      const vu = atteintes(p.x, p.y, p.w, p.h, rangeOf(d));
      for (let c = 0; c < N; c++) if (vu[c]) tout[c] = 1;
    }
    return tout;
  };

  /**
   * Maisons qu'une pose déloge, en nombre et en positions. Un îlot d'habitation converti en
   * îlot de services n'en perd que la part que le service occupe ; un groupe perd tout ce
   * que ses îlots logeaient, moins ce qui retient autour du bâtiment.
   */
  const perteDe = (c: Candidat): { perte: number; exclues: Set<number> } => {
    const exclues = new Set<number>();
    let avant = 0;
    for (const k of c.cles) {
      const e = etat.get(k);
      const { i, j } = trame.ij(k);
      const coin = trame.coin(i, j);
      const occ = e === "services" ? occIlot.get(k)! : new Uint8Array(ILOT.largeur * ILOT.hauteur);
      const ms = e === "maisons"
        ? Array.from({ length: 8 }, (_, n) => ({ cle: k, x: coin.x + 3 * (n % 4), y: coin.y + 3 * Math.floor(n / 4) }))
        : e === "services" ? libres(occ, ILOT.largeur, ILOT.hauteur, coin.x, coin.y, k) : [];
      for (const m of ms) exclues.add(m.y * W + m.x);
      avant += ms.length;
    }
    let apres = 0;
    if (c.groupe) {
      const reste = maisonsDeGroupe(c.groupe.i, c.groupe.j, c.groupe.k, c.groupe.m, c.x, c.y, c.w, c.h, -1);
      apres = reste.length;
      for (const m of reste) exclues.delete(m.y * W + m.x); // restées en place : toujours là
    } else {
      const k = c.cles[0];
      const { i, j } = trame.ij(k);
      const coin = trame.coin(i, j);
      const occ = etat.get(k) === "services" ? occIlot.get(k)!.slice() : new Uint8Array(ILOT.largeur * ILOT.hauteur);
      for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) occ[(c.y - coin.y + dy) * ILOT.largeur + c.x - coin.x + dx] = 1;
      const reste = libres(occ, ILOT.largeur, ILOT.hauteur, coin.x, coin.y, k);
      apres = reste.length;
      for (const m of reste) exclues.delete(m.y * W + m.x); // restées en place : toujours là
    }
    // LE COÛT NE DÉPEND PAS DE L'ENDROIT. Un service occupe son emprise où qu'on le pose —
    // son équivalent en maisons — plus la place qu'il gâche autour (un Puits qui condamnerait
    // un îlot entier). Compter les maisons délogées brutes rendait la bordure gratuite : les
    // gros services y partaient, couvraient mal, et appelaient d'autres copies (mesuré :
    // 3 Forums et 3 Temples pour 300 maisons). Ne compter que le gâchis rendait toute copie
    // rentable dès une maison couverte (6 et 6). Le juste prix est la somme des deux.
    const equivalent = (c.w * c.h) / 9;
    return { perte: equivalent + Math.max(0, avant - apres - equivalent), exclues };
  };

  /** Pose les copies d'un type tant qu'elles couvrent plus de maisons qu'elles n'en délogent. */
  const couvrir = (d: BuildingDef) => {
    const grand = besoinEnIlots(d);
    const unique = !!d.unique;
    for (let copie = 0; copie < 400; copie++) {
      const lesMaisons = maisons();
      const cov = couvertureDe(d);
      const manquantes = lesMaisons.filter((m) => !couverte(m, cov));
      const deja = posesDe(d.id).length;
      if (unique && deja >= 1) return;
      if (!manquantes.length && deja >= 1) return;
      let best: { c: Candidat; score: number; d: number } | null = null;
      const essayer = (c: Candidat | null) => {
        if (!c) return;
        const vu = atteintes(c.x, c.y, c.w, c.h, rangeOf(d));
        const { perte, exclues } = perteDe(c);
        let gain = 0;
        for (const m of manquantes) if (!exclues.has(m.y * W + m.x) && couverte(m, vu)) gain++;
        // L'eau aussi a un prix : une source ne porte que 100 unités, et les sources sont
        // rares. Une Citerne (10) doit donc couvrir quelques maisons de plus pour se justifier.
        const score = gain - perte - waterDemandOf(d) * COUT_EAU;
        const dd = distIlot.get(c.cles[0]) ?? 0;
        if (!best || score > best.score || (score === best.score && dd < best.d)) best = { c, score, d: dd };
      };
      // Les petits services restent DANS la ville : autorisés en bordure, ils s'y posaient
      // de proche en proche et étiraient la ville le long d'une péninsule.
      for (const c of grand.k === 1 && grand.m === 1 ? [...etat.keys()].sort((a, b) => a - b) : candidatsIlots()) {
        if (grand.k === 1 && grand.m === 1) essayer(dansIlot(d, c));
        else { const { i, j } = trame.ij(c); essayer(enGroupe(d, i, j)); }
      }
      const b = best as { c: Candidat; score: number } | null;
      // La première copie se pose même à perte : un service absent laisse toute la ville
      // sous son palier. Les suivantes doivent rapporter.
      if (!b || (deja >= 1 && b.score <= 0)) return;
      appliquer(d, b.c);
    }
  };

  // ─── BOUCLE : SERVICES, PUIS MAISONS DÉLOGÉES RÉINSTALLÉES EN BORDURE ───────────────
  // Uniques d'abord (un exemplaire, n'importe où le couvre), puis les gros par portée
  // décroissante — ils fixent la trame des fusions —, puis les petits, besoins du palier
  // avant institutions.
  const ordreTypes = [...types].sort((a, b) => {
    const ga = besoinEnIlots(a.def), gb = besoinEnIlots(b.def);
    return Number(!!b.def.unique) - Number(!!a.def.unique)
      || gb.k * gb.m - ga.k * ga.m
      || Number(a.institution) - Number(b.institution)
      || rangeOf(b.def) - rangeOf(a.def)
      || a.def.id.localeCompare(b.def.id);
  });
  // La ville est DIMENSIONNÉE d'avance, services compris : sans cela chaque gros service
  // repoussait des maisons en bordure, la ville s'étalait, réclamait d'autres copies, et
  // s'étalait encore — mesuré, 5 Temples et 4 Forums pour 300 maisons.
  // Maisons commandées au palier le plus dense : ce sont elles qui exigent TOUS les services.
  const auSommet = besoins.filter((b) => b.tierGuid === sommet?.guid && b.role === "residence")
    .reduce((s, b) => s + b.nombre, 0);
  const servicesDuPalier = types.filter((t) => !t.institution).map((t) => t.def);
  /**
   * Maisons couvertes par TOUS les services du palier, en ne comptant que les copies actives —
   * celles que le réseau d'eau `w` raccorde. C'est le juge du routage : une citerne sèche coûte
   * son voisinage, un Forum sec coûte le palier de tout ce qu'il était seul à desservir.
   */
  const qualifieesAvec = (
    w: ReturnType<typeof planWater>, bats: PlacedBuilding[], lesMaisons: Maison[],
  ): number => {
    const secs = new Set(w.consumers.filter((c) => !c.connected).map((c) => c.uid));
    const couvs: Uint8Array[] = [];
    for (const d of servicesDuPalier) {
      const tout = new Uint8Array(N);
      for (const b of bats) {
        if (b.defId !== d.id || secs.has(b.uid)) continue;
        const { w: bw, h: bh } = taille(d, b.rotation as 0 | 90);
        const vu = atteintes(b.x, b.y, bw, bh, rangeOf(d));
        for (let c = 0; c < N; c++) if (vu[c]) tout[c] = 1;
      }
      couvs.push(tout);
    }
    return lesMaisons.filter((m) => couvs.every((cv) => couverte(m, cv))).length;
  };
  /**
   * Route l'eau dans les DEUX ordres de raccordement et garde celui qui laisse le plus de
   * maisons à leur palier. Aucun ordre ne domine : mesuré, « petits d'abord » sert entièrement
   * 300 Patriciens là où « volume d'abord » laisse trois citernes sèches, et l'inverse sur une
   * ville de 800 où ce sont les Forums qui restent à sec.
   */
  const routerEau = (bats: PlacedBuilding[], rt: RoadTile[], lesMaisons: Maison[]) => {
    const a = planWater(base, bats, rt, lookup, opts.heights, kontorRect, "petits");
    const b = planWater(base, bats, rt, lookup, opts.heights, kontorRect, "volume");
    const qa = qualifieesAvec(a, bats, lesMaisons), qb = qualifieesAvec(b, bats, lesMaisons);
    if (qa !== qb) return qa > qb ? a : b;
    const secs = (w: typeof a) => w.consumers.filter((c) => !c.connected).length;
    return secs(a) <= secs(b) ? a : b;
  };

  /** Construit les bâtiments de l'état courant et route l'eau, comme le fera le plan final. */
  const etatCourant = () => {
    const bats: PlacedBuilding[] = [];
    const origine = new Map<string, { groupe?: Groupe; cle?: number; petit?: PetitService }>();
    for (const g of groupes) {
      const b: PlacedBuilding = { uid: uid("ilot"), defId: g.def.id, x: g.x, y: g.y, rotation: g.rot, locked: false };
      bats.push(b); origine.set(b.uid, { groupe: g });
    }
    for (const k of [...petits.keys()].sort((a, b) => a - b)) {
      for (const p of petits.get(k)!) {
        const b: PlacedBuilding = { uid: uid("ilot"), defId: p.def.id, x: p.x, y: p.y, rotation: p.rot, locked: false };
        bats.push(b); origine.set(b.uid, { cle: k, petit: p });
      }
    }
    const maisonsB = maisons().map((m) => ({ m, b: { uid: uid("ilot"), defId: sommet?.residenceId ?? "", x: m.x, y: m.y, rotation: 0 as const, locked: false } }));
    const rt: RoadTile[] = [];
    for (let c = 0; c < N; c++) if (route[c]) rt.push({ x: c % W, y: (c / W) | 0 });
    const eau = routerEau([...bats, ...maisonsB.map((x) => x.b)], rt, maisonsB.map((x) => x.m));
    return { bats, origine, maisonsB, rt, eau };
  };
  /** Retire une pose et, sauf avis contraire, interdit sa position au type. */
  const retirer = (o: { groupe?: Groupe; cle?: number; petit?: PetitService }, interdire = true) => {
    if (o.groupe) {
      const g = o.groupe;
      groupes.splice(groupes.indexOf(g), 1);
      for (let dj = 0; dj < g.m; dj++) for (let di = 0; di < g.k; di++) {
        const k = trame.cle(g.i + di, g.j + dj);
        etat.set(k, "maisons");
      }
      if (interdire) {
        const set = interdits.get(g.def.id) ?? new Set<number>();
        set.add(g.y * W + g.x); interdits.set(g.def.id, set);
      }
    } else if (o.petit && o.cle !== undefined) {
      const l = petits.get(o.cle)!;
      l.splice(l.indexOf(o.petit), 1);
      const occ = occIlot.get(o.cle)!;
      const coin = trame.coin(trame.ij(o.cle).i, trame.ij(o.cle).j);
      const t = taille(o.petit.def, o.petit.rot);
      for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) occ[(o.petit.y - coin.y + dy) * ILOT.largeur + o.petit.x - coin.x + dx] = 0;
      if (interdire) {
        const set = interdits.get(o.petit.def.id) ?? new Set<number>();
        set.add(o.petit.y * W + o.petit.x); interdits.set(o.petit.def.id, set);
      }
    }
    route = routes();
  };

  /**
   * ═══ LES COPIES DEVENUES INUTILES SORTENT ═══════════════════════════════════════════
   *
   * `couvrir` pose une copie quand elle rapporte AU MOMENT de la pose. Mais la ville bouge
   * ensuite : des maisons délogées se réinstallent en bordure, d'autres copies arrivent, et la
   * première finit par ne plus couvrir que des maisons déjà vues par ses voisines. Mesuré sur
   * roman_island_small_06 (300 Patriciens, routes pavées) : chaque maison couverte 2,1 à 2,8
   * fois par le même petit service, 24 copies retirables sans qu'aucune maison ne perde rien.
   *
   * Retrait glouton, la copie la moins utile d'abord, tant que TOUTES ses maisons restent
   * couvertes par une autre copie du type ; chaque type garde au moins une copie. Pas
   * d'interdiction de position : la copie n'était pas fautive, seulement de trop. Sa place
   * revient aux maisons — un îlot de services recalcule les siennes depuis son occupation.
   */
  const elaguerDoublons = (): number => {
    let retires = 0;
    for (const t of ordreTypes) {
      const lesMaisons = maisons();
      const copies: { o: { groupe?: Groupe; cle?: number; petit?: PetitService }; x: number; y: number; rot: 0 | 90 }[] = [];
      for (const g of groupes) if (g.def.id === t.def.id) copies.push({ o: { groupe: g }, x: g.x, y: g.y, rot: g.rot });
      for (const [cle, l] of petits) {
        for (const p of l) if (p.def.id === t.def.id) copies.push({ o: { cle, petit: p }, x: p.x, y: p.y, rot: p.rot });
      }
      const vues = copies.map((c) => maisonsVues(t.def, c.x, c.y, c.rot, lesMaisons));
      for (const k of copiesEnTrop(vues, lesMaisons.length)) { retirer(copies[k].o, false); retires++; }
    }
    return retires;
  };

  let tours = 0, toursEau = 0;
  if (sommet && totalMaisons > 0) {
    ajouterIlotsDeMaisons(besoinIlots + ilotsServices);
    for (; tours < 8 + TOURS_EAU; tours++) {
      for (const t of ordreTypes) couvrir(t.def);
      // L'EAU DANS LA BOUCLE. Un consommateur sec ne rend rien en jeu ; le découvrir après coup
      // laissait des quartiers entiers sous leur palier. On le retire, on interdit sa position,
      // et la couverture se repose ailleurs — quelques tours suffisent.
      if (toursEau < TOURS_EAU) {
        const { origine, eau } = etatCourant();
        const secs = eau.consumers.filter((c) => !c.connected);
        if (secs.length) {
          for (const a of eau.aqueducts) couloirsPris.add(a.y * W + a.x);
          for (const c of secs) { const o = origine.get(c.uid); if (o) retirer(o); }
          toursEau++;
          continue;
        }
      }
      // La ville grandit s'il manque des maisons, OU des maisons couvertes par tous les
      // services du palier — une maison en bordure qu'aucune copie ne rentabilise ne compte pas.
      const ms = maisons();
      const couvs = servicesDuPalier.map((d) => couvertureDe(d));
      const qualifiees = ms.filter((m) => couvs.every((cv) => couverte(m, cv))).length;
      const manque = Math.max(totalMaisons - ms.length, auSommet - qualifiees);
      if (manque <= 0) break;
      if (!ajouterIlotsDeMaisons(Math.ceil(manque / ILOT.maisons))) break; // plus aucun îlot valide
    }
    // Une seule passe, puis une couverture de rattrapage pour les maisons rendues par
    // l'élagage : elles naissent contre des copies restantes, rarement hors de portée.
    if (elaguerDoublons()) for (const t of ordreTypes) couvrir(t.def);
  }

  // ─── BÂTIMENTS ──────────────────────────────────────────────────────────────────────
  const buildings: PlacedBuilding[] = [];
  const services: { b: PlacedBuilding; def: BuildingDef }[] = [];
  const poserService = (def: BuildingDef, rot: 0 | 90, x: number, y: number) => {
    const b: PlacedBuilding = { uid: uid("ilot"), defId: def.id, x, y, rotation: rot, locked: false };
    buildings.push(b);
    services.push({ b, def });
  };
  for (const g of groupes) poserService(g.def, g.rot, g.x, g.y);
  for (const k of [...petits.keys()].sort((a, b) => a - b)) for (const p of petits.get(k)!) poserService(p.def, p.rot, p.x, p.y);
  const lesMaisons = maisons();
  const maisonB = lesMaisons.map((m) => ({ m, b: { uid: uid("ilot"), defId: sommet?.residenceId ?? "", x: m.x, y: m.y, rotation: 0 as const, locked: false } }));

  let roadTiles: RoadTile[] = [];
  for (let c = 0; c < N; c++) if (route[c]) roadTiles.push({ x: c % W, y: (c / W) | 0 });
  const insts = types.filter((t) => t.institution).map((t) => ({ id: t.def.id, fx: effectOf(t.def.id) }));

  // ─── PALIER DE CHAQUE MAISON, SELON LES SERVICES ACTIFS ─────────────────────────────
  type Option = { guid: string; defId: string; cap: number; attrs: Record<string, number> };
  const evaluer = (actifs: typeof services, quelles: typeof maisonB) => {
    const couvParType = new Map<string, Uint8Array>();
    for (const s of actifs) {
      let tout = couvParType.get(s.def.id);
      if (!tout) couvParType.set(s.def.id, (tout = new Uint8Array(N)));
      const { w, h } = taille(s.def, s.b.rotation as 0 | 90);
      const vu = atteintes(s.b.x, s.b.y, w, h, rangeOf(s.def));
      for (let c = 0; c < N; c++) if (vu[c]) tout[c] = 1;
    }
    return quelles.map(({ m, b }) => {
      const couvrants = [...couvParType].filter(([, cov]) => couverte(m, cov)).map(([id]) => id);
      // Une option par palier DEMANDÉ, jugée dans sa propre lignée : en Albion, les ouvriers
      // natifs ne sont pas dans la lignée romanisée des Nobles.
      const options = paliersDemandes.map((t): Option | null => {
        const { chaine: ch, ev } = evalDe(t.guid);
        let masque = 0;
        for (const id of couvrants) {
          const bit = ev.bitOf.get(id);
          if (bit !== undefined) masque |= 1 << bit;
        }
        const r = ev.evaluateAt(ch.length - 1, masque);
        if (!r || !t.residenceId) return null;
        const attrs: Record<string, number> = { ...ev.attrsAt(ch.length - 1, masque) };
        for (const e of insts) {
          const cov = couvParType.get(e.id);
          if (!e.fx || !cov || !couverte(m, cov)) continue;
          if ((e.fx.minTier ?? 0) && (t.rank ?? 0) < (e.fx.minTier ?? 0)) continue;
          for (const [a, v] of Object.entries(e.fx.attrs)) attrs[a] = (attrs[a] ?? 0) + v;
        }
        return { guid: t.guid, defId: t.residenceId, cap: r.cap, attrs };
      }).filter((o): o is Option => !!o);
      return { uid: b.uid, opts: options };
    });
  };

  // ─── ATTRIBUTION AUX LIGNES ─────────────────────────────────────────────────────────
  // Le palier le plus dense d'abord ; chaque ligne prend les parcelles où elle loge le plus,
  // puis les plus proches du centre. Les parcelles restantes sont l'excédent, retiré.
  const rang = new Map(maisonB.map(({ m, b }) => [b.uid, distIlot.get(m.cle) ?? 0]));
  const ordreBesoins = [...besoins].sort((a, b) =>
    (tierByGuid(b.tierGuid)?.capacityDefault ?? 0) - (tierByGuid(a.tierGuid)?.capacityDefault ?? 0) || a.role.localeCompare(b.role));
  const attribuerLignes = (plots: ReturnType<typeof evaluer>) => {
    const attribution = new Map<string, Option>();
    const courts: string[] = [];
    for (const bz of ordreBesoins) {
      const cands = plots
        .filter((p) => !attribution.has(p.uid))
        .map((p) => ({ p, o: p.opts.find((o) => o.guid === bz.tierGuid) }))
        .filter((x): x is { p: (typeof plots)[number]; o: Option } => !!x.o)
        .sort((a, b) => b.o.cap - a.o.cap || rang.get(a.p.uid)! - rang.get(b.p.uid)!);
      const pris = cands.slice(0, bz.nombre);
      for (const x of pris) attribution.set(x.p.uid, x.o);
      if (pris.length < bz.nombre) courts.push(`${bz.nombre - pris.length} ${bz.nom} non logée(s) à leur palier sur ${bz.nombre}`);
    }
    return { attribution, courts };
  };
  let { attribution, courts } = attribuerLignes(evaluer(services, maisonB));

  // ÉLAGAGE FINAL, sur les seules maisons gardées. L'excédent d'îlots part juste au-dessus, et
  // avec lui la raison d'être de certaines copies. Aucune maison gardée ne perd un type qui la
  // couvrait : son palier, donc l'attribution, ne bouge pas.
  {
    const gardeesM = maisonB.filter((x) => attribution.has(x.b.uid)).map((x) => x.m);
    const enTrop = new Set<string>();
    for (const t of ordreTypes) {
      const copies = services.filter((s) => s.def.id === t.def.id);
      const vues = copies.map((s) => maisonsVues(s.def, s.b.x, s.b.y, s.b.rotation as 0 | 90, gardeesM));
      for (const k of copiesEnTrop(vues, gardeesM.length)) enTrop.add(copies[k].b.uid);
    }
    if (enTrop.size) {
      const garder = services.filter((s) => !enTrop.has(s.b.uid));
      services.length = 0; services.push(...garder);
      const restants = buildings.filter((b) => !enTrop.has(b.uid));
      buildings.length = 0; buildings.push(...restants);
    }
  }

  // ─── EAU, SUR LES SEULES MAISONS GARDÉES ────────────────────────────────────────────
  // Router l'eau AVANT de retirer l'excédent la faisait passer au travers de maisons qui
  // n'existeront pas, et déclarait sèches des citernes qui se raccordent très bien une fois
  // le plan allégé. Les conduites passent par les allées et hors de la ville ; elles croisent
  // les routes à angle droit. Un consommateur resté sec ne rend rien en jeu : il sort du plan,
  // et les maisons qu'il était seul à desservir sont réévaluées.
  //
  // Le routeur n'est pas monotone : plus de place libre peut lui faire choisir un autre chemin
  // pour un gros consommateur, qui coupe alors l'allée d'une citerne. Mais des conduites tracées
  // AVEC toutes les maisons restent valides une fois l'excédent retiré — elles n'occupent que des
  // cases libres dans les deux cas. On garde donc la meilleure des deux évaluations.
  const gardees = maisonB.filter((x) => attribution.has(x.b.uid));
  const batsServices = services.map((s) => s.b);
  const avecGardees = routerEau(
    [...batsServices, ...gardees.map((x) => ({ ...x.b, defId: attribution.get(x.b.uid)!.defId }))],
    roadTiles, gardees.map((x) => x.m),
  );
  const avecToutes = routerEau([...batsServices, ...maisonB.map((x) => x.b)], roadTiles, gardees.map((x) => x.m));
  const juge = (w: typeof avecToutes) => qualifieesAvec(w, batsServices, gardees.map((x) => x.m));
  const water = juge(avecToutes) >= juge(avecGardees) ? avecToutes : avecGardees;
  const secs = new Set(water.consumers.filter((c) => !c.connected).map((c) => c.uid));
  if (secs.size) {
    const noms = new Map<string, number>();
    for (const s of services) if (secs.has(s.b.uid)) noms.set(s.def.name, (noms.get(s.def.name) ?? 0) + 1);
    manques.push(`${SANS_EAU}, donc inactifs : ${[...noms].map(([n, k]) => `${n} ×${k}`).join(", ")}`);
    ({ attribution, courts } = attribuerLignes(evaluer(services.filter((s) => !secs.has(s.b.uid)), gardees)));
  }
  manques.push(...courts);
  for (const { b } of maisonB) {
    const o = attribution.get(b.uid);
    if (o) buildings.push({ ...b, defId: o.defId });
  }
  const restants = buildings.filter((b) => !secs.has(b.uid));
  buildings.length = 0;
  buildings.push(...restants, ...water.sources);

  // ─── COMPTOIR, ROUTES ───────────────────────────────────────────────────────────────
  if (kontor && kontorRect) {
    // LA ROUTE DU PORT. La ville est centrée sur la partie la plus pleine de l'île, pas
    // forcément contre le comptoir : `connectKontor` plafonne son raccord à 60 cases et le
    // laissait isolé sur la carte continentale — toute la ville inactive en jeu. On trace
    // d'abord un chemin par la terre LIBRE, sans limite de longueur et sans rien raser ; le
    // raccord historique, qui peut démolir des maisons, ne sert qu'en dernier recours.
    const chemin = routeVersReseau(base, kontorRect, buildings, roadTiles, water.aqueducts, lookup);
    if (chemin) {
      const vu = new Set(roadTiles.map((r) => r.y * W + r.x));
      roadTiles = [...roadTiles, ...chemin.filter((r) => !vu.has(r.y * W + r.x))];
    }
    const kp = connectKontor(grid, kontor, buildings, roadTiles, lookup, (id) => tierDeResidence.has(id));
    if (kp.removed.length) {
      const partis = new Set(kp.removed);
      const garder = buildings.filter((b) => !partis.has(b.uid));
      buildings.length = 0;
      buildings.push(...garder);
      for (const u of partis) attribution.delete(u);
      avertissements.push(`${partis.size} maison(s) rasée(s) pour raccorder le comptoir`);
    }
    buildings.push(kp.building);
    const vu = new Set(roadTiles.map((r) => r.y * W + r.x));
    roadTiles = [...roadTiles, ...kp.roads.filter((r) => !vu.has(r.y * W + r.x))];
    if (!kp.connected) manques.push("Comptoir non raccordé au réseau routier — à relier à la main");
  }
  // SOURCES D'AQUEDUC : elles ont besoin d'une route comme tout bâtiment de production (cf.
  // l'invariant d'accès au comptoir), et elles sont posées sur la montagne, hors de la ville.
  // Le chemin passe par le relief — la grille d'origine, où la montagne est praticable.
  for (const src of water.sources) {
    const d = lookup(src.defId);
    if (!d) continue;
    const fp = footprintSize(d, src.rotation);
    // vers le réseau RELIÉ au comptoir : un bout de route isolé au pied de la montagne passait
    // pour un raccord, et la source restait sans accès (roman_island_medium_01, patch 200)
    const { set: racine, hasRoot } = rootedRoadSet({ grid, buildings, roads: roadTiles, fields: [] }, lookup);
    const cibles = hasRoot ? roadTiles.filter((r) => racine.has(`${r.x},${r.y}`)) : roadTiles;
    const chemin = routeVersReseau(grid, { x: src.x, y: src.y, ...fp }, buildings, cibles, water.aqueducts, lookup);
    if (chemin === null) { manques.push(`Source d'aqueduc en (${src.x}, ${src.y}) sans route possible jusqu'au réseau`); continue; }
    const vu = new Set(roadTiles.map((r) => r.y * W + r.x));
    roadTiles = [...roadTiles, ...chemin.filter((r) => !vu.has(r.y * W + r.x))];
  }
  roadTiles = pruneDeadEnds(grid, buildings, roadTiles, lookup).roads;
  const layout: Layout = { grid, buildings, roads: roadTiles, fields: [], aqueducts: water.aqueducts };
  const { set: racine, hasRoot } = rootedRoadSet(layout, lookup);
  if (hasRoot) {
    const coupees = buildings.filter((b) => attribution.has(b.uid) && !roadConnected(layout, lookup, b, racine));
    if (coupees.length) manques.push(`${coupees.length} maison(s) sans accès au comptoir`);
  }

  // ─── COMPTES ────────────────────────────────────────────────────────────────────────
  const maisonsParPalier: Record<string, number> = {};
  let habitants = 0;
  const somme: Record<string, number> = {};
  for (const k of VITAL_ATTRS) somme[k] = 0;
  for (const b of buildings) {
    const o = attribution.get(b.uid);
    if (!o) continue;
    maisonsParPalier[o.guid] = (maisonsParPalier[o.guid] ?? 0) + 1;
    habitants += o.cap;
    for (const k of VITAL_ATTRS) somme[k] += o.attrs[k] ?? 0;
  }
  const nMaisons = Object.values(maisonsParPalier).reduce((a, b) => a + b, 0);
  const rangCite = cityStatusAttrs(habitants, sommet?.region ?? commande.region);
  const bilan: Record<string, number> = {};
  for (const k of VITAL_ATTRS) bilan[k] = Math.round((somme[k] + nMaisons * (rangCite[k] ?? 0)) * 10) / 10;

  const poses = new Map<string, number>();
  for (const b of buildings) poses.set(b.defId, (poses.get(b.defId) ?? 0) + 1);
  const lignes: LignePosee[] = nom.lignes
    .filter((l) => l.role !== "production")
    .map((l) => {
      if (l.role === "residence" || l.role === "ouvriers") {
        const g = tierDeResidence.get(l.defId)!.guid;
        const avant = nom.lignes.filter((x) => x !== l && x.defId === l.defId && x.role === "residence" && l.role === "ouvriers")
          .reduce((s, x) => s + x.nombre, 0);
        return { defId: l.defId, nom: l.nom, role: l.role, demande: l.nombre, pose: Math.max(0, Math.min(l.nombre, (maisonsParPalier[g] ?? 0) - avant)) };
      }
      return { defId: l.defId, nom: l.nom, role: l.role, demande: l.nombre, pose: poses.get(l.defId) ?? 0 };
    });
  for (const l of lignes) {
    if ((l.role === "service" || l.role === "institution") && l.pose === 0) manques.push(`${l.nom} : aucun exemplaire posé`);
  }

  // zone : les îlots retenus et leurs routes
  const zone = new Array<boolean>(N).fill(false);
  for (const c of etat.keys()) {
    const { i, j } = trame.ij(c);
    const { x, y } = trame.coin(i, j);
    for (let dy = -1; dy <= ILOT.hauteur; dy++) for (let dx = -1; dx <= ILOT.largeur; dx++) {
      if (trame.terre(x + dx, y + dy)) zone[(y + dy) * W + x + dx] = true;
    }
  }
  const zoneCases = zone.reduce((s, u) => s + (u ? 1 : 0), 0);
  const qualite = planQuality(layout, { ...grid, usable: zone }, lookup);
  if (!water.consumers.length && types.some((t) => needsWater(t.def))) avertissements.push("Aucun consommateur d'eau posé");

  return {
    layout,
    nomenclature: nom,
    lignes,
    habitants,
    maisonsParPalier,
    bilan,
    viable: verdictViable(bilan, nMaisons, 0),
    zone: { usable: zone, cases: zoneCases, passes: tours + 1 },
    ile: { base, centre: centreVille, comptoir: kontorRect },
    qualite,
    servi: manques.length === 0,
    manques,
    inactifs: services.filter((s) => secs.has(s.b.uid)).map((s) => s.b),
    avertissements,
  };
}
