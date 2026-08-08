import type { BuildingDef, GridShape } from "../model/types";
import type { ResourceProfile } from "../economy/resources";
import { canProduce } from "../economy/resources";
import { makeLookup } from "../engine/rules";
import { downscaleGrid, scaleResultToHalfTile } from "./halfTileAdapter";
import { planIslandImport, type ImportGood, type IslandPlanResult } from "./islandPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";
import { regionOfIsland } from "../data/islands";
import { economy, worldOf } from "../economy/economy";

export type Role = "population" | "production" | "unused";

export interface IslandInput {
  islandId: string;
  grid: GridShape;
  profile: ResourceProfile;
  pinnedRole?: Role;
  /** Hauteurs quantifiées de l'île — pente des aqueducs. Absentes, le réseau d'eau est
   *  planifié sans vérifier la pente, donc optimiste (cf. `IslandPlanRequest.heights`). */
  heights?: Int8Array;
}

export interface MultiIslandRequest {
  catalog: BuildingDef[];
  islands: IslandInput[];
  tierGuid: string;
  needMode?: "auto" | "all" | "thresholds";
  mode: "dimension" | "place";
  /** Transmis tel quel au planificateur mono-île. */
  coverageFloor?: number;
  exploitSlots?: boolean;
  localProduction?: boolean;
  permits?: Record<string, number>;
}

export interface Assignment {
  islandId: string;
  role: Role;
  residents?: number;
  importGoods?: ImportGood[];
  producedGoods?: string[];
  plan?: IslandPlanResult | ProdPlanResult;
}

export interface MultiIslandResult {
  assignments: Assignment[];
  balance: { good: string; demand: number; covered: boolean }[];
  totalPopulation: number;
  gaps: string[];
}

const regionOf = (id: string): string => regionOfIsland(id);

/** Paliers résidentiels d'un MONDE, du plus petit au plus grand. */
const ladderOf = (world: string) => [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === world)
  .sort((a, b) => a.capacityDefault - b.capacityDefault);

/**
 * PALIER ÉQUIVALENT DANS LE MONDE DE L'ÎLE.
 *
 * La requête ne porte qu'un `tierGuid`, pour toutes les îles à la fois. Il était appliqué tel
 * quel : mêler une île du Latium et une île d'Albion dans un même plan produisait donc une
 * ville ROMAINE sur Albion — résidences et services non constructibles en jeu, et une
 * main-d'œuvre que l'autre monde ne peut pas fournir. Même classe de défaut que les ateliers
 * romains posés sur une île celtique.
 *
 * On traduit par RANG dans l'échelle du monde, borné : le Latium en compte quatre, Albion
 * cinq. Un palier déjà du bon monde est rendu inchangé.
 */
const tierForIsland = (tierGuid: string, islandId: string): string => {
  const asked = economy.tiers.find((t) => t.guid === tierGuid);
  if (!asked) return tierGuid;
  const world = worldOf(regionOf(islandId));
  if (worldOf(asked.region) === world) return tierGuid;
  const from = ladderOf(worldOf(asked.region));
  const to = ladderOf(world);
  if (!from.length || !to.length) return tierGuid;
  const rank = Math.max(0, from.findIndex((t) => t.guid === tierGuid));
  return to[Math.min(rank, to.length - 1)].guid;
};
const landOf = (g: GridShape): number => {
  let n = 0;
  for (const u of g.usable) if (u) n++;
  return n;
};

/**
 * Méta-optimiseur multi-îles (v1, glouton contraint par la producibilité — pas de tonnage,
 * la capacité fine est validée en mode "place"). Réutilise le planner mono-île (planIsland*)
 * comme sous-routine et `resources.canProduce` comme gate. PUR (aucune UI/store).
 */
