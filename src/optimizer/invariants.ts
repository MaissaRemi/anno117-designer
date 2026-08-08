import type { BuildingDef, GridShape, Layout } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { roadConnected, rootedRoadSet } from "../engine/rules";
import { footprintSize } from "../engine/geometry";
import { economy, residentialChainExtended, worldOf } from "../economy/economy";
import { regionOfIsland } from "../data/islands";
import { uniqueCap } from "../economy/uniques";
import { VITAL_ATTRS } from "../economy/attributes";
import type { IslandPlanResult } from "./islandPlan";

/**
 * ═══ CE QU'UN PLAN D'ÎLE DOIT RESPECTER ═══════════════════════════════════════════════
 *
 * Les défauts les plus graves de ce moteur n'ont jamais été trouvés par la lecture. Villes
 * romaines sur Albion, 31 bâtiments inactifs sur une île de 67 maisons, `packPlan` éliminé au
 * premier critère faute de garde-fou : tous sont sortis de la MESURE, et trois diagnostics
 * tenus de tête ont été démentis par l'exécution avant que la vraie cause apparaisse.
 *
 * D'où ce module : on écrit ce qu'un plan doit respecter, on le fait tourner largement, et ce
 * qui casse devient un candidat. Chaque règle est nommée, indépendante, et ignore les autres.
 *
 * ⚠ Une règle qui se déclenche signale un CANDIDAT, pas un défaut — la règle peut être
 * fausse. On confirme en lisant le code avant de conclure.
 *
 * Deux gravités :
 *  - `faute`   : le plan est faux ou injouable. La suite de tests doit échouer.
 *  - `suspect` : anomalie qui mérite un regard, sans certitude d'être un défaut.
 */

export type Severity = "faute" | "suspect";

export interface Violation {
  rule: string;
  severity: Severity;
  island: string;
  detail: string;
}

export interface PlanContext {
  islandId: string;
  /** Grille TUILE réellement passée au planificateur (celle des moteurs). */
  grid: GridShape;
  lookup: DefLookup;
  /** Palier demandé par l'appelant — le plan peut légitimement en retenir un autre. */
  askedTier: string;
  permits?: Record<string, number>;
}

const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;

