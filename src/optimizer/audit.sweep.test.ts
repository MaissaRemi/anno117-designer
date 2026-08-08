import { describe, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildIslandGrid } from "../data/islandGrid";
import { downscaleGrid } from "./halfTileAdapter";
import { makeLookup } from "../engine/rules";
import { economy, worldOf } from "../economy/economy";
import { islands, regionOfIsland } from "../data/islands";
import { hasHeights, heightsOf } from "../data/terrain";
import { planIslandImport } from "./islandPlan";
import { checkPlan, groupByRule, type Violation } from "./invariants";

/**
 * BALAYAGE D'AUDIT — sauté sauf `AUDIT=1`.
 *
 * Il ne fait échouer personne : il IMPRIME l'inventaire des violations d'invariants sur une
 * large étendue d'îles. Le filet permanent, lui, est `invariants.test.ts`, borné et bloquant.
 *
 * Deux passes :
 *  - LARGE, toutes les îles au palier sommet, sans options : cherche l'ÉTENDUE. Une règle qui
 *    casse sur quarante îles est structurelle.
 *  - PROFONDE, quelques îles à trois paliers et deux jeux d'options : cherche les
 *    INTERACTIONS, là où vivaient les défauts des ateliers et des emplacements.
 *
 * `AUDIT_LIMIT` borne le nombre d'îles de la passe large (mise au point).
 */
const AUDIT = !!(globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.AUDIT;
const LIMIT = Number(
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.AUDIT_LIMIT ?? "999",
);

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);

const laddersOf = (islandId: string) => [...economy.tiers]
  .filter((t) => t.residenceId && worldOf(t.region) === worldOf(regionOfIsland(islandId)))
  .sort((a, b) => a.capacityDefault - b.capacityDefault);

const log = (m: string) => {
  console.log(m);
};

async function sweep(
  ids: string[],
  tiersOf: (id: string) => { guid: string; name: string }[],
  opts: { exploitSlots?: boolean; localProduction?: boolean }[],
): Promise<Violation[]> {
  const all: Violation[] = [];
  let done = 0;
  for (const id of ids) {
    const raw = buildIslandGrid(id);
    if (!raw) { log(`  ⚠ ${id} : grille introuvable`); continue; }
    const grid = downscaleGrid(raw);
    const h = hasHeights(id) ? await heightsOf(id) : null;
    const heights = h && h.length === grid.w * grid.h ? h : undefined;
    for (const t of tiersOf(id)) {
      for (const o of opts) {
        try {
          const r = planIslandImport({
            catalog, grid, tierGuid: t.guid, coverageFloor: 1, heights, ...o,
          });
          all.push(...checkPlan(r, { islandId: id, grid, lookup, askedTier: t.guid }));
        } catch (e) {
          all.push({
            rule: "plan-leve-une-exception", severity: "faute", island: id,
            detail: `${t.name} : ${(e as Error).message}`,
          });
        }
        done++;
      }
    }
    log(`  … ${id} (${done} plans)`);
  }
  return all;
}

function report(title: string, all: Violation[], plans: number) {
  log(`\n════ ${title} — ${plans} plans, ${all.length} violations ════`);
  const groups = groupByRule(all);
  if (!groups.length) { log("  aucune violation"); return; }
  for (const g of groups) {
    log(`\n[${g.severity.toUpperCase()}] ${g.rule} — ${g.islands} île(s)`);
    for (const e of g.examples) log(`    ${e}`);
  }
}

describe.skipIf(!AUDIT)("balayage d'audit", () => {
  it("passe LARGE : toutes les îles, palier sommet, sans options", async () => {
    const ids = islands.map((i) => i.id).slice(0, LIMIT);
    log(`passe large : ${ids.length} îles`);
    const all = await sweep(ids, (id) => [laddersOf(id).slice(-1)[0]!], [{}]);
    report("PASSE LARGE", all, ids.length);
  }, 7_200_000);

  it("passe PROFONDE : paliers × options sur un échantillon", async () => {
    const sample = [
      "roman_island_medium_01", "roman_island_small_01", "roman_island_large_01",
      "celtic_island_large_07", "celtic_island_medium_04", "celtic_island_small_01",
    ].filter((i) => islands.some((x) => x.id === i));
    log(`passe profonde : ${sample.length} îles`);
    const all = await sweep(
      sample,
      (id) => { const l = laddersOf(id); return [l[0]!, l[Math.floor(l.length / 2)]!, l[l.length - 1]!]; },
      [{}, { exploitSlots: true, localProduction: true }],
    );
    report("PASSE PROFONDE", all, sample.length * 6);
  }, 7_200_000);
});
