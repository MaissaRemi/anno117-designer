import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { buildIslandGrid } from "../data/islandGrid";
import { makeGrid } from "../model/factories";
import type { BuildingDef, GridShape } from "../model/types";
import { economy } from "../economy/economy";
import { makeLookup, roadConnected, rootedRoadSet, terrainConvient } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport } from "./islandPlan";
import { connectKontor, keepMainLandmass, pickKontorDef, repairRoadConnectivity, reserveKontor } from "./kontor";

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const svcTypes = (t: (typeof economy.tiers)[number]) =>
  new Set(t.services.filter((s) => s.building && (lookup(s.building)?.streetRange || lookup(s.building)?.radius?.range)).map((s) => s.building)).size;
const tierRich = [...economy.tiers].filter((t) => t.residenceId).sort((a, b) => svcTypes(b) - svcTypes(a))[0]!;

/**
 * Île réelle telle que la voit le planificateur en production : le worker descend la grille
 * vivante ½-tuile en tuiles. Elle porte donc la mer (comptoir côtier), les rivières et les
 * slots montagne (sources d'aqueduc) — trois choses qu'un simple masque terre n'a pas.
 */
function realIsland(id: string): GridShape {
  return downscaleGrid(buildIslandGrid(id)!);
}

describe("une seule masse continentale", () => {
  it("ne garde que le tenant du comptoir", () => {
    // Les « îles » du jeu ne sont pas des blocs pleins : bancs et lobes détachés. Les moteurs y
    // bâtissaient, aucune route ne franchissant la mer — 31 bâtiments INACTIFS en jeu sur une
    // île de 67 maisons. Depuis que la terre constructible vient du jeu (AreaIDs), les îles
    // réelles mesurées sont d'un seul tenant : le cas est donc construit.
    //   terre x 0..9 | mer x 10..19 | terre x 20..29, comptoir à gauche
    const w = 30, h = 10;
    const usable = Array.from({ length: w * h }, (_, c) => c % w < 10 || c % w >= 20);
    const kept = keepMainLandmass({ w, h, usable }, { x: 2, y: 5 });
    expect(kept.usable.filter(Boolean).length).toBe(100);
    expect(kept.usable[5 * w + 25]).toBe(false);
  });

  it("une rivière relie ses deux rives : un pont la franchit", () => {
    const w = 30, h = 10;
    const usable = Array.from({ length: w * h }, (_, c) => c % w < 10 || c % w >= 20);
    const rivers = Array.from({ length: w * h }, (_, c) => c % w >= 10 && c % w < 20 && ((c / w) | 0) === 5);
    const kept = keepMainLandmass({ w, h, usable, rivers }, { x: 2, y: 5 });
    expect(kept.usable.filter(Boolean).length).toBe(200);
    expect(kept.usable[5 * w + 10]).toBe(false); // la rivière reste non constructible
  });

  it("une grille d'un seul tenant est rendue telle quelle", () => {
    const g = makeGrid(24, 24);
    expect(keepMainLandmass(g)).toBe(g);
  });
});

