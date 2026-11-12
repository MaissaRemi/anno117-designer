import { AIRE_LIBRE, type BuildingDef, type FieldTile, type GridShape, type PlacedBuilding, type RoadTile, type Rotation } from "../model/types";
import { terrainConvient, type DefLookup } from "../engine/rules";
import { footprintSize, partieEauPosee, routeSeule } from "../engine/geometry";
import { economy } from "../economy/economy";
import { uid } from "../model/factories";
import { planFromBasket, pickWarehouse, type BasketPlan } from "../prodlayout";
import { normalizeBasket, type BasketLine } from "../prodlayout/basket";
import { expandCopies, usefulArea } from "../prodlayout/pack";
import { EXIT_SIDES, type ExitSide } from "../prodlayout/exit";
import { direUnmet } from "../prodlayout/unmet";
import { planSlots } from "../optimizer/slotPlan";
import { estEntrepot } from "../optimizer/kontor";
import { distancesDeCroissance, type LignePosee } from "./disposition";

/**
 * ═══ LA PRODUCTION POSÉE SUR L'ÎLE ════════════════════════════════════════════════════
 *
 * Étape 6 de la refonte (`docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`).
 *
 * Les blueprints de `prodlayout` savaient poser un panier dans une boîte minimale, hors de
 * toute île, avec UN entrepôt — un panier de quinze bâtiments était refusé (« aucun entrepôt
 * sous 30 »). Ici :
 *
 *  - le panier est découpé en LOTS qui partagent des biens (une chaîne reste ensemble) ; un lot
 *    refusé faute de portée d'entrepôt est coupé en deux, récursivement — chaque moitié a son
 *    entrepôt ;
 *  - chaque blueprint est posé sur la terre LIBRE de l'île, au plus près de la ville, et relié à
 *    son réseau par une route ;
 *  - les exploitations de montagne, de rivière et de marais vont sur les VRAIS emplacements de
 *    l'île (`planSlots`, en commande explicite), avec leurs entrepôts ;
 *  - les bâtiments côtiers longent la côte, avec un entrepôt à portée de charrette si le
 *    comptoir ne suffit pas.
 */

const TERRAIN = new Set(["mountain", "river", "marsh"]);
/** Un lot refusé est coupé en deux demi-chaînes, jusqu'au bâtiment seul s'il le faut. */
const DECOUPE_MAX = 12;
/** Au-delà de ce nombre de bâtiments, un lot n'est pas essayé dans la forme de la terre libre :
 *  chaque essai coûte une pose complète, et un grand lot se coupe de toute façon. */
const FORME_MAX = 12;
/** Un lot d'un ou deux bâtiments se pose d'abord un à un : en blueprint, il paierait un
 *  entrepôt de plus pour lui seul (mesuré : medium_01 au maximum, 38,6 → 41,7 pains ; à 4, 40,1). */
const SEUL_MAX = 2;
/** Route neuve, en cases, qu'un bâtiment posé seul peut se faire tracer jusqu'au réseau. */
const ACCES_MAX = 6;
/** Places de côte essayées, de la plus proche à la plus loin, avant de dire un côtier sans place. */
const COTE_ESSAIS = 40;

export interface PlanProduction {
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  fields: FieldTile[];
  lignes: LignePosee[];
  blueprints: number;
  entrepots: number;
  manques: string[];
  avertissements: string[];
}

export interface VilleExistante {
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  aqueducts?: { x: number; y: number }[];
}

const estCotier = (d: BuildingDef) => d.placement === "water" || d.slotType === "coastal";

/**
 * Blueprint d'un lot hors de toute île (boîte `auto`) : il ne dépend que du lot, du bord de
 * sortie et de la région. Le calculer coûtait 90 % du temps d'une île de production (mesuré le
 * 2026-11-12 sur celtic_large_02 : 49 s sur 55), or les mêmes lots reviennent d'une moitié à
 * l'autre et d'une pose à l'autre du maximum : on les garde.
 */
const blueprints = new WeakMap<BuildingDef[], Map<string, ReturnType<typeof planFromBasket>>>();
function blueprintDe(catalog: BuildingDef[], lot: BasketLine[], side: ExitSide, region: string) {
  let memo = blueprints.get(catalog);
  if (!memo) blueprints.set(catalog, (memo = new Map()));
  const panier = normalizeBasket(lot);
  const cle = `${region}|${side}|${panier.lines.map((l) => `${l.defId}×${l.count}`).join(",")}`;
  let r = memo.get(cle);
  if (!r) {
    if (memo.size >= 2000) memo.clear();
    r = planFromBasket(catalog, panier, { exitSide: side, region });
    memo.set(cle, r);
  }
  return r;
}

