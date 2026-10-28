import type { BuildingDef, GridShape, Layout, RoadTile } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { rootedRoadSet, roadConnected } from "../engine/rules";
import { planQuality, type PlanQuality } from "../optimizer/planQuality";
import { pruneDeadEnds } from "../optimizer/roadCleanup";
import type { Commande } from "./nomenclature";
import type { DispositionOpts, LignePosee, PlanQuartiers } from "./disposition";
import { disposerQuartiers } from "./ilots";
import { disposerProduction, type PlanProduction } from "./production";

/**
 * ═══ PLANIFIER UNE COMMANDE : LA PORTE D'ENTRÉE ═══════════════════════════════════════
 *
 * Le joueur commande, le moteur dispose. Nomenclature (`nomenclature.ts`), quartiers en îlots
 * (`ilots.ts`), puis production posée autour de la ville (`production.ts`), sur la même île
 * et le même réseau routier. Le résultat est un `Layout` d'île en grille TUILE, et un rapport
 * qui dit, ligne par ligne, ce qui était demandé et ce qui est posé.
 */

export interface PlanCommande {
  layout: Layout;
  quartiers: PlanQuartiers;
  production: PlanProduction;
  /** Toutes les lignes de la nomenclature : demandé, posé. */
  lignes: LignePosee[];
  /** Usage du sol de toute l'île constructible. */
  qualite: PlanQuality;
  /** Tout est posé, servi, et relié au comptoir. */
  servi: boolean;
  manques: string[];
  avertissements: string[];
}

export function planifierCommande(
  grid: GridShape,
  commande: Commande,
  catalog: BuildingDef[],
  lookup: DefLookup,
  opts: DispositionOpts = {},
): PlanCommande {
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

  return {
    layout,
    quartiers: q,
    production: p,
    lignes: [...q.lignes, ...p.lignes],
    qualite: planQuality(layout, grid, lookup),
    servi: manques.length === 0,
    manques,
    avertissements: [...q.avertissements, ...p.avertissements],
  };
}
