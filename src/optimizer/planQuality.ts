import type { BuildingDef, GridShape, Layout } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { planningRange, type RoadType } from "../engine/roads";
import { economy } from "../economy/economy";
import { estEntrepot } from "./kontor";

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
  if (def.roadRoot || estEntrepot(def) || def.template === "AqueductProducerSlot") {
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

/**
 * ═══ REGROUPEMENT ET ESPACEMENT DES SERVICES ═══════════════════════════════════════════
 *
 * Exigence de Rémi (`.claude/exigences.md`) : peu de copies d'un même service, espacées selon
 * sa portée, et pas de « pâtés ». Le nombre d'habitants ne la voit pas : mesuré le 2026-11-10,
 * 74 à 90 % des services de « Remplir l'île » étaient dans un pâté, et « Ma commande » répétait
 * la Tour de guet tous les 9 pas pour une portée qui en permet 46 — tous les tests au vert.
 */
export interface Regroupement {
  /** Nombre de services du plan. */
  services: number;
  /** Part (0..100) des services dans un PÂTÉ : trois services ou plus dont les emprises sont à
   *  une case ou moins l'une de l'autre (collées, ou séparées par une seule case de route). */
  enPate: number;
  /** Taille du plus gros pâté. */
  plusGros: number;
  /** Pour chaque type posé au moins deux fois, le plus serré d'abord. */
  parService: {
    defId: string;
    nom: string;
    copies: number;
    /** Distance médiane (L1, de centre à centre) d'une copie à sa plus proche voisine du même type. */
    voisin: number;
    /** Espacement que la portée permet : `2 × (portée − détour du peigne)`, la formule des moteurs. */
    permis: number;
    /** `voisin / permis`. Sous 1, les copies sont plus serrées que la portée ne le demande. */
    rapport: number;
  }[];
  /** Le plus petit `rapport` ; 1 si aucun type n'est posé deux fois. */
  espacement: number;
}

/** Détour moyen sur le peigne de rues, retiré à la portée (`planLattice.effR`, `nomenclature`). */
const DETOUR_PEIGNE = 7;

/** Mesure le regroupement des services d'un plan. Fonction pure, comme `planQuality`. */
export function regroupement(
  plan: Pick<Layout, "buildings">,
  lookup: DefLookup,
  roadType?: RoadType,
): Regroupement {
  const svc = plan.buildings.flatMap((b) => {
    const d = lookup(b.defId);
    if (!d || roleOf(d) !== "service") return [];
    return [{ d, x: b.x, y: b.y, ...footprintSize(d, b.rotation) }];
  });
  const n = svc.length;

  // pâtés : composantes de services à une case ou moins l'un de l'autre
  const chef = svc.map((_, i) => i);
  const racine = (i: number): number => (chef[i] === i ? i : (chef[i] = racine(chef[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = svc[i], b = svc[j];
    const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
    const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
    if (Math.max(dx, dy) <= 1) chef[racine(i)] = racine(j);
  }
  const tailles = new Map<number, number>();
  for (let i = 0; i < n; i++) tailles.set(racine(i), (tailles.get(racine(i)) ?? 0) + 1);
  let enPate = 0, plusGros = 0;
  for (const t of tailles.values()) {
    if (t >= 3) enPate += t;
    if (t > plusGros) plusGros = t;
  }

  // espacement : plus proche voisine du même type, rapportée à ce que la portée permet
  const parType = new Map<string, typeof svc>();
  for (const s of svc) parType.set(s.d.id, [...(parType.get(s.d.id) ?? []), s]);
  const parService: Regroupement["parService"] = [];
  for (const [defId, copies] of parType) {
    const portee = planningRange(copies[0].d, roadType);
    if (copies.length < 2 || portee <= 0) continue;
    const centres = copies.map((c) => [c.x + c.w / 2, c.y + c.h / 2]);
    const proches = centres.map(([x, y], i) => Math.min(...centres
      .filter((_, j) => j !== i).map(([u, v]) => Math.abs(x - u) + Math.abs(y - v)))).sort((a, b) => a - b);
    const m = proches.length >> 1;
    const voisin = proches.length % 2 ? proches[m] : (proches[m - 1] + proches[m]) / 2;
    const permis = 2 * Math.max(8, portee - DETOUR_PEIGNE);
    parService.push({
      defId, nom: copies[0].d.name, copies: copies.length, voisin, permis,
      rapport: Math.round((100 * voisin) / permis) / 100,
    });
  }
  parService.sort((a, b) => a.rapport - b.rapport || a.defId.localeCompare(b.defId));
  return {
    services: n,
    enPate: n ? Math.round((100 * enPate) / n) : 0,
    plusGros,
    parService,
    espacement: parService[0]?.rapport ?? 1,
  };
}
