import type { BuildingDef, GridShape, Layout, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { rootedRoadSet, roadConnected } from "../engine/rules";
import { planQuality, type PlanQuality } from "../optimizer/planQuality";
import { pruneDeadEnds } from "../optimizer/roadCleanup";
import type { Commande, ImportObjectif, LigneObjectif } from "./nomenclature";
import type { DispositionOpts, LignePosee, PlanQuartiers } from "./disposition";
import { disposerQuartiers } from "./ilots";
import { disposerProduction, type PlanProduction } from "./production";
import { economy, tierByGuid, upkeepOf } from "../economy/economy";
import { workforceGrant } from "../economy/workforce";

/** L'entretien se compte sur les bâtiments réellement posés, comme pour une île principale. */
function argentDe(impots: number, buildings: Layout["buildings"]): Argent {
  const entretien = Math.round(buildings.reduce((s, b) => s + upkeepOf(b.defId), 0));
  return { impots, entretien, net: impots - entretien };
}

export interface MainOeuvre { demande: Record<string, number>; offre: Record<string, number>; manque: Record<string, number> }

/**
 * La main-d'œuvre du plan POSÉ, par palier : ce que réclament les bâtiments posés, ce qu'offrent
 * les maisons posées et le comptoir. Le devis la calculait sur ses propres comptes ; or la pose
 * met plus de services que lui (35 pour 23 sur une petite île), des entrepôts qu'il ignore, et
 * parfois moins de maisons : en jeu, les ateliers tournaient au ralenti sans que le plan le dise.
 */
export function mainOeuvrePosee(
  buildings: Layout["buildings"], habitantsParPalier: Record<string, number>, facteurEntretien = 1,
): MainOeuvre {
  const demande: Record<string, number> = {}, offre: Record<string, number> = {}, manque: Record<string, number> = {};
  for (const b of buildings) {
    for (const w of economy.buildingWorkforce[b.defId] ?? []) demande[w.tier] = (demande[w.tier] ?? 0) + w.amount * facteurEntretien;
    for (const [g, n] of Object.entries(workforceGrant(b.defId))) offre[g] = (offre[g] ?? 0) + n;
  }
  for (const [g, pop] of Object.entries(habitantsParPalier)) offre[g] = (offre[g] ?? 0) + pop * (tierByGuid(g)?.factor ?? 0);
  for (const [g, d] of Object.entries(demande)) {
    const m = Math.ceil(d - (offre[g] ?? 0) - 1e-6);
    if (m > 0) manque[g] = m;
  }
  return { demande, offre, manque };
}

/**
 * ═══ PLANIFIER UNE COMMANDE : LA PORTE D'ENTRÉE ═══════════════════════════════════════
 *
 * Le joueur commande, le moteur dispose. Nomenclature (`nomenclature.ts`), quartiers en îlots
 * (`ilots.ts`), puis production posée autour de la ville (`production.ts`), sur la même île
 * et le même réseau routier. Le résultat est un `Layout` d'île en grille TUILE, et un rapport
 * qui dit, ligne par ligne, ce qui était demandé et ce qui est posé.
 */

/** Un bien de l'objectif, et le débit que le plan POSÉ en tire. */
export interface ObjectifPose extends LigneObjectif {
  /** Débit posé : le produit sur l'île, réduit par le maillon de sa chaîne le moins posé. */
  pose: number;
}

export interface Argent { impots: number; entretien: number; net: number }

export interface PlanCommande {
  layout: Layout;
  quartiers: PlanQuartiers;
  production: PlanProduction;
  /** Toutes les lignes de la nomenclature : demandé, posé. */
  lignes: LignePosee[];
  /** Usage du sol de toute l'île constructible. */
  qualite: PlanQuality;
  /** Objectif de production (île de production) : demandé, produit, posé ; et les imports. */
  objectif: ObjectifPose[];
  imports: ImportObjectif[];
  /** Argent par minute : impôts des maisons, entretien de TOUS les bâtiments posés. */
  argent: Argent;
  /** Main-d'œuvre de ce qui est posé (et non du devis). */
  mainOeuvre: MainOeuvre;
  /** Tout est posé, servi, et relié au comptoir. */
  servi: boolean;
  manques: string[];
  avertissements: string[];
}

/** Emplacements de terrain de l'île, par type. */
export function compterEmplacements(grid: GridShape): Record<string, number> {
  const n: Record<string, number> = {};
  for (const s of grid.slots ?? []) n[s.type] = (n[s.type] ?? 0) + 1;
  return n;
}

export function planifierCommande(
  grid: GridShape,
  commande: Commande,
  catalog: BuildingDef[],
  lookup: DefLookup,
  opts: DispositionOpts = {},
): PlanCommande {
  // L'objectif de production se borne aux emplacements de l'île : ce qui n'y tient pas s'importe.
  if (commande.objectif?.length && !commande.emplacements) commande = { ...commande, emplacements: compterEmplacements(grid) };
  const q = disposerQuartiers(grid, commande, catalog, lookup, opts);
  const W = grid.w;
  const lignesProd = q.nomenclature.lignes
    .filter((l) => l.role === "production")
    .map((l) => ({ defId: l.defId, count: l.nombre }));

  // Une commande sans maison n'a pas de réseau : on amorce une case de route contre le
  // comptoir, pour que la production ait de quoi s'y raccorder.
  let routesVille: RoadTile[] = q.layout.roads;
  const k = q.ile.comptoir;
  if (!routesVille.length && k) {
    const bord: [number, number][] = [];
    for (let i = 0; i < k.w; i++) bord.push([k.x + i, k.y - 1], [k.x + i, k.y + k.h]);
    for (let j = 0; j < k.h; j++) bord.push([k.x - 1, k.y + j], [k.x + k.w, k.y + j]);
    const amorce = bord.find(([x, y]) => x >= 0 && y >= 0 && x < W && y < grid.h && q.ile.base.usable[y * W + x]);
    if (amorce) routesVille = [{ x: amorce[0], y: amorce[1] }];
  }

  const p = disposerProduction(
    grid, q.ile.base, { buildings: q.layout.buildings, roads: routesVille, aqueducts: q.layout.aqueducts },
    lignesProd, catalog, lookup, { region: commande.region, centre: q.ile.centre },
  );

  const buildings = [...q.layout.buildings, ...p.buildings];
  const vus = new Set<number>();
  const roads: RoadTile[] = [];
  for (const r of [...routesVille, ...p.roads]) {
    const c = r.y * W + r.x;
    if (!vus.has(c)) { vus.add(c); roads.push(r); }
  }
  const layout: Layout = {
    grid, buildings, roads: pruneDeadEnds(grid, buildings, roads, lookup).roads,
    fields: [...q.layout.fields, ...p.fields], aqueducts: q.layout.aqueducts ?? [],
    roadType: commande.routes,
  };

  const manques = [...q.manques, ...p.manques];
  // Le verdict d'accès porte sur le plan ENTIER : la production se raccorde au réseau de la
  // ville, la ville au comptoir.
  const { set: racine, hasRoot } = rootedRoadSet(layout, lookup);
  if (hasRoot) {
    const coupes = layout.buildings.filter((b) => !roadConnected(layout, lookup, b, racine));
    const prod = new Set(p.buildings.map((b) => b.uid));
    const coupesProd = coupes.filter((b) => prod.has(b.uid));
    if (coupesProd.length) {
      const noms = [...new Set(coupesProd.map((b) => lookup(b.defId)?.name ?? b.defId))].slice(0, 4);
      manques.push(`${coupesProd.length} bâtiment(s) de production sans accès au comptoir (${noms.join(", ")})`);
    }
  } else if (layout.buildings.length) {
    manques.push("Aucun comptoir : le réseau routier n'a pas de racine");
  }

  // La main-d'œuvre se lit sur ce qui est posé. « Loger » promettait de la loger : ce qui manque
  // est un manque du plan ; « signaler » demandait seulement de le dire.
  const mainOeuvre = mainOeuvrePosee(layout.buildings, q.habitantsParPalier, commande.facteurEntretien);
  const avertissements = [...q.avertissements, ...p.avertissements];
  for (const [g, m] of Object.entries(mainOeuvre.manque)) {
    const texte = `Main-d'œuvre ${tierByGuid(g)?.name ?? g} : ${m} manquante(s) pour ce qui est posé (${Math.round(mainOeuvre.offre[g] ?? 0)} pour ${Math.round(mainOeuvre.demande[g])})`;
    (commande.mainOeuvre === "signaler" ? avertissements : manques).push(texte);
  }

  const posee = new Map(p.lignes.map((l) => [l.defId, l]));
  const objectif: ObjectifPose[] = q.nomenclature.objectif.map((o) => {
    let part = 1;
    for (const id of o.chaine) {
      const l = posee.get(id);
      if (l && l.demande > 0) part = Math.min(part, l.pose / l.demande);
    }
    return { ...o, pose: Math.round(o.produit * part * 100) / 100 };
  });

  return {
    layout,
    quartiers: q,
    production: p,
    objectif,
    imports: q.nomenclature.imports,
    argent: argentDe(q.impots ?? 0, layout.buildings),
    mainOeuvre,
    lignes: [...q.lignes, ...p.lignes],
    qualite: planQuality(layout, grid, lookup),
    servi: manques.length === 0,
    manques,
    avertissements,
  };
}

/**
 * Ce qui traverse la frontière du worker : le plan à poser et le rapport, sans les masques
 * de grille (zone, île) qui pèsent plusieurs centaines de milliers de cases pour rien.
 */
export interface ResultatCommande {
  buildings: Layout["buildings"];
  roads: Layout["roads"];
  fields: Layout["fields"];
  aqueducts: NonNullable<Layout["aqueducts"]>;
  roadType: Layout["roadType"];
  lignes: LignePosee[];
  manques: string[];
  avertissements: string[];
  servi: boolean;
  habitants: number;
  maisonsParPalier: Record<string, number>;
  bilan: Record<string, number>;
  viable: boolean;
  argent: Argent;
  nomenclature: PlanQuartiers["nomenclature"];
  production: { blueprints: number; entrepots: number };
  objectif: ObjectifPose[];
  imports: ImportObjectif[];
  qualite: PlanQuality;
  zone: number;
}

export function resumer(p: PlanCommande): ResultatCommande {
  return {
    buildings: p.layout.buildings,
    roads: p.layout.roads,
    fields: p.layout.fields,
    aqueducts: p.layout.aqueducts ?? [],
    roadType: p.layout.roadType,
    lignes: p.lignes,
    manques: p.manques,
    avertissements: p.avertissements,
    servi: p.servi,
    habitants: p.quartiers.habitants,
    maisonsParPalier: p.quartiers.maisonsParPalier,
    bilan: p.quartiers.bilan,
    viable: p.quartiers.viable,
    argent: p.argent,
    nomenclature: p.quartiers.nomenclature,
    production: { blueprints: p.production.blueprints, entrepots: p.production.entrepots },
    objectif: p.objectif,
    imports: p.imports,
    qualite: p.qualite,
    zone: p.quartiers.zone.cases,
  };
}
