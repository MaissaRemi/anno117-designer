import { describe, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { makeLookup } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { economy, worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import { hasHeights, heightsOf } from "../data/terrain";
import { planIslandImport, type IslandPlanRequest } from "./islandPlan";
import { checkPlan } from "./invariants";
import { planQuality, roleOf } from "./planQuality";

/**
 * BALAYAGE DE QUALITÉ — sauté sauf `QUALITY=1`.
 *
 * Il fait tourner le plan d'île AVEC LES RÉGLAGES PAR DÉFAUT DE L'INTERFACE (palier sommet du
 * monde, recette auto, seuil 80 %, hauteurs chargées) et imprime ce que devient le sol. C'est
 * l'instrument de la refonte (`docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`) :
 * chaque étape se juge sur ce tableau, avant et après.
 *
 *   QUALITY_ISLANDS  liste d'îles séparées par des virgules (défaut : l'échantillon ci-dessous)
 *   QUALITY_OPTS     options de requête en JSON, ajoutées aux défauts — ex. '{"tolerance":1}'
 *   QUALITY_OUT      dossier où écrire chaque plan en JSON, à rendre avec tools/render_plan.py
 *   QUALITY_TAG      préfixe des fichiers écrits (défaut « plan »)
 *
 *   QUALITY=1 QUALITY_OUT=/tmp/plans pnpm vitest run src/optimizer/planQuality.sweep.test.ts
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const ON = !!env.QUALITY;

/** Deux mondes, toutes les tailles, et les îles qui ont chacune révélé un défaut. */
const ECHANTILLON = [
  "roman_island_small_01",
  "roman_island_medium_01",
  "roman_island_medium_05",
  "roman_island_large_03",
  "celtic_island_small_01",
  "celtic_island_medium_04",
  "celtic_island_large_07",
];

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const topTier = (id: string) => [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === worldOf(regionOfIsland(id)))
  .sort((a, b) => b.capacityDefault - a.capacityDefault)[0]!;

interface NodeFs {
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
}

describe.skipIf(!ON)("balayage de qualité des plans", () => {
  it("imprime l'usage du sol, réglages par défaut de l'interface", async () => {
    const ids = env.QUALITY_ISLANDS ? env.QUALITY_ISLANDS.split(",") : ECHANTILLON;
    const extra = (env.QUALITY_OPTS ? JSON.parse(env.QUALITY_OPTS) : {}) as Partial<IslandPlanRequest>;
    const out = env.QUALITY_OUT;
    const tag = env.QUALITY_TAG ?? "plan";
    // module chargé par chaîne : le projet n'embarque pas les types de Node
    const nodeFs = "node:fs";
    const fs = out ? (await import(/* @vite-ignore */ nodeFs)) as NodeFs : null;
    fs?.mkdirSync(out!, { recursive: true });

    console.log(`options : ${JSON.stringify(extra)}`);
    console.log("île | ms | maisons | habitants | viable | svc/maison | maisons% svc% routes% vide% | suspects");
    for (const id of ids) {
      const raw = buildIslandGrid(id);
      if (!raw) { console.log(`${id} | grille introuvable`); continue; }
      const grid = downscaleGrid(raw);
      const h = hasHeights(id) ? await heightsOf(id) : null;
      const heights = h && h.length === grid.w * grid.h ? h : undefined;
      const tier = topTier(id);
      const t0 = performance.now();
      const r = planIslandImport({
        catalog, grid, tierGuid: tier.guid, coverageFloor: 0.8, needMode: "auto", heights, ...extra,
      });
      const ms = Math.round(performance.now() - t0);
      const q = planQuality(r, grid, lookup);
      const v = checkPlan(r, { islandId: id, grid, lookup, askedTier: tier.guid });
      const fautes = v.filter((x) => x.severity === "faute").map((x) => x.rule);
      const suspects = v.filter((x) => x.severity === "suspect").map((x) => x.rule);
      console.log([
        id, ms, r.houses, r.residents, r.viable ? "oui" : "non", q.servicesPerHouse,
        `${q.pct.residence} ${q.pct.service} ${q.pct.roads} ${q.pct.free}`,
        [...fautes.map((f) => `FAUTE:${f}`), ...suspects].join(",") || "—",
      ].join(" | "));

      if (fs) {
        fs.writeFileSync(`${out}/${tag}-${id}.json`, JSON.stringify({
          id, tier: r.tierName, w: grid.w, h: grid.h,
          usable: grid.usable.map((u) => (u ? "1" : "0")).join(""),
          buildings: r.buildings.flatMap((b) => {
            const d = lookup(b.defId);
            if (!d) return [];
            const fp = footprintSize(d, b.rotation);
            return [{ x: b.x, y: b.y, w: fp.w, h: fp.h, role: roleOf(d), name: d.name }];
          }),
          roads: r.roads.map((p) => [p.x, p.y]),
          fields: r.fields.map((p) => [p.x, p.y]),
          aqueducts: r.aqueducts.map((p) => [p.x, p.y]),
          quality: q,
        }));
      }
    }
  }, 3_600_000);
});