describe("comptoir (racine du réseau routier)", () => {
  it("pickKontorDef choisit un comptoir JOUEUR, pas un comptoir PNJ", () => {
    const def = pickKontorDef(catalog, "Roman");
    expect(def).toBeDefined();
    expect(def!.roadRoot).toBe(true);
    // les « Harbor … Trader … » sont des comptoirs de PNJ, non constructibles
    expect(def!.nameInternal ?? "").toMatch(/^Harbor Warehouse/i);
  });

  it("reserveKontor pose le comptoir À CHEVAL : sa partie dans l'eau sur l'eau, le reste à terre", () => {
    // Le `.ifo` du comptoir romain déclare 6 colonnes dans l'eau sur 8 : posé tout à terre,
    // il restait à l'intérieur des terres et l'éditeur le marquait sur un mauvais terrain.
    const grid = realIsland("roman_island_medium_01");
    const def = pickKontorDef(catalog, "Roman")!;
    expect(def.partieEau).toBeDefined();
    const res = reserveKontor(grid, def)!;
    expect(res).not.toBeNull();
    expect(terrainConvient(grid, def, res.x, res.y, res.rotation, 1)).toBe(true);
    const { w, h } = footprintSize(res.def, res.rotation);
    let eau = 0, terre = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = (res.y + j) * grid.w + res.x + i;
      if (grid.water![c]) eau++; else if (grid.usable[c]) terre++;
      expect(res.grid.usable[c]).toBe(false); // retiré du masque donné aux moteurs
      expect(res.grid.water![c]).toBe(false); // et de l'eau : aucun pêcheur dessus
    }
    expect(eau).toBeGreaterThan(0);
    expect(terre).toBeGreaterThan(0);
  });

  it("sans carte d'eau (grille libre), aucun comptoir n'est réservé", () => {
    const def = pickKontorDef(catalog, "Roman")!;
    expect(reserveKontor(makeGrid(60, 60), def)).toBeNull();
  });

  it("le plan d'île produit un réseau ENRACINÉ (le port existe et la voirie y mène)", () => {
    const grid = realIsland("roman_island_medium_01");
    const r = planIslandImport({ catalog, grid, tierGuid: tierRich.guid, coverageFloor: 0.8 });
    const roots = r.buildings.filter((b) => lookup(b.defId)?.roadRoot);
    expect(roots.length).toBe(1); // exactement un comptoir

    const rooted = rootedRoadSet({ grid, buildings: r.buildings, roads: r.roads, fields: r.fields }, lookup);
    expect(rooted.hasRoot).toBe(true);
    // l'écrasante majorité de la voirie doit être reliée au comptoir : une route coupée de
    // la racine rend inactifs les bâtiments qu'elle dessert (régression 2026-08 : 6,6 % d'îlots)
    expect(rooted.set.size / Math.max(1, r.roads.length)).toBeGreaterThan(0.95);
  });

  it("île sans littoral : plan quand même produit, manque signalé", () => {
    // grille pleine sans carte d'eau → aucun littoral → pas de comptoir
    const r = planIslandImport({ catalog, grid: makeGrid(60, 60), tierGuid: tierRich.guid, coverageFloor: 0.8 });
    expect(r.buildings.length).toBeGreaterThan(0);
    expect(r.gaps.some((g) => /comptoir/i.test(g))).toBe(true);
  });
});

describe("portfolio de moteurs : l'eau est évaluée AVANT de trancher", () => {
  // Régression 2026-08 : packPlan (non eau-aware) gagnait de 0,1 % d'habitants sur un score
  // optimiste, puis l'eau routée après coup ne raccordait que 2/40 consommateurs (contre
  // 30/30 pour le lattice écarté), ce qui démotait toute la population.
  it("le plan retenu raccorde l'essentiel de ses consommateurs d'eau", () => {
    const grid = realIsland("roman_island_medium_01");
    for (const needMode of ["all", "thresholds"] as const) {
      const r = planIslandImport({ catalog, grid, tierGuid: tierRich.guid, coverageFloor: 0.8, needMode });
      if (!r.water || !r.water.consumers.length) continue;
      const ok = r.water.consumers.filter((c) => c.connected).length;
      // Seuil délibérément bas : sur une île pauvre en slots montagne, un raccordement
      // partiel est le VRAI comportement du jeu (budget 100u/source). Ce qu'on garde, c'est
      // l'effondrement : avant le correctif, le mode « seuils » livrait 5 % (2/40).
      //
      // Recalé à 0,5 après le quota d'unicité partagé : le taux dépend de la disposition, et
      // il bouge dans les DEUX sens quand on retire les autels surnuméraires. A/B mesuré sur
      // roman_island_medium_01 — mode « all » 61 % → 54 %, mode « seuils » 68 % → 89 %. Le
      // 0,6 précédent était calé sur un plan qui frôlait 61 %.
      expect(ok / r.water.consumers.length).toBeGreaterThan(0.5);
    }
  });
});

