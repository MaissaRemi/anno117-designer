import { describe, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { planIslandImport, type IslandPlanRequest } from "./islandPlan";
import { economy, worldOf } from "../economy/economy";
import { SHRINE_TYPE } from "../economy/attributes";
import { regionOfIsland } from "../data/islands";
import { hasHeights, heightsOf } from "../data/terrain";
import { SHRINE_PERMIT } from "../economy/uniques";

/** SONDE TEMPORAIRE — à supprimer. Cherche un plan portant plus d'un dieu distinct. */

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
/** Catalogue dont les sanctuaires ont PERDU leur `uniqueType` (catalogue périmé simulé). */
const catalogNoUniq = catalog.map((d) =>
  (d.uniqueType === SHRINE_TYPE ? { ...d, uniqueType: undefined } : d));

const topTierOf = (world: string) =>
  [...economy.tiers].filter((t) => t.residenceId && worldOf(t.region) === world)
    .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const ISLANDS = (env.PROBE_ISLANDS ?? "roman_island_medium_01,celtic_island_large_07").split(",");

interface Cfg {
  name: string;
  req: Partial<IslandPlanRequest>;
  /** catalogue amputé de `uniqueType` sur les sanctuaires */
  noUniq?: boolean;
  /** palier de l'AUTRE monde (monde de l'UI ≠ région de l'île) */
  crossWorld?: boolean;
}

const BASE = { exploitSlots: true, localProduction: true, autoTier: true, needMode: "all" as const };

const ALL_CFG: Cfg[] = [
  { name: "std-0.8", req: { ...BASE, coverageFloor: 0.8 } },
  { name: "std-0.5", req: { ...BASE, coverageFloor: 0.5 } },
  { name: "p2-0.8", req: { ...BASE, coverageFloor: 0.8, permits: { [SHRINE_PERMIT]: 2 } } },
  { name: "p2-0.5", req: { ...BASE, coverageFloor: 0.5, permits: { [SHRINE_PERMIT]: 2 } } },
  { name: "p6-0.8", req: { ...BASE, coverageFloor: 0.8, permits: { [SHRINE_PERMIT]: 6 } } },
  { name: "p6-0.5", req: { ...BASE, coverageFloor: 0.5, permits: { [SHRINE_PERMIT]: 6 } } },
  { name: "auto-0.8", req: { ...BASE, needMode: "auto" as const, coverageFloor: 0.8 } },
  { name: "auto-0.5", req: { ...BASE, needMode: "auto" as const, coverageFloor: 0.5 } },
  { name: "cross-0.8", req: { ...BASE, coverageFloor: 0.8 }, crossWorld: true },
  { name: "cross-0.5", req: { ...BASE, coverageFloor: 0.5 }, crossWorld: true },
  { name: "nouniq-0.8", req: { ...BASE, coverageFloor: 0.8 }, noUniq: true },
  { name: "nouniq-0.5", req: { ...BASE, coverageFloor: 0.5 }, noUniq: true },
];

const ONLY = (env.PROBE_ONLY ?? "std-0.8,std-0.5").split(",");
const CONFIGS = ALL_CFG.filter((c) => ONLY.includes(c.name));

describe("sonde — combien de dieux distincts dans un plan", () => {
  for (const islandId of ISLANDS) {
    for (const cfg of CONFIGS) {
      it(`${islandId} · ${cfg.name}`, async () => {
        const raw = buildIslandGrid(islandId);
        if (!raw) { console.log(`>>> ${islandId} | grille introuvable`); return; }
        const grid = downscaleGrid(raw);
        const h = hasHeights(islandId) ? await heightsOf(islandId) : null;
        const heights = h && h.length === grid.w * grid.h ? h : undefined;
        const world = regionOfIsland(islandId);
        const tierWorld = cfg.crossWorld ? (world === "Roman" ? "Celtic" : "Roman") : world;
        const t0 = Date.now();
        const r = planIslandImport({
          catalog: cfg.noUniq ? (catalogNoUniq as BuildingDef[]) : catalog,
          grid, tierGuid: topTierOf(tierWorld).guid, heights,
          ...cfg.req,
        } as IslandPlanRequest);
        const shrines = r.buildings.filter((b) => byId.get(b.defId)?.uniqueType === SHRINE_TYPE);
        const counts = new Map<string, number>();
        for (const b of shrines) counts.set(b.defId, (counts.get(b.defId) ?? 0) + 1);
        const detail = counts.size
          ? [...counts.entries()]
            .map(([id, n]) => `${byId.get(id)?.name ?? id} x${n}`)
            .sort()
            .join(", ")
          : "aucun";
        const label = `exploitSlots+localProduction+autoTier, needMode=${cfg.req.needMode},`
          + ` seuil=${cfg.req.coverageFloor}`
          + (cfg.req.permits ? `, permis=${JSON.stringify(cfg.req.permits)}` : "")
          + (cfg.crossWorld ? `, palier ${tierWorld} sur île ${world}` : "")
          + (cfg.noUniq ? ", catalogue SANS uniqueType sur les sanctuaires" : "");
        console.log(
          `>>> ${islandId} | ${cfg.name} | ${label} | palier=${r.tierName}`
          + ` | DIEUX_DISTINCTS=${counts.size} | total_sanctuaires=${shrines.length}`
          + ` | ${detail} | habitants=${r.residents} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
      }, 600_000);
    }
  }
});