/** Toutes les règles, dans l'ordre du catalogue. */
export function checkPlan(r: IslandPlanResult, ctx: PlanContext): Violation[] {
  const out: Violation[] = [];
  const add = (rule: string, severity: Severity, detail: string) =>
    out.push({ rule, severity, island: ctx.islandId, detail });

  const { lookup, grid } = ctx;
  const W = grid.w, H = grid.h;
  const chain = residentialChainExtended(r.tierGuid);
  const residenceIds = new Set(chain.map((t) => t.residenceId).filter((x): x is string => !!x));
  const defOf = (id: string): BuildingDef | undefined => lookup(id);

  // ═══ COMPTABILITÉ INTERNE ═══════════════════════════════════════════════════════════
  const sumTiers = Object.values(r.tierCounts).reduce((a, b) => a + b, 0);
  if (sumTiers !== r.houses) {
    add("somme-paliers", "faute", `Σ tierCounts = ${sumTiers} mais houses = ${r.houses}`);
  }

  const posed = r.buildings.filter((b) => residenceIds.has(b.defId)).length;
  if (posed !== r.houses) {
    add("residences-posees", "faute", `${posed} résidences dans buildings, houses = ${r.houses}`);
  }

  // Le plan n'expose pas capByTier ; la borne haute reste vérifiable.
  const capOf = (g: string) => economy.tiers.find((t) => t.guid === g)?.capacityDefault ?? 0;
  const maxPop = Object.entries(r.tierCounts).reduce((s, [g, n]) => s + n * capOf(g), 0);
  if (r.residents > maxPop) {
    add("capacite-plafonnee", "faute",
      `${r.residents} habitants pour un maximum théorique de ${maxPop}`);
  }

  const viableAttrs = VITAL_ATTRS.every((k) => (r.attrsTotal[k] ?? 0) >= 0);
  if (viableAttrs !== r.viable) {
    const worst = VITAL_ATTRS.map((k) => `${k}=${(r.attrsTotal[k] ?? 0).toFixed(0)}`).join(" ");
    add("viable-coherent", "faute", `viable=${r.viable} mais attributs ${worst}`);
  }

  if (!near(r.money.net, r.money.gross - r.money.upkeep)) {
    add("argent-coherent", "faute",
      `net=${r.money.net} ≠ brut ${r.money.gross} − entretien ${r.money.upkeep}`);
  }

  const alive = new Set(r.buildings.map((b) => b.uid));
  const ghosts = r.workshops.flatMap((w) => w.razed).filter((u) => alive.has(u));
  if (ghosts.length) {
    add("pas-de-fantome", "faute", `${ghosts.length} bâtiment(s) rasés encore dans le plan`);
  }

  // ═══ JOUABILITÉ EN JEU ══════════════════════════════════════════════════════════════
  const world = worldOf(regionOfIsland(ctx.islandId));
  const alien = r.buildings.filter((b) => {
    const d = defOf(b.defId);
    return !!d?.region && worldOf(d.region) !== world;
  });
  if (alien.length) {
    const names = [...new Set(alien.map((b) => defOf(b.defId)?.name ?? b.defId))].slice(0, 3);
    add("monde-unique", "faute",
      `${alien.length} bâtiment(s) d'un autre monde que l'île (${names.join(", ")})`);
  }

  const tierOfPlan = economy.tiers.find((t) => t.guid === r.tierGuid);
  if (tierOfPlan && worldOf(tierOfPlan.region) !== world) {
    add("palier-du-monde", "faute",
      `palier ${tierOfPlan.name} (${tierOfPlan.region}) sur une île ${world}`);
  }

  const inChain = new Set(chain.map((t) => t.guid));
  for (const g of Object.keys(r.tierCounts)) {
    if (!inChain.has(g)) {
      const t = economy.tiers.find((x) => x.guid === g);
      add("chaine-residentielle", "faute",
        `palier ${t?.name ?? g} hors de la chaîne de ${tierOfPlan?.name ?? r.tierGuid}`);
    }
  }

  // occupation : chevauchement et sol utilisable
  const occ = new Map<number, string>();
  let overlaps = 0, offLand = 0;
  for (const b of r.buildings) {
    const d = defOf(b.defId);
    if (!d) continue;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x < 0 || y < 0 || x >= W || y >= H) { offLand++; continue; }
      const c = y * W + x;
      if (!grid.usable[c]) offLand++;
      if (occ.has(c)) overlaps++; else occ.set(c, b.uid);
    }
  }
  if (overlaps) add("pas-de-chevauchement", "faute", `${overlaps} case(s) occupées deux fois`);
  if (offLand) add("dans-la-grille", "faute", `${offLand} case(s) d'emprise hors sol utilisable`);

  // accès au réseau routier ENRACINÉ au comptoir
  const layout: Layout = { grid, buildings: r.buildings, roads: r.roads, fields: r.fields };
  const { set: rootSet, hasRoot } = rootedRoadSet(layout, lookup);
  if (!hasRoot) {
    add("comptoir-present", "faute", "aucun bâtiment racine : réseau routier sans comptoir");
  } else {
    const cut = r.buildings.filter((b) => {
      const d = defOf(b.defId);
      return !!d && d.needsRoad && !d.roadRoot && !roadConnected(layout, lookup, b, rootSet);
    });
    if (cut.length) {
      const names = [...new Set(cut.map((b) => defOf(b.defId)?.name ?? b.defId))].slice(0, 3);
      add("acces-comptoir", "faute",
        `${cut.length} bâtiment(s) sans accès au réseau du comptoir (${names.join(", ")})`);
    }
  }

  // quota d'unicité PARTAGÉ par uniqueType
  const used = new Map<string, number>();
  for (const b of r.buildings) {
    const t = defOf(b.defId)?.uniqueType;
    if (t) used.set(t, (used.get(t) ?? 0) + 1);
  }
  for (const [t, n] of used) {
    const d = r.buildings.map((b) => defOf(b.defId)).find((x) => x?.uniqueType === t);
    const cap = d ? uniqueCap(d, ctx.permits) : 1;
    if (n > cap) add("quota-unicite", "faute", `${n} exemplaires de type ${t} pour un plafond de ${cap}`);
  }

  // eau : un consommateur déclaré raccordé doit l'être
  if (r.water) {
    const known = new Set(r.buildings.map((b) => b.uid));
    const unknown = r.water.consumers.filter((c) => !known.has(c.uid));
    if (unknown.length) {
      add("eau-coherente", "suspect",
        `${unknown.length} consommateur(s) d'eau absents du plan`);
    }
  }

  // ═══ ÉCHECS SILENCIEUX ══════════════════════════════════════════════════════════════
  if ((r.houses > 0) !== (r.residents > 0)) {
    add("pas-de-zero-silencieux", "faute",
      `houses=${r.houses} mais residents=${r.residents}`);
  }
  if (r.feasible && (r.houses === 0 || r.residents === 0)) {
    add("feasible-coherent", "faute", "plan déclaré faisable sans maison ni habitant");
  }
  if (r.residents > 0 && r.importGoods.length === 0) {
    add("manifeste-non-vide", "suspect", "île peuplée sans aucun bien à acheminer");
  }
  const gaps = r.gaps.join(" | ");
  if (Object.keys(r.workforce.deficit).length && !/[Mm]ain-d'œuvre/.test(gaps)) {
    add("deficit-annonce", "faute", "déficit de main-d'œuvre non signalé dans les trous");
  }
  if (!r.viable && !/n[ée]gatif/i.test(gaps)) {
    add("deficit-annonce", "faute", "bilan d'île négatif non signalé dans les trous");
  }
  if (r.fullyCovered > r.houses) {
    add("cible-coherente", "faute",
      `${r.fullyCovered} maisons au palier cible pour ${r.houses} maisons`);
  }

  return out;
}

/** Regroupe des violations par règle, pour l'inventaire. */
export function groupByRule(all: Violation[]): {
  rule: string; severity: Severity; islands: number; examples: string[];
}[] {
  const by = new Map<string, Violation[]>();
  for (const v of all) {
    const k = `${v.rule}`;
    const l = by.get(k) ?? [];
    l.push(v);
    by.set(k, l);
  }
  const sev = (s: Severity) => (s === "faute" ? 0 : 1);
  return [...by.entries()]
    .map(([rule, vs]) => ({
      rule,
      severity: vs.some((v) => v.severity === "faute") ? ("faute" as Severity) : ("suspect" as Severity),
      islands: new Set(vs.map((v) => v.island)).size,
      examples: vs.slice(0, 2).map((v) => `${v.island} : ${v.detail}`),
    }))
    .sort((a, b) => sev(a.severity) - sev(b.severity) || b.islands - a.islands);
}