export function multiIslandPlan(req: MultiIslandRequest): MultiIslandResult {
  const gaps: string[] = [];
  const role: Record<string, Role> = {};
  const producedGoods: Record<string, string[]> = {};
  const popResult: Record<string, IslandPlanResult> = {};
  const prodPrimaryPlan: Record<string, ProdPlanResult> = {};

  // 1. analyse population des îles non épinglées prod/unused (réutilise planIslandImport via
  //    l'adaptateur ½-tuile : downscale grille → moteurs en tuiles → upscale ×2 du résultat,
  //    comme le worker mono-île — sinon les moteurs tournent au mauvais scale).
  const popCandidates = req.islands.filter((i) => i.pinnedRole !== "production" && i.pinnedRole !== "unused");
  for (const isl of popCandidates) {
    const halfTile = (isl.grid.cellsPerTile ?? 1) === 2;
    const r = planIslandImport({
      catalog: req.catalog, grid: downscaleGrid(isl.grid),
      tierGuid: tierForIsland(req.tierGuid, isl.islandId),
      needMode: req.needMode, coverageFloor: req.coverageFloor ?? 0.8,
      heights: isl.heights, exploitSlots: req.exploitSlots,
      localProduction: req.localProduction, permits: req.permits,
    });
    popResult[isl.islandId] = scaleResultToHalfTile(r, halfTile);
  }

  // 2. panier de demande agrégé (biens/min) sur les candidates-pop
  const basket: Record<string, number> = {};
  for (const isl of popCandidates) {
    for (const g of popResult[isl.islandId].importGoods) basket[g.good] = (basket[g.good] || 0) + g.perMin;
  }

  // 3. assigner chaque bien du panier à une île productrice (contrainte ressource DURE)
  const goodsDesc = Object.keys(basket).sort((a, b) => basket[b] - basket[a]);
  for (const good of goodsDesc) {
    const candidates = req.islands.filter(
      (i) => i.pinnedRole !== "population" && i.pinnedRole !== "unused"
        && canProduce(good, i.profile, regionOf(i.islandId)),
    );
    if (!candidates.length) {
      gaps.push(`${good} : non produisible dans la partie → import externe`);
      continue;
    }
    // préférer les îles épinglées "production", puis la plus PETITE (garder les grandes pour la pop)
    candidates.sort((a, b) =>
      (b.pinnedRole === "production" ? 1 : 0) - (a.pinnedRole === "production" ? 1 : 0)
      || landOf(a.grid) - landOf(b.grid)
      || a.islandId.localeCompare(b.islandId));
    const pick = candidates[0].islandId;
    (producedGoods[pick] ||= []).push(good);
    role[pick] = "production";
  }

  // 4. rôles finaux (épinglages prioritaires ; prod si assignée ; sinon pop si résidents, sinon unused)
  for (const isl of req.islands) {
    const id = isl.islandId;
    if (isl.pinnedRole) role[id] = isl.pinnedRole;
    else if (role[id] === "production") { /* gardé */ }
    else role[id] = (popResult[id]?.residents ?? 0) > 0 ? "population" : "unused";
  }

  // 5. placement optionnel : bien PRIMAIRE (plus forte demande) de chaque île prod
  if (req.mode === "place") {
    for (const isl of req.islands) {
      if (role[isl.islandId] !== "production") continue;
      const goods = producedGoods[isl.islandId];
      if (!goods?.length) continue;
      const primary = goods[0];
      const halfTile = (isl.grid.cellsPerTile ?? 1) === 2;
      const p = planIslandProduction(
        req.catalog, downscaleGrid(isl.grid), makeLookup(req.catalog), primary, basket[primary] || 10,
        { islandFertilities: isl.profile.fertilities },
      );
      prodPrimaryPlan[isl.islandId] = scaleResultToHalfTile(p, halfTile);
    }
  }

  // 6. sortie
  const assignments: Assignment[] = req.islands.map((isl) => {
    const id = isl.islandId, r = role[id];
    return {
      islandId: id,
      role: r,
      residents: r === "population" ? popResult[id]?.residents : undefined,
      importGoods: r === "population" ? popResult[id]?.importGoods : undefined,
      producedGoods: r === "production" ? (producedGoods[id] ?? []) : undefined,
      plan: r === "population" ? popResult[id] : prodPrimaryPlan[id],
    };
  });
  const totalPopulation = assignments
    .filter((a) => a.role === "population")
    .reduce((s, a) => s + (a.residents ?? 0), 0);
  const covered = new Set(Object.values(producedGoods).flat());
  const balance = goodsDesc.map((good) => ({ good, demand: basket[good], covered: covered.has(good) }));
  return { assignments, balance, totalPopulation, gaps };
}
