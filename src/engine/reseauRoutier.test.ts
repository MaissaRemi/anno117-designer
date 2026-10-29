import { describe, expect, it } from "vitest";
import type { BuildingDef } from "../model/types";
import {
  casesAuContact, coinDe, creerParcours, degre, estLosange, idDroite, idLosange, noeudsAuContact, parcourir,
  noeudsAuContactDeCase, noeudsAuContactRect, poserLosange, reseauDeRoutes, reseauVide, routesAuContactRect,
  routesDuReseau, tailleReseau, voisins, type ReseauRoutier,
} from "./reseauRoutier";
import { trianglesDeCase, trianglesDuCoin } from "../optimizer/maillageTriangles";
import { makeStreetGrid, type Footprint, type ReachState } from "../optimizer/streetGrid";

/** PRNG déterministe (mulberry32). */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lister = (f: (cb: (id: number) => void) => void): number[] => {
  const out: number[] = [];
  f((id) => out.push(id));
  return out;
};

/**
 * ORACLE GÉOMÉTRIQUE, tiré du maillage de triangles (étape 1) et non des tables du module :
 * chaque nœud est l'ensemble de ses triangles, sur une grille élargie de 2 cases de marge pour
 * que les losanges du bord gardent leurs 8 triangles. Deux nœuds disjoints se touchent par un
 * côté s'ils partagent une arête de leur bord, par un point s'ils ne partagent qu'un sommet.
 */
function oracle(W: number, H: number) {
  const M = 2, Wp = W + 2 * M, Hp = H + 2 * M;
  const sommets = (t: number): string[] => {
    const c = (t / 4) | 0, k = t % 4, x = 2 * (c % Wp), y = 2 * ((c / Wp) | 0);
    const centre = `${x + 1},${y + 1}`;
    const coins = [[`${x},${y}`, `${x + 2},${y}`], [`${x + 2},${y}`, `${x + 2},${y + 2}`],
      [`${x},${y + 2}`, `${x + 2},${y + 2}`], [`${x},${y}`, `${x},${y + 2}`]][k];
    return [coins[0], coins[1], centre];
  };
  const forme = (r: ReseauRoutier, id: number) => {
    let tris: number[];
    if (id < r.N) tris = trianglesDeCase(Wp, (id % W) + M, ((id / W) | 0) + M);
    else { const { X, Y } = coinDe(r, id); tris = trianglesDuCoin(Wp, Hp, X + M, Y + M); }
    const aretes = new Map<string, number>();
    const pts = new Set<string>();
    for (const t of tris) {
      const [a, b, c] = sommets(t);
      for (const [p, q] of [[a, b], [b, c], [a, c]]) {
        const k = p < q ? `${p}|${q}` : `${q}|${p}`;
        aretes.set(k, (aretes.get(k) ?? 0) + 1);
      }
      for (const p of [a, b, c]) pts.add(p);
    }
    const bord = new Set([...aretes].filter(([, n]) => n === 1).map(([k]) => k));
    return { tris: new Set(tris), bord, pts };
  };
  return (r: ReseauRoutier, a: number, b: number): "chevauche" | "cote" | "point" | null => {
    const A = forme(r, a), B = forme(r, b);
    if ([...A.tris].some((t) => B.tris.has(t))) return "chevauche";
    if ([...A.bord].some((e) => B.bord.has(e))) return "cote";
    if ([...A.pts].some((p) => B.pts.has(p))) return "point";
    return null;
  };
}