/** Lots de production : les lignes qui échangent des biens restent ensemble. */
export function lotsDeProduction(lignes: BasketLine[]): BasketLine[][] {
  const ids = lignes.map((l) => l.defId);
  const parent = ids.map((_, i) => i);
  const racine = (i: number): number => (parent[i] === i ? i : (parent[i] = racine(parent[i])));
  const sorties = ids.map((id) => new Set((economy.buildingProd[id]?.outputs ?? []).map((o) => o.good)));
  const entrees = ids.map((id) => new Set((economy.buildingProd[id]?.inputs ?? []).map((o) => o.good)));
  for (let a = 0; a < ids.length; a++) for (let b = 0; b < ids.length; b++) {
    if (a === b) continue;
    if ([...sorties[a]].some((g) => entrees[b].has(g))) parent[racine(a)] = racine(b);
  }
  const groupes = new Map<number, BasketLine[]>();
  lignes.forEach((l, i) => {
    const r = racine(i);
    const g = groupes.get(r) ?? [];
    g.push(l);
    groupes.set(r, g);
  });
  return [...groupes.values()].sort((a, b) => a[0].defId.localeCompare(b[0].defId));
}

/**
 * Coupe un lot en deux DEMI-CHAÎNES : la moitié de chaque ligne de part et d'autre. Couper entre
 * les lignes mettait les fermes d'un côté et les ateliers de l'autre : une moitié posée sans
 * l'autre ne produisait rien (mesuré le 2026-11-11, `roman_island_medium_01` : 34 % de la terre
 * en champs pour 3 Pain par minute sur 40). Les lignes à un seul exemplaire alternent.
 */
export function couper(lot: BasketLine[]): [BasketLine[], BasketLine[]] | null {
  const total = lot.reduce((s, l) => s + l.count, 0);
  if (total < 2) return null;
  const a: BasketLine[] = [], b: BasketLine[] = [];
  let impairVersA = true;
  for (const l of lot) {
    const grand = Math.ceil(l.count / 2), petit = l.count - grand;
    const [na, nb] = grand === petit || impairVersA ? [grand, petit] : [petit, grand];
    if (grand !== petit) impairVersA = !impairVersA;
    if (na) a.push({ defId: l.defId, count: na });
    if (nb) b.push({ defId: l.defId, count: nb });
  }
  return a.length && b.length ? [a, b] : null;
}

/**
 * Pose la production d'une commande sur l'île, autour d'une ville déjà posée. `base` est le
 * masque constructible des moteurs (comptoir réservé, montagnes bloquées, masse principale).
 */
