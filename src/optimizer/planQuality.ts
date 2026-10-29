import type { BuildingDef, GridShape, Layout } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { economy } from "../economy/economy";

/**
 * ═══ QUALITÉ D'UN PLAN : CE QUE LE SOL DEVIENT ════════════════════════════════════════
 *
 * Les invariants vérifient qu'un plan est COHÉRENT — pas de chevauchement, comptoir présent,
 * sommes justes. Ils ne disent pas s'il a du SENS. Mesuré le 2026-10-26 sur
 * `celtic_island_large_07`, réglages par défaut : 313 services pour 245 maisons, 45 % de la
 * terre laissée vide, et aucune violation d'invariant. Le défaut le plus visible du moteur
 * était invisible à toute la suite de tests.
 *
 * Ce module ne juge rien : il compte ce que devient chaque case de terre constructible. Le
 * jugement appartient aux règles `suspect` d'`invariants.ts` et aux balayages.
 *
 * Fonction PURE sur un `Layout` : elle s'applique aussi bien au plan d'île qu'à un blueprint.
 */

/** Rôle d'un bâtiment dans le plan, du point de vue de l'usage du sol. */
export type PlanRole = "residence" | "service" | "production" | "infrastructure";

const RESIDENCES = new Set(economy.tiers.map((t) => t.residenceId).filter((r): r is string => !!r));

/**
 * Rôle d'un bâtiment. L'ordre des tests compte : une résidence n'est jamais autre chose, et un
 * bâtiment d'emplacement (mine, forêt) est de la production même sans sortie déclarée.
 */
export function roleOf(def: BuildingDef): PlanRole {
  if (RESIDENCES.has(def.id)) return "residence";
  if (def.roadRoot || def.template === "Warehouse" || def.template === "AqueductProducerSlot") {
    return "infrastructure";
  }
  if (def.slotType || (economy.buildingProd[def.id]?.outputs?.length ?? 0) > 0) return "production";
  return "service";
}

export interface PlanQuality {
  /** Cases de terre constructible de la grille — le dénominateur de toutes les parts. */
  land: number;
  /** Nombre de bâtiments par rôle. */
  counts: Record<PlanRole, number>;
  /** Services posés par maison. Au-delà de 1, le plan dessert du vide. */
  servicesPerHouse: number;
  /**
   * Part de la terre constructible (0..100) par usage. Une case compte UNE fois, dans le
   * premier usage trouvé : bâtiment, puis champ, puis route, puis conduite. `free` est le reste.
   */
  pct: Record<PlanRole | "roads" | "fields" | "aqueducts" | "free", number>;
}

/** Mesure l'usage du sol d'un plan. Les emprises hors terre (port, slot montagne) ne comptent pas. */
export function planQuality(
  plan: Pick<Layout, "buildings" | "roads" | "fields" | "aqueducts">,
  grid: GridShape,
  lookup: DefLookup,
): PlanQuality {
  const W = grid.w, H = grid.h;
  // 0 = libre ; sinon l'indice de l'usage, dans l'ordre de priorité ci-dessous
  const USES = ["residence", "service", "production", "infrastructure", "fields", "roads", "aqueducts"] as const;
  const code = (u: (typeof USES)[number]) => USES.indexOf(u) + 1;
  const use = new Uint8Array(W * H);
  const mark = (x: number, y: number, u: (typeof USES)[number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const c = y * W + x;
    if (grid.usable[c] && !use[c]) use[c] = code(u);
  };

  const counts: Record<PlanRole, number> = { residence: 0, service: 0, production: 0, infrastructure: 0 };
  for (const b of plan.buildings) {
    const d = lookup(b.defId);
    if (!d) continue;
    const role = roleOf(d);
    counts[role]++;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) mark(b.x + i, b.y + j, role);
  }
  for (const f of plan.fields) mark(f.x, f.y, "fields");
  for (const r of plan.roads) mark(r.x, r.y, "roads");
  for (const a of plan.aqueducts ?? []) mark(a.x, a.y, "aqueducts");

  let land = 0;
  const tiles = new Array<number>(USES.length + 1).fill(0);
  for (let c = 0; c < W * H; c++) {
    if (!grid.usable[c]) continue;
    land++;
    tiles[use[c]]++;
  }
  const pctOf = (n: number) => (land ? Math.round((1000 * n) / land) / 10 : 0);
  const at = (u: (typeof USES)[number]) => pctOf(tiles[code(u)]);
  return {
    land,
    counts,
    servicesPerHouse: counts.residence
      ? Math.round((100 * counts.service) / counts.residence) / 100
      : counts.service ? Infinity : 0,
    pct: {
      residence: at("residence"),
      service: at("service"),
      production: at("production"),
      infrastructure: at("infrastructure"),
      fields: at("fields"),
      roads: at("roads"),
      aqueducts: at("aqueducts"),
      free: pctOf(tiles[0]),
    },
  };
}