describe("réseau routier : la relation de contact", () => {
  const W = 5, H = 4;
  const r = reseauVide(W, H);
  const contact = oracle(W, H);
  const n = tailleReseau(r);

  it("contact = côté entre objets de même orientation, point entre droite et losange (oracle des triangles)", () => {
    for (let a = 0; a < n; a++) {
      const attendu: number[] = [];
      for (let b = 0; b < n; b++) {
        if (b === a) continue;
        const c = contact(r, a, b);
        const memeSorte = estLosange(r, a) === estLosange(r, b);
        if ((c === "cote" && memeSorte) || (c === "point" && !memeSorte)) attendu.push(b);
      }
      expect(lister((f) => noeudsAuContact(r, a, f)).sort((x, y) => x - y), `nœud ${a}`).toEqual(attendu);
    }
  });

  it("jamais de contact entre nœuds qui se chevauchent, ni de côté entre droite et losange", () => {
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const c = contact(r, a, b);
      if (estLosange(r, a) !== estLosange(r, b)) expect(c).not.toBe("cote");
    }
  });

  it("une case droite : 4 voisines par un côté (gauche, droite, haut, bas), puis 8 losanges en pointe", () => {
    const big = reseauVide(10, 10);
    const ids = lister((f) => noeudsAuContact(big, idDroite(big, 4, 4), f));
    expect(ids.slice(0, 4)).toEqual([idDroite(big, 3, 4), idDroite(big, 5, 4), idDroite(big, 4, 3), idDroite(big, 4, 5)]);
    expect(ids.slice(4).every((id) => estLosange(big, id))).toBe(true);
    expect(ids).toHaveLength(12);
    const l = idLosange(big, 4, 4);
    expect(lister((f) => noeudsAuContact(big, l, f))).toHaveLength(12);
    expect(lister((f) => casesAuContact(big, l, f))).toHaveLength(8);
  });

  it("voisins, cases servies et degré ne retiennent que les routes", () => {
    const g = reseauVide(10, 10);
    g.droite[idDroite(g, 3, 5)] = 1;
    g.droite[idDroite(g, 2, 5)] = 1;
    poserLosange(g, 5, 5); // pointe gauche (4, 5) = coin haut-droit de la case (3, 5)
    poserLosange(g, 6, 6); // voisin par un côté
    poserLosange(g, 7, 5); // pointe contre pointe avec (5, 5) : pas relié
    const L55 = idLosange(g, 5, 5), L66 = idLosange(g, 6, 6), L75 = idLosange(g, 7, 5);
    expect(lister((f) => voisins(g, idDroite(g, 3, 5), f))).toEqual([idDroite(g, 2, 5), L55]);
    expect(lister((f) => voisins(g, L55, f)).sort()).toEqual([L66, idDroite(g, 3, 5)].sort());
    expect(degre(g, L75)).toBe(1); // (6, 6) seulement
    expect(lister((f) => casesAuContact(g, idDroite(g, 0, 0), f))).toEqual([idDroite(g, 1, 0), idDroite(g, 0, 1)]);
  });
});

describe("réseau routier : l'emprise d'un bâtiment et les routes d'un plan", () => {
  it("contact d'une emprise = union des contacts de ses cases, moins ce qui la chevauche", () => {
    const t = reseauVide(9, 8);
    for (const [x, y, w, h] of [[2, 2, 3, 3], [0, 0, 2, 1], [6, 5, 3, 3], [3, 4, 1, 2], [-1, 3, 2, 2]]) {
      const attendu = new Set<number>();
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        noeudsAuContactDeCase(t, x + i, y + j, (id) => {
          if (id < t.N) {
            const cx = id % t.W, cy = (id / t.W) | 0;
            if (cx >= x && cx < x + w && cy >= y && cy < y + h) return; // dans l'emprise
          } else {
            const { X, Y } = coinDe(t, id);
            if (X >= x && X <= x + w && Y >= y && Y <= y + h) return; // chevauche l'emprise
          }
          attendu.add(id);
        });
      }
      const obtenu = lister((f) => noeudsAuContactRect(t, x, y, w, h, f));
      expect(new Set(obtenu), `${x},${y} ${w}×${h}`).toEqual(attendu);
      expect(obtenu).toHaveLength(attendu.size); // sans doublon
    }
  });

  it("un côté, plusieurs points de départ ; un coin, un seul (vérifié en jeu)", () => {
    const t = reseauVide(12, 12);
    // emprise 3 × 3 en (4, 4) : 4 points de grille par côté, 2 losanges à chaque coin
    const losanges = lister((f) => noeudsAuContactRect(t, 4, 4, 3, 3, f)).filter((id) => estLosange(t, id));
    expect(losanges).toHaveLength(4 * 2 + 4 * 2);
  });

  it("routes d'un plan ↔ réseau : les losanges gardent leur forme", () => {
    const routes = [{ x: 2, y: 3 }, { x: 4, y: 4, losange: true as const }, { x: 9, y: 9 }, { x: 0, y: 0, losange: true as const }];
    const r = reseauDeRoutes(6, 6, routes);
    expect(r.losanges).toBe(2);
    expect(routesDuReseau(r)).toEqual([{ x: 2, y: 3 }, { x: 0, y: 0, losange: true }, { x: 4, y: 4, losange: true }]);
  });
});