export function disposerProduction(
  grid: GridShape,
  base: GridShape,
  ville: VilleExistante,
  lignes: BasketLine[],
  catalog: BuildingDef[],
  lookup: DefLookup,
  opts: { region: string; centre: { x: number; y: number } },
): PlanProduction {
  const W = grid.w, H = grid.h, N = W * H;
  const out: PlanProduction = {
    buildings: [], roads: [], fields: [], lignes: [], blueprints: 0, entrepots: 0, manques: [], avertissements: [],
  };
  const nom = (id: string) => lookup(id)?.name ?? id;
  const panier = normalizeBasket(lignes);
  if (!panier.lines.length) return out;

  // ─── OCCUPATION ─────────────────────────────────────────────────────────────────────
  const occ = new Uint8Array(N);
  const route = new Uint8Array(N);
  const marquer = (b: PlacedBuilding) => {
    const d = lookup(b.defId);
    if (!d) return;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1;
    }
  };
  for (const b of ville.buildings) marquer(b);
  for (const r of ville.roads) { occ[r.y * W + r.x] = 1; route[r.y * W + r.x] = 1; }
  for (const a of ville.aqueducts ?? []) occ[a.y * W + a.x] = 1;
  const libre = (c: number) => base.usable[c] && !occ[c];
  /** Une route y passe : une case libre, ou une case réservée à la route (cf. routeSeule). */
  const franchissable = (c: number) => libre(c) || (routeSeule(base, c) && !occ[c]);

  // distance le long de la terre depuis la ville : c'est elle qui range les emplacements
  const graines: number[] = [];
  for (let c = 0; c < N; c++) if (route[c]) graines.push(c);
  if (!graines.length) graines.push(Math.round(opts.centre.y) * W + Math.round(opts.centre.x));
  const terre: GridShape = { ...base, usable: base.usable.map((u, c) => u || route[c] === 1 || routeSeule(base, c)) };
  const dist = distancesDeCroissance(terre, graines);

  /** Route la plus courte d'une case jusqu'au réseau, par des cases libres ; null sinon. */
  const relier = (depart: number): RoadTile[] | null => {
    if (route[depart]) return [];
    if (!libre(depart)) return null;
    const prev = new Int32Array(N).fill(-2);
    prev[depart] = -1;
    let front = [depart];
    while (front.length) {
      const next: number[] = [];
      for (const c of front) {
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
          if (n < 0 || prev[n] !== -2) continue;
          if (route[n]) {
            const chemin: RoadTile[] = [];
            for (let cur = c; cur >= 0; cur = prev[cur]) chemin.push({ x: cur % W, y: (cur / W) | 0 });
            return chemin;
          }
          if (!franchissable(n)) continue;
          prev[n] = c;
          next.push(n);
        }
      }
      front = next;
    }
    return null;
  };
  const poserRoutes = (rs: RoadTile[]) => {
    for (const r of rs) {
      const c = r.y * W + r.x;
      if (route[c]) continue;
      route[c] = 1; occ[c] = 1;
      out.roads.push(r);
      echecsSeul.clear(); // une route nouvelle ouvre de nouvelles places à un bâtiment seul
    }
  };

  const terrain = panier.lines.filter((l) => TERRAIN.has(lookup(l.defId)?.slotType ?? ""));
  const cotiers = panier.lines.filter((l) => { const d = lookup(l.defId); return !!d && estCotier(d) && !TERRAIN.has(d.slotType ?? ""); });
  const reste = panier.lines.filter((l) => !terrain.includes(l) && !cotiers.includes(l));
  const poses = new Map<string, number>();
  const compter = (id: string, n = 1) => poses.set(id, (poses.get(id) ?? 0) + n);
  /** Bâtiments restés sans place, cumulés : UN message à la fin, pas un par lot refusé. */
  const sansPlace = new Map<string, number>();
  /** Bâtiments dont le manque est déjà dit, par identifiant — un nom peut en contenir un autre. */
  const signales = new Set<string>();

  // ─── BLUEPRINTS ─────────────────────────────────────────────────────────────────────
  // Image intégrale des cases NON libres : tester qu'une boîte est entièrement libre coûte O(1).
  let integrale = new Int32Array((W + 1) * (H + 1));
  const reintegrer = () => {
    integrale = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let ligne = 0;
      for (let x = 0; x < W; x++) {
        ligne += libre(y * W + x) ? 0 : 1;
        integrale[(y + 1) * (W + 1) + x + 1] = integrale[y * (W + 1) + x + 1] + ligne;
      }
    }
  };
  const boiteLibre = (x: number, y: number, w: number, h: number) =>
    x >= 0 && y >= 0 && x + w <= W && y + h <= H
    && integrale[(y + h) * (W + 1) + x + w] - integrale[y * (W + 1) + x + w]
      - integrale[(y + h) * (W + 1) + x] + integrale[y * (W + 1) + x] === 0;

  const versDehors = (side: string): [number, number] =>
    side === "nord" ? [0, -1] : side === "sud" ? [0, 1] : side === "ouest" ? [-1, 0] : [1, 0];
  /** Installe un blueprint, son coin en (x, y), si sa sortie rejoint le réseau. */
  const installer = (p: BasketPlan, x: number, y: number): boolean => {
    const [dx, dy] = versDehors(p.exit.side);
    const sx = x + p.exit.x + dx, sy = y + p.exit.y + dy;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return false;
    const s = sy * W + sx;
    if (dist[s] < 0 || !(route[s] || franchissable(s))) return false;
    const chemin = relier(s);
    if (chemin === null) return false;
    // les uid du placeur (b0, b1…) se répètent d'un blueprint à l'autre : sans ce renvoi, les
    // champs pointaient un bâtiment absent du plan et l'éditeur voyait des fermes sans champ
    const uids = new Map<string, string>();
    for (const b of p.layout.buildings) {
      const nb: PlacedBuilding = { ...b, uid: uid("prod"), x: b.x + x, y: b.y + y };
      uids.set(b.uid, nb.uid);
      out.buildings.push(nb);
      marquer(nb);
      if (estEntrepot(lookup(b.defId))) out.entrepots++;
      else compter(b.defId);
    }
    // Seules les cases PRISES sont réservées — emprises, champs, aires libres des bûcherons et
    // des ruchers (elles sortent du placeur comme des cases de champ), routes. Réserver toute la
    // boîte gardait hors d'atteinte les cases qu'elle laissait libres.
    for (const f of p.layout.fields) {
      out.fields.push({ ...f, ownerUid: uids.get(f.ownerUid) ?? f.ownerUid, x: f.x + x, y: f.y + y });
      occ[(f.y + y) * W + f.x + x] = 1;
    }
    poserRoutes(p.layout.roads.map((r) => ({ x: r.x + x, y: r.y + y })));
    if (!route[s]) poserRoutes([{ x: sx, y: sy }]);
    poserRoutes(chemin);
    out.blueprints++;
    return true;
  };

  /** Pose un blueprint : la boîte libre la plus proche de la ville, sortie reliée au réseau. */
  const poserBlueprint = (variantes: BasketPlan[]): boolean => {
    reintegrer();
    const cands: { p: BasketPlan; x: number; y: number; d: number }[] = [];
    for (const p of variantes) {
      const { w, h } = p.box;
      const [dx, dy] = versDehors(p.exit.side);
      for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) {
        if (!boiteLibre(x, y, w, h)) continue;
        const sx = x + p.exit.x + dx, sy = y + p.exit.y + dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const d = dist[sy * W + sx];
        if (d < 0) continue;
        cands.push({ p, x, y, d });
      }
    }
    cands.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    return cands.slice(0, 40).some((c) => installer(c.p, c.x, c.y));
  };

  /**
   * ═══ DANS LA FORME DE LA TERRE LIBRE ═══════════════════════════════════════════════
   *
   * Un rectangle entièrement libre devient rare dès que l'île se remplit : mesuré le
   * 2026-11-11, hauteurs comprises, `roman_island_medium_01` refusait des fermes avec 38 % de
   * terre vide, `roman_island_large_03` avec 60 %. Le placeur sait pourtant poser dans une
   * forme quelconque (`BoxSpec` `forme`) : on lui donne ici une fenêtre de l'île, un peu plus
   * grande que la boîte qu'il aurait voulue, avec pour masque sa terre encore libre. Les champs
   * épousent la forme ; rien ne déborde sur ce qui est déjà pris.
   */
  const poserDansLaForme = (lot: BasketLine[], gabarit: { w: number; h: number }): boolean => {
    if (lot.reduce((n, l) => n + l.count, 0) > FORME_MAX) return false;
    reintegrer();
    const prises = (x: number, y: number, w: number, h: number) =>
      integrale[(y + h) * (W + 1) + x + w] - integrale[y * (W + 1) + x + w]
      - integrale[(y + h) * (W + 1) + x] + integrale[y * (W + 1) + x];
    const panierDuLot = normalizeBasket(lot);
    for (const k of [1.25, 1.6]) {
      const w = Math.min(W, Math.ceil(gabarit.w * k)), h = Math.min(H, Math.ceil(gabarit.h * k));
      const pas = Math.max(2, Math.min(w, h) >> 2);
      const fenetres: { x: number; y: number; d: number }[] = [];
      for (let y = 0; y + h <= H; y += pas) for (let x = 0; x + w <= W; x += pas) {
        // assez de terre libre pour la boîte voulue, et le centre libre : l'entrepôt s'y pose
        if (w * h - prises(x, y, w, h) < gabarit.w * gabarit.h) continue;
        const c = (y + (h >> 1)) * W + x + (w >> 1);
        if (!libre(c) || dist[c] < 0) continue;
        fenetres.push({ x, y, d: dist[c] });
      }
      fenetres.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
      for (const f of fenetres.slice(0, 6)) {
        const usable: boolean[] = new Array(w * h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) usable[j * w + i] = !!libre((f.y + j) * W + f.x + i);
        for (const side of EXIT_SIDES) {
          const r = planFromBasket(catalog, panierDuLot, { exitSide: side, region: opts.region, box: { mode: "forme", w, h, usable } });
          if (!("refuse" in r) && installer(r, f.x + r.origine.x, f.y + r.origine.y)) return true;
        }
      }
    }
    return false;
  };

  /**
   * ═══ UN À UN, SUR LES ENTREPÔTS DÉJÀ POSÉS ══════════════════════════════════════════
   *
   * Mesuré le 2026-11-12 au débit maximal, hauteurs comprises : 25 à 33 % de la terre reste vide,
   * presque toute en poches reliées à la route et assez grandes pour un atelier (medium_01 :
   * 3 313 cases vides sur 3 781), mais trop petites ou trop biscornues pour un lot, qui demande
   * une boîte ET son propre entrepôt. Un bâtiment seul n'en demande pas : il lui suffit d'une
   * route à portée de charrette d'un entrepôt déjà posé (comme les demi-chaînes, qui s'échangent
   * déjà leurs biens d'un entrepôt à l'autre). On le pose contre une route existante, ou au bout
   * d'une route neuve de `ACCES_MAX` cases au plus, ses champs (ou son aire libre) d'un seul
   * tenant contre lui, comme `validateFields` les exige.
   */
  const echecsSeul = new Set<string>();
  const distanceEntrepot = (): Int32Array => {
    const d = new Int32Array(N).fill(-1);
    let front: number[] = [];
    for (const b of [...ville.buildings, ...out.buildings]) {
      const bd = lookup(b.defId);
      if (!bd?.roadRoot) continue;
      for (const [x, y] of perimetre(b.x, b.y, ...dims(bd, b.rotation), W, H)) {
        const c = y * W + x;
        if (route[c] && d[c] < 0) { d[c] = 0; front.push(c); }
      }
    }
    for (let k = 1; front.length; k++) {
      const next: number[] = [];
      for (const c of front) {
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
          if (n >= 0 && route[n] && d[n] < 0) { d[n] = k; next.push(n); }
        }
      }
      front = next;
    }
    return d;
  };
  /** `besoin` cases libres d'un seul tenant contre l'emprise, à `rayon` (L∞) au plus ; null sinon. */
  const terreContre = (x: number, y: number, w: number, h: number, rayon: number, besoin: number): number[] | null => {
    const dedans = (cx: number, cy: number) => cx >= x && cx < x + w && cy >= y && cy < y + h;
    const pres = (cx: number, cy: number) => Math.max(x - cx, 0, cx - (x + w - 1), y - cy, 0, cy - (y + h - 1)) <= rayon;
    // une graine à la fois : le champ ne se relie pas à travers le bâtiment (cf. `fillFields`)
    const vu = new Set<number>();
    for (const [px, py] of perimetre(x, y, w, h, W, H)) {
      const g = py * W + px;
      if (!libre(g) || vu.has(g)) continue;
      vu.add(g);
      const pris = [g];
      for (let k = 0; k < pris.length && pris.length < besoin; k++) {
        const c = pris[k], cx = c % W, cy = (c / W) | 0;
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || dedans(nx, ny) || !pres(nx, ny)) continue;
          const n = ny * W + nx;
          if (!vu.has(n) && libre(n)) { vu.add(n); pris.push(n); }
        }
      }
      if (pris.length >= besoin) return pris.slice(0, besoin);
    }
    return null;
  };
  const poserSeul = (d: BuildingDef): boolean => {
    if (echecsSeul.has(d.id)) return false;
    reintegrer();
    const de = distanceEntrepot();
    const portee = d.transporterRange ?? 30;
    const besoin = d.field?.tiles ?? d.freeArea?.area ?? 0;
    const rayon = d.field ? d.radius?.range ?? 22 : d.freeArea?.radius ?? 0;
    // accès par une courte route neuve : `pas` cases libres jusqu'à une route à portée
    const pas = new Int32Array(N).fill(-1), vers = new Int32Array(N).fill(-1), racine = new Int32Array(N).fill(-1);
    let front: number[] = [];
    for (let c = 0; c < N; c++) if (route[c] && de[c] >= 0 && de[c] <= portee) { pas[c] = 0; racine[c] = c; front.push(c); }
    for (let k = 1; k <= ACCES_MAX && front.length; k++) {
      const next: number[] = [];
      for (const c of front) {
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
          if (n < 0 || pas[n] >= 0 || !libre(n)) continue;
          // la portée se compte jusqu'au bâtiment, route neuve comprise
          if (de[racine[c]] + k > portee) continue;
          pas[n] = k; vers[n] = c; racine[n] = racine[c]; next.push(n);
        }
      }
      front = next;
    }
    const cands: { x: number; y: number; rot: Rotation; d: number; cout: number; porte: number }[] = [];
    for (const rot of (d.rotatable && d.size.w !== d.size.h ? [0, 90] : [0]) as Rotation[]) {
      const [w, h] = dims(d, rot);
      for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) {
        if (!boiteLibre(x, y, w, h) || dist[y * W + x] < 0) continue;
        let cout = -1, porte = -1;
        for (const [px, py] of perimetre(x, y, w, h, W, H)) {
          const p = py * W + px;
          if (pas[p] >= 0 && (cout < 0 || pas[p] < cout)) { cout = pas[p]; porte = p; }
        }
        if (cout >= 0) cands.push({ x, y, rot, d: dist[y * W + x], cout, porte });
      }
    }
    cands.sort((a, b) => a.cout - b.cout || a.d - b.d || a.y - b.y || a.x - b.x);
    for (const c of cands.slice(0, 300)) {
      const [w, h] = dims(d, c.rot);
      const acces: number[] = [];
      for (let p = c.porte; p >= 0 && !route[p]; p = vers[p]) acces.push(p);
      for (const p of acces) occ[p] = 1;
      const cases = besoin ? terreContre(c.x, c.y, w, h, rayon, besoin) : [];
      for (const p of acces) occ[p] = 0;
      if (!cases) continue;
      poserRoutes(acces.map((p) => ({ x: p % W, y: (p / W) | 0 })));
      const b: PlacedBuilding = { uid: uid("prod"), defId: d.id, x: c.x, y: c.y, rotation: c.rot, locked: false };
      out.buildings.push(b);
      marquer(b);
      compter(d.id);
      for (const k of cases) {
        out.fields.push({ x: k % W, y: (k / W) | 0, ownerUid: b.uid, fieldType: d.field?.fieldType ?? AIRE_LIBRE });
        occ[k] = 1;
      }
      return true;
    }
    echecsSeul.add(d.id);
    return false;
  };
  /** Pose un à un ce qu'un lot n'a pas pu poser en blueprint ; rend ce qui reste. */
  const poserUnAUn = (lot: BasketLine[]): BasketLine[] =>
    lot.map((l) => {
      const d = lookup(l.defId);
      let n = l.count;
      while (d && n > 0 && poserSeul(d)) n--;
      return { defId: l.defId, count: n };
    }).filter((l) => l.count > 0);

  const entrepot = pickWarehouse(catalog, opts.region);
  const surfaceUtile = (lot: BasketLine[]) =>
    usefulArea(expandCopies({ items: lot, warehouseDefId: entrepot.id, lookup }), entrepot);
  /** Aire du plus grand rectangle de terre libre (histogramme par ligne, O(W·H)). */
  const plusGrandRectangleLibre = (): number => {
    const haut = new Int32Array(W);
    let best = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) haut[x] = libre(y * W + x) ? haut[x] + 1 : 0;
      const pile: number[] = [];
      for (let x = 0; x <= W; x++) {
        const hx = x < W ? haut[x] : 0;
        while (pile.length && haut[pile[pile.length - 1]] >= hx) {
          const hh = haut[pile.pop()!];
          const gauche = pile.length ? pile[pile.length - 1] + 1 : 0;
          best = Math.max(best, hh * (x - gauche));
        }
        pile.push(x);
      }
    }
    return best;
  };

  /** Pose un lot ; rend les deux moitiés à reprendre s'il n'a pas tenu d'un bloc. */
  const traiterLot = (lot: BasketLine[], profondeur: number): BasketLine[][] => {
    if (lot.reduce((n, l) => n + l.count, 0) <= SEUL_MAX) {
      lot = poserUnAUn(lot);
      if (!lot.length) return [];
    }
    // Un grand lot dont le seul contenu dépasse le plus grand rectangle libre ne tient pas en
    // blueprint (et n'est pas essayé dans la forme) : on le coupe sans calculer sa boîte.
    if (profondeur < DECOUPE_MAX && lot.reduce((n, l) => n + l.count, 0) > FORME_MAX && surfaceUtile(lot) > plusGrandRectangleLibre()) {
      const m = couper(lot);
      if (m) return m;
    }
    const variantes: BasketPlan[] = [];
    let refus = "";
    for (const side of EXIT_SIDES) {
      const r = blueprintDe(catalog, lot, side, opts.region);
      if ("refuse" in r) refus = r.raison || r.nonServis.map((u) => direUnmet(u, nom)).join(" · ");
      else variantes.push(r);
    }
    if (variantes.length && poserBlueprint(variantes)) return [];
    if (variantes.length && poserDansLaForme(lot, variantes[0].box)) return [];
    // Refusé, le plus souvent parce qu'un seul entrepôt ne dessert pas tout ; ou trop grand pour
    // la terre libre d'une petite île. On coupe en deux : chaque moitié a son entrepôt.
    const moities = profondeur < DECOUPE_MAX ? couper(lot) : null;
    if (moities) return moities;
    const restants = poserUnAUn(lot);
    for (const l of restants) signales.add(l.defId);
    if (variantes.length) for (const l of restants) sansPlace.set(l.defId, (sansPlace.get(l.defId) ?? 0) + l.count);
    else if (restants.length) out.manques.push(`Blueprint impossible (${restants.map((l) => nom(l.defId)).join(", ")}) : ${refus}`);
    return [];
  };
  /**
   * PAR NIVEAU DE TAILLE, pas un lot jusqu'au bout. Découpé en profondeur d'abord, le premier
   * lot se posait en petits morceaux partout et ne laissait plus un rectangle libre aux lots
   * suivants. Ici tous les lots sont essayés entiers, puis toutes les moitiés, puis les quarts :
   * les grandes boîtes passent tant qu'il reste de grands rectangles, et chaque bien a sa part.
   */
  const poserLots = (lots: BasketLine[][]) => {
    const file = lots.map((lot) => ({ lot, profondeur: 0 }));
    for (let k = 0; k < file.length; k++) {
      const { lot, profondeur } = file[k];
      for (const m of traiterLot(lot, profondeur)) file.push({ lot: m, profondeur: profondeur + 1 });
    }
  };

  // ─── EXPLOITATIONS SUR LES EMPLACEMENTS DE L'ÎLE ────────────────────────────────────
  if (terrain.length) {
    const existants = [...ville.buildings, ...out.buildings];
    const toutesRoutes: RoadTile[] = [];
    for (let c = 0; c < N; c++) if (route[c]) toutesRoutes.push({ x: c % W, y: (c / W) | 0 });
    const sp = planSlots(grid, catalog, lookup, existants, toutesRoutes, [], () => false, {
      region: opts.region, demandes: terrain.map((l) => ({ defId: l.defId, count: l.count })), pres: opts.centre, raccordMax: 400,
      // les boîtes des blueprints (champs, aires libres) et les conduites sont intouchables ;
      // les routes, elles, restent franchissables : planSlots les connaît comme routes
      bloquees: occ.map((v, c) => (v && !route[c] ? 1 : 0)),
    });
    for (const b of sp.buildings) {
      out.buildings.push(b);
      marquer(b);
      if (estEntrepot(lookup(b.defId))) out.entrepots++;
      else compter(b.defId);
    }
    poserRoutes(sp.roads);
    // HORS MARAIS. Les productions de marais portent `CanBePlacedOnNonMarsh=1` dans les fichiers
    // du jeu (`GAME_MECHANICS.md` §12) : à court d'emplacements de marais, elles se posent sur la
    // terre ordinaire. Ce qui manque part donc en blueprint, avec un avis, au lieu d'être perdu.
    const horsMarais = terrain
      .filter((l) => lookup(l.defId)?.slotType === "marsh")
      .map((l) => ({ defId: l.defId, count: l.count - (poses.get(l.defId) ?? 0) }))
      .filter((l) => l.count > 0);
    const manquesMarais = new Set(horsMarais.map((l) => nom(l.defId)));
    const dits = sp.gaps.filter((g) => ![...manquesMarais].some((n) => g.startsWith(`${n} :`)));
    out.manques.push(...dits);
    for (const l of terrain) if (dits.some((g) => g.startsWith(`${nom(l.defId)} :`))) signales.add(l.defId);
    if (horsMarais.length) {
      out.avertissements.push(`Posé(s) hors marais, faute d'emplacement : ${horsMarais.map((l) => `${l.count} × ${nom(l.defId)}`).join(", ")}`);
      poserLots(lotsDeProduction(horsMarais));
    }
  }

  // ─── BÂTIMENTS CÔTIERS ──────────────────────────────────────────────────────────────
  if (cotiers.length && grid.water) {
    const eau = grid.water;
    const toucheMer = (x: number, y: number, w: number, h: number) => {
      for (let i = -1; i <= w; i++) for (const yy of [y - 1, y + h]) {
        const xx = x + i;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && eau[yy * W + xx]) return true;
      }
      for (let j = 0; j < h; j++) for (const xx of [x - 1, x + w]) {
        const yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && eau[yy * W + xx]) return true;
      }
      return false;
    };
    /** Emprise et partie dans l'eau (débordement compris) libres de tout bâtiment, route, champ. */
    const libreDeTout = (x: number, y: number, w: number, h: number, p: { x: number; y: number; w: number; h: number }) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (occ[(y + j) * W + x + i]) return false;
      for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
        const xx = x + p.x + i, yy = y + p.y + j;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || occ[yy * W + xx]) return false;
      }
      return true;
    };
    /** Distance à la ville de la case de quai la plus proche (la terre de l'emprise), −1 sinon. */
    const distanceDuQuai = (x: number, y: number, w: number, h: number, p: { x: number; y: number; w: number; h: number }) => {
      let best = -1;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        if (i >= p.x && i < p.x + p.w && j >= p.y && j < p.y + p.h) continue;
        const v = dist[(y + j) * W + x + i];
        if (v >= 0 && (best < 0 || v < best)) best = v;
      }
      return best;
    };
    const aServir: PlacedBuilding[] = [];
    for (const l of cotiers) {
      const d = lookup(l.defId)!;
      let n = 0;
      for (; n < l.count; n++) {
        reintegrer();
        const places: { x: number; y: number; rot: Rotation; d: number }[] = [];
        for (const rot of (d.rotatable ? [0, 90, 180, 270] : [0]) as Rotation[]) {
          const { w, h } = footprintSize(d, rot);
          const partie = partieEauPosee(d, rot);
          for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) {
            let dd: number;
            if (partie) {
              // la vraie règle du jeu : sa partie dans l'eau sur l'eau constructible, le reste à
              // terre (le quai), rien d'occupé ; la distance se lit sur le quai
              if (!terrainConvient(grid, d, x, y, rot, 1) || !libreDeTout(x, y, w, h, partie)) continue;
              dd = distanceDuQuai(x, y, w, h, partie);
            } else {
              if (rot === 180 || rot === 270) continue; // ancienne règle : deux orientations suffisent
              if (!boiteLibre(x, y, w, h) || !toucheMer(x, y, w, h)) continue;
              dd = dist[y * W + x];
            }
            if (dd >= 0) places.push({ x, y, rot, d: dd });
          }
        }
        // La place la plus proche d'abord ; une place d'où aucune route ne rejoint le réseau (un
        // voisin côtier la mure, une plage coupée) est rendue, et la suivante essayée : un côtier
        // sans route n'expédie rien (mesuré le 12/11, monde d'essai : quatre ramasseurs de coques).
        places.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
        let pose = false;
        for (const best of places.slice(0, COTE_ESSAIS)) {
          const b: PlacedBuilding = { uid: uid("cote"), defId: d.id, x: best.x, y: best.y, rotation: best.rot, locked: false };
          const { w, h } = footprintSize(d, best.rot);
          // emprise et partie dans l'eau (débordement compris : deux pêcheurs ne partagent pas
          // leur eau) marquées AVANT de chercher la route : sans cela le raccord les traversait.
          // Toutes ces cases étaient libres (`libreDeTout`, `boiteLibre`) : les rendre est sûr.
          const partie = partieEauPosee(d, best.rot);
          const prises: number[] = [];
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) prises.push((best.y + j) * W + best.x + i);
          if (partie) for (let j = 0; j < partie.h; j++) for (let i = 0; i < partie.w; i++) {
            const xx = best.x + partie.x + i, yy = best.y + partie.y + j;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H) prises.push(yy * W + xx);
          }
          for (const c of prises) occ[c] = 1;
          let chemin: RoadTile[] | null = null;
          for (const [px, py] of perimetre(best.x, best.y, w, h, W, H)) {
            chemin = relier(py * W + px);
            if (chemin !== null) break;
          }
          if (chemin === null) { for (const c of prises) occ[c] = 0; continue; }
          out.buildings.push(b);
          compter(d.id);
          aServir.push(b);
          poserRoutes(chemin);
          pose = true;
          break;
        }
        if (!pose) break;
      }
      if (n < l.count) { out.manques.push(`${d.name} : ${l.count - n} sur ${l.count} sans place sur la côte`); signales.add(d.id); }
    }
    // Un côtier n'expédie que si un entrepôt (ou le comptoir) est à portée de charrette.
    const wh = pickWarehouse(catalog, opts.region);
    for (const b of aServir) {
      const d = lookup(b.defId)!;
      const portee = d.transporterRange ?? 30;
      const atteint = atteintes(route, W, H, b, d, portee);
      const racines = [...ville.buildings, ...out.buildings].filter((x) => lookup(x.defId)?.roadRoot);
      const servi = racines.some((r) => {
        const rd = lookup(r.defId)!;
        return perimetre(r.x, r.y, ...dims(rd, r.rotation), W, H).some(([x, y]) => atteint.has(y * W + x));
      });
      if (servi) continue;
      reintegrer();
      let pose = false;
      for (const c of [...atteint].sort((a, b2) => a - b2)) {
        const cx = c % W, cy = (c / W) | 0;
        for (const [x, y] of [[cx + 1, cy], [cx - wh.size.w, cy], [cx, cy + 1], [cx, cy - wh.size.h]] as const) {
          if (!boiteLibre(x, y, wh.size.w, wh.size.h)) continue;
          const e: PlacedBuilding = { uid: uid("wh"), defId: wh.id, x, y, rotation: 0, locked: false };
          out.buildings.push(e);
          marquer(e);
          out.entrepots++;
          pose = true;
          break;
        }
        if (pose) break;
      }
      if (!pose) out.manques.push(`${d.name} en (${b.x}, ${b.y}) : aucun entrepôt possible à portée de charrette`);
    }
  } else if (cotiers.length) {
    out.manques.push("L'île n'a pas de carte de la mer : bâtiments côtiers non posés");
  }
  // Les lots EN DERNIER : ils vont sur n'importe quelle terre, les côtiers et les exploitations
  // non. Posés avant, leurs champs muraient la côte (12/11, monde d'essai : ramasseurs de coques
  // sans route ou sans place) et les abords des emplacements.
  poserLots(lotsDeProduction(reste));

  out.lignes = panier.lines.map((l) => ({ defId: l.defId, nom: nom(l.defId), role: "production", demande: l.count, pose: poses.get(l.defId) ?? 0 }));
  if (sansPlace.size) {
    out.manques.push(`Aucune place libre sur l'île pour : ${[...sansPlace].map(([id, n]) => `${n} × ${nom(id)}`).join(", ")}`);
  }
  for (const l of out.lignes) {
    if (l.pose < l.demande && !signales.has(l.defId)) out.manques.push(`${l.nom} : ${l.pose} posé(s) sur ${l.demande}`);
  }
  return out;
}