/**
 * Le comptoir sur le réseau en graphe : un réseau en losanges se rejoint par un coin, comme le
 * vérifie l'analyseur (`rootedRoadSet` à l'échelle 1). Le golden de la trame droite couvre le
 * reste ; ici, les branches que seuls des losanges empruntent.
 */
describe("comptoir et réparation sur le réseau en graphe", () => {
  const kdef = pickKontorDef(catalog, "Roman")!;
  const { w, h } = footprintSize(kdef, 0);
  const RESIDENCE = "g3145"; // Résidence de Patriciens, 3×3
  const g = makeGrid(34, 20);
  const kontor = { uid: "k", defId: kdef.id, x: 1, y: 1, rotation: 0 as const, locked: false };

  it("connectKontor trace en droit jusqu'à entrer sous un losange (jonction par recouvrement)", () => {
    const X = 1 + w + 6, Y = 2;
    const losange = { x: X, y: Y, losange: true as const };
    const k = connectKontor(g, { def: kdef, x: 1, y: 1, rotation: 0, grid: g }, [], [losange], lookup, () => false);
    expect(k.connected).toBe(true);
    expect(k.roads.length).toBeGreaterThan(0);
    expect(k.roads.every((r) => !r.losange)).toBe(true);
    const layout = { grid: g, buildings: [k.building], roads: [losange, ...k.roads], fields: [] };
    expect(rootedRoadSet(layout, lookup).set.has(`L${X},${Y}`)).toBe(true);
  });

  it("repairRoadConnectivity raccroche un îlot de losanges au noyau par des cases droites", () => {
    // noyau : la route droite sous le comptoir, de x = 1 à xFin ; îlot : un losange qui
    // recouvre les colonnes xFin+3 et xFin+4 et dessert une maison par sa pointe droite
    const y = 1 + h, xFin = w + 3, X = xFin + 4;
    const routes = [
      ...Array.from({ length: xFin }, (_, i) => ({ x: 1 + i, y })),
      { x: X, y, losange: true as const },
    ];
    const maisonB = { uid: "m", defId: RESIDENCE, x: X + 1, y, rotation: 0 as const, locked: false };
    const r = repairRoadConnectivity(g, [kontor, maisonB], routes, lookup);
    expect(r.added).toBe(3); // xFin+1, xFin+2, puis xFin+3 en recouvrement
    expect(r.stranded).toEqual([]);
    const layout = { grid: g, buildings: [kontor, maisonB], roads: r.roads, fields: [] };
    const { set } = rootedRoadSet(layout, lookup);
    expect(set.has(`L${X},${y}`)).toBe(true);
    expect(roadConnected(layout, lookup, maisonB, set)).toBe(true);
  });

  it("un îlot de losanges déjà joint au noyau par une jonction n'est pas réparé", () => {
    const y = 1 + h, xFin = w + 3;
    // losange (xFin + 1, y) : il recouvre la dernière case droite (xFin, y)
    const routes = [...Array.from({ length: xFin }, (_, i) => ({ x: 1 + i, y })), { x: xFin + 1, y, losange: true as const }];
    const r = repairRoadConnectivity(g, [kontor], routes, lookup);
    expect(r.added).toBe(0);
    expect(r.dropped).toBe(0);
    expect(r.roads).toEqual(routes);
  });
});

/**
 * Liaisons en diagonale (trame mêlée, étape 6) : avec `diagonales`, le raccordement peut poser
 * des losanges là où c'est plus court. Longueur d'un trajet : 1 par case droite, √2 par losange.
 */