describe("réseau routier : la portée en nœuds", () => {
  it("une case de route, droite ou losange, compte pour un pas, jonction comprise", () => {
    const g = reseauVide(12, 12);
    for (const x of [1, 2, 3]) g.droite[idDroite(g, x, 5)] = 1;
    for (const [X, Y] of [[5, 5], [6, 6], [7, 7]]) poserLosange(g, X, Y);
    const p = creerParcours(g);
    parcourir(g, p, [idDroite(g, 1, 5)]);
    expect([1, 2, 3].map((x) => p.dist[idDroite(g, x, 5)])).toEqual([1, 2, 3]);
    expect([[5, 5], [6, 6], [7, 7]].map(([X, Y]) => p.dist[idLosange(g, X, Y)])).toEqual([4, 5, 6]);
    parcourir(g, p, [idDroite(g, 1, 5)], 4);
    expect(p.dist[idLosange(g, 5, 5)]).toBe(4);
    expect(p.dist[idLosange(g, 6, 6)]).toBe(-1);
    expect(p.atteints).toHaveLength(4);
  });

  /** L'ancien `streetGrid.bfsType` (4-adjacence écrite en dur), gardé comme oracle. */
  function ancienBfsType(W: number, H: number, roadAt: Uint8Array, emprises: Footprint[], range: number) {
    const N = W * H;
    const reach = new Uint8Array(N), parent = new Int32Array(N).fill(-2), dist = new Int32Array(N).fill(-1);
    const reachList: number[] = [];
    let frontier: number[] = [];
    for (const { x, y, w, h } of emprises) {
      const seeds: number[] = [];
      for (let i = 0; i < w; i++) {
        if (y - 1 >= 0 && roadAt[(y - 1) * W + (x + i)]) seeds.push((y - 1) * W + (x + i));
        if (y + h < H && roadAt[(y + h) * W + (x + i)]) seeds.push((y + h) * W + (x + i));
      }
      for (let j = 0; j < h; j++) {
        if (x - 1 >= 0 && roadAt[(y + j) * W + (x - 1)]) seeds.push((y + j) * W + (x - 1));
        if (x + w < W && roadAt[(y + j) * W + (x + w)]) seeds.push((y + j) * W + (x + w));
      }
      for (const c of seeds) {
        if (dist[c] >= 0) continue;
        dist[c] = 1; parent[c] = -1; reach[c] = 1; reachList.push(c); frontier.push(c);
      }
    }
    let d = 1;
    while (frontier.length && d < range) {
      const next: number[] = [];
      for (const c of frontier) {
        const x = c % W, y = (c / W) | 0;
        for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
          if (nb < 0 || !roadAt[nb] || dist[nb] >= 0) continue;
          dist[nb] = d + 1; parent[nb] = c; reach[nb] = 1; reachList.push(nb); next.push(nb);
        }
      }
      frontier = next; d++;
    }
    return { reach, reachList, parent };
  }

  it("sans losange : mêmes atteints, même ordre, mêmes parents que l'ancien bfsType", () => {
    const def = { id: "svc" } as BuildingDef;
    for (let essai = 0; essai < 40; essai++) {
      const rnd = prng(1000 + essai);
      const W = 20 + Math.floor(rnd() * 25), H = 15 + Math.floor(rnd() * 25), N = W * H;
      const roadAt = new Uint8Array(N);
      for (let i = 0; i < N; i++) roadAt[i] = rnd() < 0.55 ? 1 : 0;
      const sg = makeStreetGrid({
        W, H, occ: new Uint8Array(N), roadAt, bldAdj: new Uint8Array(N), usable: new Array(N).fill(true),
        rw: 3, rh: 3, x0: 0, y0: 0, x1: W - 1, y1: H - 1, STEPH: 7,
      });
      const emprises: Footprint[] = [];
      for (let k = 1 + Math.floor(rnd() * 4); k > 0; k--) {
        const w = 1 + Math.floor(rnd() * 4), h = 1 + Math.floor(rnd() * 4);
        emprises.push({ x: Math.floor(rnd() * (W - w)), y: Math.floor(rnd() * (H - h)), w, h });
      }
      const range = 1 + Math.floor(rnd() * 20);
      const oracle = ancienBfsType(W, H, roadAt, emprises, range);
      const masque = (parent: Int32Array, reach: Uint8Array) =>
        Array.from(parent.subarray(0, N)).map((v, i) => (reach[i] ? v : -2));

      // le bfsType du moteur, désormais sur le graphe
      const tc: ReachState = { def, range, reach: new Uint8Array(N), reachList: [], parent: new Int32Array(N) };
      sg.bfsType(tc, new Map([[def.id, emprises]]));
      expect(tc.reachList, `essai ${essai}`).toEqual(oracle.reachList);
      expect(masque(tc.parent, tc.reach)).toEqual(masque(oracle.parent, oracle.reach));

      // le parcours du module
      const reseau: ReseauRoutier = reseauVide(W, H, roadAt);
      const p = creerParcours(reseau);
      parcourir(reseau, p, [], 3); // un parcours précédent à effacer
      parcourir(reseau, p, emprises.flatMap((e) => routesAuContactRect(reseau, e.x, e.y, e.w, e.h)), range);
      expect(p.atteints, `essai ${essai}`).toEqual(oracle.reachList);
      for (let i = 0; i < N; i++) if ((p.dist[i] > 0) !== (oracle.reach[i] === 1)) throw new Error(`essai ${essai}, case ${i}`);
    }
  });
});