const dims = (d: BuildingDef, rot: number): [number, number] => {
  const fp = footprintSize(d, rot as 0 | 90);
  return [fp.w, fp.h];
};

/** Cases orthogonalement adjacentes à une emprise (sans les coins), dans la grille. */
function perimetre(x: number, y: number, w: number, h: number, W: number, H: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < w; i++) for (const yy of [y - 1, y + h]) if (yy >= 0 && yy < H && x + i >= 0 && x + i < W) out.push([x + i, yy]);
  for (let j = 0; j < h; j++) for (const xx of [x - 1, x + w]) if (xx >= 0 && xx < W && y + j >= 0 && y + j < H) out.push([xx, y + j]);
  return out;
}

/** Routes atteintes depuis un bâtiment, à `portee` près le long des routes. */
function atteintes(route: Uint8Array, W: number, H: number, b: PlacedBuilding, d: BuildingDef, portee: number): Set<number> {
  const [w, h] = dims(d, b.rotation);
  const vu = new Set<number>();
  let front: number[] = [];
  for (const [x, y] of perimetre(b.x, b.y, w, h, W, H)) {
    const c = y * W + x;
    if (route[c] && !vu.has(c)) { vu.add(c); front.push(c); }
  }
  for (let k = 1; k < portee && front.length; k++) {
    const next: number[] = [];
    for (const c of front) {
      const x = c % W;
      for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < W * H - W ? c + W : -1]) {
        if (n >= 0 && route[n] && !vu.has(n)) { vu.add(n); next.push(n); }
      }
    }
    front = next;
  }
  return vu;
}