describe("liaisons en diagonale", () => {
  const kdef = pickKontorDef(catalog, "Roman")!;
  const { w, h } = footprintSize(kdef, 0);
  const g = makeGrid(48, 48);
  const res = { def: kdef, x: 2, y: 2, rotation: 0 as const, grid: g };
  // le réseau : une route droite loin en biais du comptoir
  const y0 = 2 + h + 14, x0 = 2 + w + 14;
  const reseau = Array.from({ length: 8 }, (_, i) => ({ x: x0 + i, y: y0 }));
  const longueur = (rs: { losange?: true }[]) => rs.reduce((s, r) => s + (r.losange ? Math.SQRT2 : 1), 0);
  const chevauchent = (rs: { x: number; y: number; losange?: true }[]) => {
    const ls = rs.filter((r) => r.losange);
    return ls.some((a, i) => ls.slice(i + 1).some((b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1));
  };

  it("le comptoir se raccorde en biais, plus court qu'en équerre, et le réseau est bien atteint", () => {
    const droit = connectKontor(g, res, [], reseau, lookup, () => false);
    const mele = connectKontor(g, res, [], reseau, lookup, () => false, { diagonales: true });
    expect(droit.connected && mele.connected).toBe(true);
    expect(mele.roads.some((r) => r.losange)).toBe(true);
    expect(longueur(mele.roads)).toBeLessThan(longueur(droit.roads) - 5);
    expect(chevauchent(mele.roads)).toBe(false);
    const layout = { grid: g, buildings: [mele.building], roads: [...reseau, ...mele.roads], fields: [] };
    expect(rootedRoadSet(layout, lookup).set.has(`${x0},${y0}`)).toBe(true);
  });

  it("aucun losange sur l'emprise du comptoir ni sur une conduite d'eau", () => {
    // une conduite en biais coupe le trajet : il la franchit en droit, jamais sous un losange
    const aqueducs = Array.from({ length: 25 }, (_, k) => ({ x: k, y: 24 - k })); // en travers du trajet
    const mele = connectKontor(g, res, [], reseau, lookup, () => false, { diagonales: true, aqueducs });
    expect(mele.connected).toBe(true);
    const sousConduite = new Set(aqueducs.map((a) => `${a.x},${a.y}`));
    for (const r of mele.roads.filter((x) => x.losange)) {
      for (const [x, y] of [[r.x - 1, r.y - 1], [r.x, r.y - 1], [r.x - 1, r.y], [r.x, r.y]]) {
        expect(sousConduite.has(`${x},${y}`)).toBe(false);
        expect(x >= 2 && x < 2 + w && y >= 2 && y < 2 + h).toBe(false);
      }
    }
  });

  it("la réparation raccroche un îlot éloigné en biais", () => {
    const kontor = { uid: "k", defId: kdef.id, x: 2, y: 2, rotation: 0 as const, locked: false };
    const noyau = Array.from({ length: w }, (_, i) => ({ x: 2 + i, y: 2 + h }));
    const ilot = [{ x: 2 + w + 12, y: 2 + h + 12 }, { x: 2 + w + 13, y: 2 + h + 12 }];
    const droit = repairRoadConnectivity(g, [kontor], [...noyau, ...ilot], lookup, 40);
    const mele = repairRoadConnectivity(g, [kontor], [...noyau, ...ilot], lookup, 40, undefined, { diagonales: true });
    expect(mele.added).toBeGreaterThan(0);
    expect(mele.roads.some((r) => r.losange)).toBe(true);
    expect(longueur(mele.roads.slice(noyau.length + ilot.length))).toBeLessThan(droit.added);
    const layout = { grid: g, buildings: [kontor], roads: mele.roads, fields: [] };
    expect(rootedRoadSet(layout, lookup).set.has(`${ilot[0].x},${ilot[0].y}`)).toBe(true);
  });
});

describe("réparation : un îlot se raccroche à travers un autre", () => {
  it("l'îlot du fond, traité le premier, est repris une fois l'îlot du milieu raccroché", () => {
    // comptoir en bas ; noyau : la route qui longe son côté haut (y = 29). Îlot A (5, 20) à 8
    // cases du noyau ; îlot B (5, 12), plus haut donc traité avant A, à 16 cases du noyau mais
    // à 7 de A. Détour permis : 10 cases. Une maison n'est desservie que par B.
    const kdef = pickKontorDef(catalog, "Roman")!;
    const { w } = footprintSize(kdef, 0);
    const g = makeGrid(20, 40);
    const kontor = { uid: "k", defId: kdef.id, x: 1, y: 30, rotation: 0 as const, locked: false };
    const maisonB = { uid: "m", defId: "g3145", x: 6, y: 11, rotation: 0 as const, locked: false };
    const routes = [...Array.from({ length: w }, (_, i) => ({ x: 1 + i, y: 29 })), { x: 5, y: 20 }, { x: 5, y: 12 }];
    const r = repairRoadConnectivity(g, [kontor, maisonB], routes, lookup, 10, () => false);
    expect(r.stranded).toEqual([]);
    expect(r.added).toBe(8 + 7);
    const layout = { grid: g, buildings: [kontor, maisonB], roads: r.roads, fields: [] };
    const { set } = rootedRoadSet(layout, lookup);
    expect(roadConnected(layout, lookup, maisonB, set)).toBe(true);
  });
});

describe("réparation : raccorder le bâtiment, pas seulement son îlot", () => {
  it("un service dont la route part du mauvais côté est raccordé par son autre côté", () => {
    // le service (12, 5) 2 × 2 n'a qu'une route, à l'est (14, 5-6), dans un cul-de-sac muré ;
    // à l'ouest, le noyau (route x = 9, reliée au comptoir) est à 2 cases
    const kdef = pickKontorDef(catalog, "Roman")!;
    const { w } = footprintSize(kdef, 0);
    const svc = { ...catalog.find((d) => d.id === "g3145")!, id: "svc", size: { w: 2, h: 2 }, needsRoad: true };
    const lk = makeLookup([...catalog, svc]);
    const g = makeGrid(30, 20);
    for (const [x, y] of [[14, 4], [14, 7], [15, 5], [15, 6]]) g.usable[y * 30 + x] = false;
    const kontor = { uid: "k", defId: kdef.id, x: 1, y: 10, rotation: 0 as const, locked: false };
    const service = { uid: "s", defId: "svc", x: 12, y: 5, rotation: 0 as const, locked: false };
    const routes = [
      ...Array.from({ length: Math.max(w, 9) }, (_, i) => ({ x: 1 + i, y: 9 })),
      ...[5, 6, 7, 8].map((y) => ({ x: 9, y })),
      { x: 14, y: 5 }, { x: 14, y: 6 },
    ];
    const r = repairRoadConnectivity(g, [kontor, service], routes, lk, 24, () => false);
    expect(r.stranded).toEqual([]);
    expect(r.added).toBe(2);
    const layout = { grid: g, buildings: [kontor, service], roads: r.roads, fields: [] };
    const { set } = rootedRoadSet(layout, lk);
    expect(roadConnected(layout, lk, service, set)).toBe(true);
  });
});

describe("réparation : une route en coin du comptoir n'est pas un raccordement", () => {
  it("l'îlot qui ne touche le comptoir que par un coin est raccroché, pas compté relié", () => {
    // noyau : la route qui longe le côté haut du comptoir ; îlot : une case EN COIN (bas-droit),
    // qui dessert une maison. Le jeu ne raccorde pas par un coin.
    const kdef = pickKontorDef(catalog, "Roman")!;
    const { w, h } = footprintSize(kdef, 0);
    const g = makeGrid(40, 30);
    const kontor = { uid: "k", defId: kdef.id, x: 5, y: 5, rotation: 0 as const, locked: false };
    const coin = { x: 5 + w, y: 5 + h };
    const maison = { uid: "m", defId: "g3145", x: 6 + w, y: 5 + h, rotation: 0 as const, locked: false };
    const routes = [...Array.from({ length: w }, (_, i) => ({ x: 5 + i, y: 4 })), coin];
    const r = repairRoadConnectivity(g, [kontor, maison], routes, lookup, 24, () => false);
    expect(r.added).toBeGreaterThan(0);
    const layout = { grid: g, buildings: [kontor, maison], roads: r.roads, fields: [] };
    const { set } = rootedRoadSet(layout, lookup);
    expect(roadConnected(layout, lookup, maison, set)).toBe(true);
  });
});
