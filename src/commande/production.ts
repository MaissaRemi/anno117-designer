import type { BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile, Rotation } from "../model/types";
import { terrainConvient, type DefLookup } from "../engine/rules";
import { footprintSize, partieEauPosee, routeSeule } from "../engine/geometry";
import { economy } from "../economy/economy";
import { uid } from "../model/factories";
import { planFromBasket, pickWarehouse, type BasketPlan } from "../prodlayout";
import { normalizeBasket, type BasketLine } from "../prodlayout/basket";
import { EXIT_SIDES } from "../prodlayout/exit";
import { direUnmet } from "../prodlayout/unmet";
import { planSlots } from "../optimizer/slotPlan";
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
const DECOUPE_MAX = 5;

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

/** Coupe un lot en deux moitiés de taille voisine, en séparant au besoin les exemplaires. */
function couper(lot: BasketLine[]): [BasketLine[], BasketLine[]] | null {
  const total = lot.reduce((s, l) => s + l.count, 0);
  if (total < 2) return null;
  if (lot.length === 1) {
    const l = lot[0];
    return [[{ defId: l.defId, count: Math.ceil(l.count / 2) }], [{ defId: l.defId, count: Math.floor(l.count / 2) }]];
  }
  const a: BasketLine[] = [], b: BasketLine[] = [];
  let na = 0;
  for (const l of lot) {
    if (na < total / 2) { a.push(l); na += l.count; } else b.push(l);
  }
  return b.length ? [a, b] : [lot.slice(0, Math.ceil(lot.length / 2)), lot.slice(Math.ceil(lot.length / 2))];
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
    }
  };

  const terrain = panier.lines.filter((l) => TERRAIN.has(lookup(l.defId)?.slotType ?? ""));
  const cotiers = panier.lines.filter((l) => { const d = lookup(l.defId); return !!d && estCotier(d) && !TERRAIN.has(d.slotType ?? ""); });
  const reste = panier.lines.filter((l) => !terrain.includes(l) && !cotiers.includes(l));
  const poses = new Map<string, number>();
  const compter = (id: string, n = 1) => poses.set(id, (poses.get(id) ?? 0) + n);

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

  /** Pose un blueprint : la boîte libre la plus proche de la ville, sortie reliée au réseau. */
  const poserBlueprint = (variantes: BasketPlan[]): boolean => {
    reintegrer();
    const cands: { p: BasketPlan; x: number; y: number; d: number; sortie: number }[] = [];
    for (const p of variantes) {
      const { w, h } = p.box;
      const [dx, dy] = p.exit.side === "nord" ? [0, -1] : p.exit.side === "sud" ? [0, 1] : p.exit.side === "ouest" ? [-1, 0] : [1, 0];
      for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) {
        if (!boiteLibre(x, y, w, h)) continue;
        const sx = x + p.exit.x + dx, sy = y + p.exit.y + dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const s = sy * W + sx;
        const d = dist[s];
        if (d < 0 || !(route[s] || franchissable(s))) continue;
        cands.push({ p, x, y, d, sortie: s });
      }
    }
    cands.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    for (const c of cands.slice(0, 40)) {
      const chemin = relier(c.sortie);
      if (chemin === null) continue;
      const { layout } = c.p;
      for (const b of layout.buildings) {
        const nb: PlacedBuilding = { ...b, uid: uid("prod"), x: b.x + c.x, y: b.y + c.y };
        out.buildings.push(nb);
        if (lookup(b.defId)?.template === "Warehouse") out.entrepots++;
        else compter(b.defId);
      }
      for (const f of layout.fields) out.fields.push({ ...f, x: f.x + c.x, y: f.y + c.y });
      // toute la boîte est réservée : ses cases libres sont l'aire libre des bûcherons et
      // des ruchers, que rien ne doit venir occuper
      for (let j = 0; j < c.p.box.h; j++) for (let i = 0; i < c.p.box.w; i++) occ[(c.y + j) * W + c.x + i] = 1;
      poserRoutes(layout.roads.map((r) => ({ x: r.x + c.x, y: r.y + c.y })));
      const s = c.sortie;
      if (!route[s]) poserRoutes([{ x: s % W, y: (s / W) | 0 }]);
      poserRoutes(chemin);
      out.blueprints++;
      return true;
    }
    return false;
  };

  const traiterLot = (lot: BasketLine[], profondeur: number) => {
    const variantes: BasketPlan[] = [];
    let refus = "";
    for (const side of EXIT_SIDES) {
      const r = planFromBasket(catalog, normalizeBasket(lot), { exitSide: side });
      if ("refuse" in r) refus = r.raison || r.nonServis.map((u) => direUnmet(u, nom)).join(" · ");
      else variantes.push(r);
    }
    if (variantes.length) {
      if (!poserBlueprint(variantes)) {
        out.manques.push(`Aucune place libre sur l'île pour : ${lot.map((l) => `${l.count} × ${nom(l.defId)}`).join(", ")}`);
      }
      return;
    }
    // Refusé : le plus souvent un seul entrepôt ne dessert pas tout. On coupe en deux.
    const moities = profondeur < DECOUPE_MAX ? couper(lot) : null;
    if (moities) { for (const m of moities) traiterLot(m, profondeur + 1); return; }
    out.manques.push(`Blueprint impossible (${lot.map((l) => nom(l.defId)).join(", ")}) : ${refus}`);
  };
  for (const lot of lotsDeProduction(reste)) traiterLot(lot, 0);

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
      if (lookup(b.defId)?.template === "Warehouse") out.entrepots++;
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
    out.manques.push(...sp.gaps.filter((g) => ![...manquesMarais].some((n) => g.startsWith(`${n} :`))));
    if (horsMarais.length) {
      out.avertissements.push(`Posé(s) hors marais, faute d'emplacement : ${horsMarais.map((l) => `${l.count} × ${nom(l.defId)}`).join(", ")}`);
      for (const lot of lotsDeProduction(horsMarais)) traiterLot(lot, 0);
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
        let best: { x: number; y: number; rot: Rotation; d: number } | null = null;
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
            if (dd < 0) continue;
            if (!best || dd < best.d) best = { x, y, rot, d: dd };
          }
        }
        if (!best) break;
        const b: PlacedBuilding = { uid: uid("cote"), defId: d.id, x: best.x, y: best.y, rotation: best.rot, locked: false };
        const { w, h } = footprintSize(d, best.rot);
        // l'emprise est marquée AVANT de chercher la route : sans cela le raccord la traversait
        marquer(b);
        // sa partie dans l'eau aussi, débordement compris : deux pêcheurs ne partagent pas leur eau
        const partie = partieEauPosee(d, best.rot);
        if (partie) for (let j = 0; j < partie.h; j++) for (let i = 0; i < partie.w; i++) {
          const xx = best.x + partie.x + i, yy = best.y + partie.y + j;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) occ[yy * W + xx] = 1;
        }
        let chemin: RoadTile[] | null = null;
        for (const [px, py] of perimetre(best.x, best.y, w, h, W, H)) {
          chemin = relier(py * W + px);
          if (chemin !== null) { chemin = route[py * W + px] ? chemin : [...chemin, { x: px, y: py }]; break; }
        }
        out.buildings.push(b);
        compter(d.id);
        aServir.push(b);
        if (chemin) poserRoutes(chemin);
        else out.manques.push(`${d.name} en (${b.x}, ${b.y}) sans route jusqu'au réseau`);
      }
      if (n < l.count) out.manques.push(`${d.name} : ${l.count - n} sur ${l.count} sans place sur la côte`);
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

  out.lignes = panier.lines.map((l) => ({ defId: l.defId, nom: nom(l.defId), role: "production", demande: l.count, pose: poses.get(l.defId) ?? 0 }));
  for (const l of out.lignes) {
    if (l.pose < l.demande && !out.manques.some((m) => m.includes(l.nom))) {
      out.manques.push(`${l.nom} : ${l.pose} posé(s) sur ${l.demande}`);
    }
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
