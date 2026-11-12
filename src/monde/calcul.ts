import type { BuildingDef, GridShape, Layout, Rotation } from "../model/types";
import { footprintSize, partieEauPosee } from "../engine/geometry";
import { makeLookup, terrainConvient, type DefLookup } from "../engine/rules";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { buildIslandGrid } from "../data/islandGrid";
import { economy, priceOf, tierByGuid, upkeepOf } from "../economy/economy";
import type { IslandPlanRequest, IslandPlanResult } from "../optimizer/islandPlan";
import type { CommandeRequete } from "../commande/planifierWorker";
import type { ResultatCommande } from "../commande/planifier";
import { FACTEUR_CONSOMMATION, FACTEUR_ENTRETIEN, palierParDefaut, provinceDe, type ConfigurationMonde, type IleDuMonde } from "./configuration";
import {
  besoinsDuDevis, cumulerBudgets, devisIle, fertilitesPourMoteur, nomDuBien, repartir, suggererAchats,
  type BienDebit, type BudgetsPris, type IleProductrice, type OptionsRepartition, type SuggestionAchat,
} from "./repartition";

/**
 * ═══ CALCULER UN MONDE ════════════════════════════════════════════════════════════════
 *
 * Étapes 2 à 4 de la planification globale (`docs/superpowers/specs/2026-10-30-planification-
 * globale-design.md`) :
 *
 *  1. ÎLES PRINCIPALES, en parallèle : des maisons, tous les services, l'objectif du joueur
 *     (argent, habitants ou maisons), les mines sur les emplacements que l'eau laisse libres si
 *     l'île en a le gisement. Elles rendent leur demande de biens.
 *  2. DEMANDE TOTALE : celle des villes, moins ce que leurs mines produisent ; puis la répartition
 *     sur les autres îles à moi, en rebouclant — les ouvriers des îles de production consomment
 *     eux aussi, et une île sans gisement fait venir sa matière d'une autre.
 *  3. POSE RÉELLE des îles de production, en parallèle (moteur de l'île de production) ; ce qui
 *     n'a pas tenu est réparti une fois de plus sur les îles qui ont encore de la place.
 *  4. FLUX entre îles (u/min, sans navires : en régime établi, la cargaison d'un aller-retour
 *     arrive en une fois, le débit à terme est le même), BILAN, et SUGGESTIONS D'ACHAT pour ce
 *     qui manque.
 *
 * RECALCUL INCRÉMENTAL : chaque île porte l'EMPREINTE de ses entrées. Avec le calcul précédent,
 * une île dont l'empreinte n'a pas changé est reprise telle quelle — acheter une île ne relance
 * pas les îles principales, de loin les plus longues.
 *
 * Les moteurs tournent par des `Executeurs` : des Web Workers dans l'application, des appels
 * directs dans les tests.
 */

export interface Executeurs {
  principale(req: IslandPlanRequest): Promise<IslandPlanResult>;
  production(req: CommandeRequete): Promise<ResultatCommande>;
}

export interface PlanPose {
  buildings: Layout["buildings"];
  roads: Layout["roads"];
  fields: Layout["fields"];
  aqueducts: NonNullable<Layout["aqueducts"]>;
  roadType?: Layout["roadType"];
}

export interface IleCalculee {
  cle: string;
  role: "principale" | "production" | "inutilisee";
  /** Empreinte des entrées qui ont produit ce plan (recalcul incrémental). */
  empreinte?: string;
  plan?: PlanPose;
  habitants: number;
  maisons: number;
  /** Argent net par minute : impôts moins entretien. */
  argent?: number;
  palier?: string;
  /** Production : l'objectif posé. Principale : ses mines. */
  produit: BienDebit[];
  /** Principale : sa demande de biens. Production : biens de ses ouvriers, matières importées. */
  consomme: BienDebit[];
  /** Production : ce qui lui a été demandé. */
  affecte: BienDebit[];
  /** Production : cases de terre réellement prises par le plan posé (rattrapage). */
  terrePrise?: number;
  manques: string[];
  avertissements: string[];
}

export interface Flux { de: string; vers: string; good: string; parMinute: number }
export interface Deficit { good: string; parMinute: number; raison: string }

export interface ResultatMonde {
  calculeLe: string;
  iles: IleCalculee[];
  flux: Flux[];
  deficits: Deficit[];
  bilan: { habitants: number; argent: number; maisons: number; surplus: BienDebit[] };
  /** Îles achetables qui couvriraient le plus de ce qui manque. */
  suggestions?: SuggestionAchat[];
  /** Îles reprises du calcul précédent, et îles recalculées. */
  reutilisees?: number;
  recalculees?: number;
  avertissements: string[];
}

export interface OptionsCalcul {
  catalog: BuildingDef[];
  executeurs: Executeurs;
  /** Le calcul précédent de cette configuration : ses îles inchangées sont reprises. */
  precedent?: ResultatMonde;
  /** Nombre de moteurs lancés en même temps. */
  parallelisme?: number;
  onProgres?: (texte: string) => void;
}

/**
 * VERSION DES MOTEURS, dans l'empreinte de chaque île. À augmenter quand un moteur d'île change
 * ce qu'il pose : sans elle un monde déjà calculé reprenait ses anciens plans, et une correction
 * du moteur semblait ne pas avoir pris.
 */
export const VERSION_CALCUL = 4;
/** Tours de rattrapage après la première pose. Chacun repose les îles qui reçoivent du travail. */
const TOURS_RATTRAPAGE = 3;

const arrondi = (v: number) => Math.round(v * 100) / 100;
const versListe = (m: Map<string, number>): BienDebit[] =>
  [...m].filter(([, v]) => v > 0.005).map(([good, v]) => ({ good, parMinute: arrondi(v) })).sort((a, b) => b.parMinute - a.parMinute);
const ajouter = (m: Map<string, number>, l: readonly BienDebit[], k = 1) => {
  for (const b of l) m.set(b.good, (m.get(b.good) ?? 0) + k * b.parMinute);
};

/** Exécute des tâches, `n` à la fois, en gardant l'ordre des résultats. */
async function parallele<T>(taches: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out = new Array<T>(taches.length);
  let i = 0, arret = false;
  const ouvrier = async () => {
    while (i < taches.length && !arret) {
      const k = i++;
      // une tâche qui échoue arrête les suivantes : le calcul est perdu, inutile de le finir
      try { out[k] = await taches[k](); } catch (e) { arret = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, taches.length)) }, ouvrier));
  return out;
}

const compter = (l: readonly boolean[] | undefined, g: GridShape) => {
  let n = 0;
  for (const u of l ?? []) if (u) n++;
  return (g.cellsPerTile ?? 1) === 2 ? Math.round(n / 4) : n;
};
const emplacementsDe = (g: GridShape) => {
  const n: Record<string, number> = {};
  for (const s of g.slots ?? []) n[s.type] = (n[s.type] ?? 0) + 1;
  return n;
};
const plan = (r: { buildings: Layout["buildings"]; roads: Layout["roads"]; fields: Layout["fields"]; aqueducts?: Layout["aqueducts"]; roadType?: Layout["roadType"] }): PlanPose =>
  ({ buildings: r.buildings, roads: r.roads, fields: r.fields, aqueducts: r.aqueducts ?? [], roadType: r.roadType });

/**
 * Combien d'exemplaires d'un bâtiment côtier la côte de l'île accueille, posés seuls et serrés :
 * la règle de terrain de la pose (`terrainConvient` : quai à terre, partie dans l'eau sur l'eau
 * constructible), sans ville ni route. `grid` à l'échelle des moteurs (tuile).
 */
export function capaciteCote(grid: GridShape, d: BuildingDef): number {
  if (!grid.water || !partieEauPosee(d, 0)) return 0;
  const W = grid.w, H = grid.h, occ = new Uint8Array(W * H);
  let n = 0;
  for (const rot of (d.rotatable ? [0, 90, 180, 270] : [0]) as Rotation[]) {
    const { w, h } = footprintSize(d, rot), p = partieEauPosee(d, rot)!;
    // l'emprise et sa partie dans l'eau, débordement compris : deux côtiers ne partagent pas leur eau
    const x0 = Math.min(0, p.x), y0 = Math.min(0, p.y), x1 = Math.max(w, p.x + p.w), y1 = Math.max(h, p.y + p.h);
    for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) {
      // rejet rapide : le premier coin de la partie dans l'eau n'est pas sur l'eau (une île de
      // 512 × 512 demandait une seconde par bâtiment sans lui)
      const ex = x + p.x, ey = y + p.y;
      if (ex >= 0 && ey >= 0 && ex < W && ey < H && !grid.water[ey * W + ex]) continue;
      if (!terrainConvient(grid, d, x, y, rot, 1)) continue;
      let libre = true;
      for (let j = y0; j < y1 && libre; j++) for (let i = x0; i < x1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && occ[yy * W + xx]) { libre = false; break; }
      }
      if (!libre) continue;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) occ[yy * W + xx] = 1;
      }
      n++;
    }
  }
  return n;
}

/**
 * Part de la capacité serrée que la pose tient vraiment : elle prend la place la plus proche de
 * la ville, pas la plus économe, et partage la côte avec le comptoir. Mesuré le 11/11/2026 sur
 * roman_island_large_03 et celtic_island_large_02, dix bâtiments côtiers : 77 à 86 % (marais
 * salants 18 sur 21, cabanes à maquereaux 26 sur 32, salicorne 16 sur 20).
 */
const COTE_TENUE = 0.75;

/** Une île en île de production : ce que la répartition et la pose savent d'elle. */
export function versProductrice(i: IleDuMonde, g: GridShape, lookup: DefLookup): IleProductrice {
  // calculée à la demande : seuls quelques bâtiments côtiers entrent dans un devis
  let tuile: GridShape | undefined;
  const capacites = new Map<string, number>();
  return {
    cle: i.cle, region: provinceDe(i), fertilites: fertilitesPourMoteur(i.fertilites),
    emplacements: emplacementsDe(g), terre: compter(g.usable, g),
    capaciteCote: (id) => {
      let n = capacites.get(id);
      if (n === undefined) {
        const d = lookup(id);
        n = d ? Math.floor(capaciteCote(tuile ??= downscaleGrid(g), d) * COTE_TENUE) : 0;
        capacites.set(id, n);
      }
      return n;
    },
    ...(i.dieu ? { dieu: i.dieu } : {}),
  };
}

/** Ce qu'une pose d'île de production rend, qu'elle vienne d'un moteur ou du calcul précédent. */
interface PoseProduction {
  plan?: PlanPose;
  habitants: number;
  maisons: number;
  argent: number;
  objectif: { good: string; parMinute: number; pose: number }[];
  consomme: BienDebit[];
  /** Cases de terre réellement prises par le plan posé ; absent si le moteur ne le dit pas. */
  terrePrise?: number;
  manques: string[];
  avertissements: string[];
}

/**
 * L'île telle qu'elle est DANS LA PARTIE : sans les emplacements que le générateur de carte n'a
 * pas activés (lus dans une sauvegarde). Données du jeu : les « Slot … » de montagne, rivière et
 * marais sont des objets de carte aléatoires, activés selon le réglage de matières premières ;
 * les « Fixed Slot … » le sont toujours (`ActivateAll`).
 */
export function sansEmplacementsInactifs(g: GridShape, inactifs: readonly string[] | undefined): GridShape {
  if (!inactifs?.length || !g.slots) return g;
  const hors = new Set(inactifs);
  const slots = g.slots.filter((s) => !s.id || !hors.has(s.id));
  return { ...g, slots: slots.length ? slots : undefined };
}

const facteurs = (c: ConfigurationMonde) => ({
  kConso: FACTEUR_CONSOMMATION[c.reglages.consommation] ?? 1,
  kEntretien: FACTEUR_ENTRETIEN[c.reglages.entretien] ?? 1,
});

/** Empreinte des entrées d'une île principale : son plan ne change que si elles changent. */
function empreintePrincipale(c: ConfigurationMonde, ile: IleDuMonde, catalog: BuildingDef[]): string {
  const { kConso, kEntretien } = facteurs(c);
  return JSON.stringify({
    v: VERSION_CALCUL, n: catalog.length, i: ile.ileId, tierGuid: ile.palier ?? palierParDefaut(provinceDe(ile)),
    f: ile.fertilites, d: ile.dieu, o: c.reglages.objectif, r: c.reglages.routes, e: ile.emplacementsInactifs, k: kConso, m: kEntretien,
  });
}

/** Planifie une île en île principale : des maisons, tous les services, l'objectif de la partie. */
async function planifierPrincipale(c: ConfigurationMonde, ile: IleDuMonde, grid: GridShape, o: OptionsCalcul): Promise<IleCalculee> {
  const { kConso, kEntretien } = facteurs(c);
  const f = ile.fertilites;
  const r = await o.executeurs.principale({
    catalog: o.catalog, grid, tierGuid: ile.palier ?? palierParDefaut(provinceDe(ile)),
    coverageFloor: 0.8, needMode: "all", objectif: c.reglages.objectif, roadType: c.reglages.routes,
    // une mine ne se pose que sur un gisement déclaré : sans fertilité cochée, aucune
    exploitSlots: !!f?.length, ...(f?.length ? { islandFertilities: f } : {}),
    ...(ile.dieu ? { dieu: ile.dieu } : {}), devotionSelonFoi: true,
  });
  const produit = new Map<string, number>();
  for (const e of r.exploited) if (e.served) produit.set(e.good, (produit.get(e.good) ?? 0) + e.perMin);
  return {
    cle: ile.cle, role: "principale", empreinte: empreintePrincipale(c, ile, o.catalog), plan: plan(r), habitants: r.residents, maisons: r.houses,
    // L'île principale est posée par le moteur au cran Faible ; ses imports et son entretien
    // suivent les réglages de la partie (la main-d'œuvre de ses services, non : limite connue)
    argent: Math.round(r.money.gross - r.money.upkeep * kEntretien), palier: r.tierName, produit: versListe(produit),
    consomme: r.importGoods.map((b) => ({ good: b.good, parMinute: b.perMin * kConso })), affecte: [],
    manques: [...r.gaps], avertissements: f === null ? ["Fertilités inconnues : aucune mine posée"] : [],
  };
}

/** Ce que sort une exploitation d'emplacement, au débit de base. */
function debitDe(defId: string): BienDebit | null {
  const p = economy.buildingProd[defId];
  const sortie = p?.outputs?.[0];
  return p?.cycleTime && sortie?.good ? { good: sortie.good, parMinute: (sortie.amount / p.cycleTime) * 60 } : null;
}

/**
 * ═══ LES MINES DES ÎLES PRINCIPALES SUIVENT CE QUI MANQUE AU MONDE ═════════════════════
 *
 * Le moteur d'île choisit ses exploitations au PRIX DE VENTE, sans rien savoir du monde : une
 * île principale minait de l'or pendant que les ateliers manquaient de minéraux. Ici, chaque
 * exploitation posée devient celle du bien qui manque le plus (`manque`, ce que le monde ne
 * couvre pas quand les îles principales n'extraient rien), pesé par son prix.
 *
 * On ne touche pas au plan : on échange un bâtiment contre un autre de MÊME emplacement, même
 * emprise et même main-d'œuvre, dont le gisement est déclaré sur l'île. Rien ne manque : le
 * choix du moteur reste. Le résultat ne dépend pas du bâtiment de départ (recalcul stable).
 */
export function reaffecterMines(
  principales: IleCalculee[], manque: Record<string, number>, c: ConfigurationMonde,
  catalog: BuildingDef[], lookup: DefLookup, kEntretien = 1,
): IleCalculee[] {
  const reste = { ...manque };
  const ouvriers = (d: BuildingDef) => JSON.stringify(economy.buildingWorkforce[d.id] ?? []);
  return principales.map((ile) => {
    const fertilites = new Set(c.iles.find((x) => x.cle === ile.cle)?.fertilites ?? []);
    const exploitations = (ile.plan?.buildings ?? []).filter((b) => lookup(b.defId)?.slotType && debitDe(b.defId));
    // le plan et ses mines comptées doivent s'accorder (une exploitation non servie ne compte pas)
    const compte = exploitations.reduce((s, b) => s + debitDe(b.defId)!.parMinute, 0);
    if (!exploitations.length || Math.abs(compte - ile.produit.reduce((s, b) => s + b.parMinute, 0)) > 0.05) return ile;
    const nouveau = new Map<string, string>(); // uid → bâtiment retenu
    for (const b of exploitations) {
      const d = lookup(b.defId)!;
      let meilleur = d, valeur = 0;
      for (const x of catalog) {
        const sortie = debitDe(x.id);
        const gisement = economy.buildingProd[x.id]?.fertility;
        if (!sortie || x.slotType !== d.slotType || x.region !== d.region || x.size.w !== d.size.w || x.size.h !== d.size.h
          || ouvriers(x) !== ouvriers(d) || (gisement && !fertilites.has(gisement))) continue;
        const v = Math.min(sortie.parMinute, reste[sortie.good] ?? 0) * priceOf(sortie.good);
        if (v > valeur || (v === valeur && v > 0 && x.id < meilleur.id)) { meilleur = x; valeur = v; }
      }
      const sortie = debitDe(meilleur.id)!;
      if (valeur > 0) reste[sortie.good] -= sortie.parMinute;
      nouveau.set(b.uid, meilleur.id);
    }
    if (exploitations.every((b) => nouveau.get(b.uid) === b.defId)) return ile;
    const produit = new Map<string, number>();
    let entretien = 0;
    for (const b of exploitations) {
      const id = nouveau.get(b.uid)!;
      ajouter(produit, [debitDe(id)!]);
      entretien += upkeepOf(id) - upkeepOf(b.defId);
    }
    return {
      ...ile, produit: versListe(produit),
      plan: { ...ile.plan!, buildings: ile.plan!.buildings.map((b) => (nouveau.has(b.uid) ? { ...b, defId: nouveau.get(b.uid)! } : b)) },
      ...(ile.argent !== undefined ? { argent: Math.round(ile.argent - entretien * kEntretien) } : {}),
    };
  });
}

export interface ConseilPrincipale {
  cle: string;
  habitants: number;
  maisons: number;
  argent: number;
  palier?: string;
  /** Ce que la partie maximise (`reglages.objectif`), pour cette île : c'est le critère du classement. */
  valeur: number;
}

/**
 * ═══ CONSEILLER L'ÎLE PRINCIPALE (exigence E5) ═════════════════════════════════════════
 *
 * Chaque île à moi est planifiée SEULE en île principale, par le moteur qui posera la vraie —
 * aucune estimation —, et les îles sont classées selon l'objectif de la partie (gains,
 * habitants ou maisons), la meilleure d'abord. Les moteurs tournent en parallèle.
 *
 * shortcut: ne pèse pas ce que l'île choisie retire à la production (terre, fertilités), à
 * faire quand deux îles se valent en ville et pas en fertilités.
 */
export async function conseillerPrincipales(c: ConfigurationMonde, o: OptionsCalcul): Promise<ConseilPrincipale[]> {
  const candidates = c.iles.filter((i) => i.propriete === "moi")
    .map((ile) => ({ ile, grid: buildIslandGrid(ile.ileId) }))
    .filter((x): x is { ile: IleDuMonde; grid: GridShape } => !!x.grid);
  let faites = 0;
  const plans = await parallele(candidates.map(({ ile, grid }) => async () => {
    const r = await planifierPrincipale(c, ile, sansEmplacementsInactifs(grid, ile.emplacementsInactifs), o);
    o.onProgres?.(`Île ${++faites}/${candidates.length} essayée en île principale`);
    return r;
  }), o.parallelisme ?? 4);
  const critere = c.reglages.objectif;
  return plans
    .map((r) => {
      const argent = r.argent ?? 0;
      return { cle: r.cle, habitants: r.habitants, maisons: r.maisons, argent, palier: r.palier, valeur: critere === "argent" ? argent : critere === "maisons" ? r.maisons : r.habitants };
    })
    .sort((a, b) => b.valeur - a.valeur || a.cle.localeCompare(b.cle));
}

export async function calculerMonde(c: ConfigurationMonde, o: OptionsCalcul): Promise<ResultatMonde> {
  const lookup = makeLookup(o.catalog);
  const n = o.parallelisme ?? 4;
  const progres = o.onProgres ?? (() => {});
  const avertissements: string[] = [];
  const miennes = c.iles.filter((i) => i.propriete === "moi");
  const principales = miennes.filter((i) => i.role === "principale");
  const autres = miennes.filter((i) => i.role !== "principale");
  const grilles = new Map<string, GridShape>();
  for (const i of c.iles) {
    const g = buildIslandGrid(i.ileId);
    if (g) grilles.set(i.cle, sansEmplacementsInactifs(g, i.emplacementsInactifs));
  }
  if (!principales.length) avertissements.push("Aucune île principale : choisis-en au moins une parmi tes îles");
  const avant = new Map((o.precedent?.iles ?? []).filter((i) => i.empreinte).map((i) => [`${i.cle}|${i.empreinte}`, i]));
  let reutilisees = 0, recalculees = 0;
  // RÉGLAGES DE LA PARTIE. Les données extraites sont au cran Faible : la consommation multiplie
  // les biens des maisons, l'entretien l'argent d'entretien et la main-d'œuvre des bâtiments.
  const { kConso, kEntretien } = facteurs(c);
  const reglagesProd = {
    routes: c.reglages.routes, productiviteGlobale: c.reglages.productiviteGlobale, consommation: kConso, facteurEntretien: kEntretien,
  };

  // ─── 1. ÎLES PRINCIPALES ────────────────────────────────────────────────────────────
  let faites = 0;
  const principalesCalculees = await parallele(principales.map((ile) => async (): Promise<IleCalculee> => {
    const reprise = avant.get(`${ile.cle}|${empreintePrincipale(c, ile, o.catalog)}`);
    if (reprise?.role === "principale") {
      reutilisees++;
      progres(`Île principale ${++faites}/${principales.length} reprise du calcul précédent`);
      return reprise;
    }
    const r = await planifierPrincipale(c, ile, grilles.get(ile.cle)!, o);
    recalculees++;
    progres(`Île principale ${++faites}/${principales.length} calculée`);
    return r;
  }), n);

  const demandeVilles = new Map<string, number>();
  for (const i of principalesCalculees) ajouter(demandeVilles, i.consomme);

  // ─── 2. RÉPARTITION, EN REBOUCLANT SUR LES BESOINS DES ÎLES DE PRODUCTION ───────────
  const productrices = autres.filter((i) => grilles.has(i.cle)).map((i) => versProductrice(i, grilles.get(i.cle)!, lookup));
  for (const i of autres) if (i.fertilites === null) avertissements.push(`${nomIle(i)} : fertilités inconnues, traitée comme sans fertilité`);
  const opts: OptionsRepartition = { catalog: o.catalog, lookup, ...reglagesProd };
  /** La répartition, pour ce que les îles principales extraient (`mines`). */
  const repartirTout = (mines: Map<string, number>) => {
    const net = (m: Map<string, number>) => {
      const d: Record<string, number> = {};
      for (const [g, v] of m) { const r = v - (mines.get(g) ?? 0); if (r > 0.005) d[g] = r; }
      return d;
    };
    let demande = new Map(demandeVilles);
    let rep = repartir(net(demande), productrices, opts);
    let stable = !productrices.length;
    for (let tour = 0; tour < 5; tour++) {
      const suivante = new Map(demandeVilles);
      for (const p of productrices) {
        const a = rep.affectation[p.cle];
        if (a?.length) ajouter(suivante, besoinsDuDevis(devisIle(p, a, opts), kConso));
      }
      const ecart = [...new Set([...suivante.keys(), ...demande.keys()])]
        .reduce((s, g) => s + Math.abs((suivante.get(g) ?? 0) - (demande.get(g) ?? 0)), 0);
      demande = suivante;
      rep = repartir(net(demande), productrices, opts);
      if (ecart < 0.5) { stable = true; break; }
    }
    return { rep, stable };
  };
  progres("Répartition de la production");
  // Que manque-t-il au monde quand les îles principales n'extraient rien ? Leurs mines
  // extraient alors CELA, et la répartition repart avec ce qu'elles sortent.
  const principalesFinales = principalesCalculees.some((i) => i.produit.length)
    ? reaffecterMines(
      principalesCalculees,
      Object.fromEntries(repartirTout(new Map()).rep.nonCouvert.map((n) => [n.good, n.parMinute])),
      c, o.catalog, lookup, kEntretien,
    )
    : principalesCalculees;
  const mines = new Map<string, number>();
  for (const i of principalesFinales) ajouter(mines, i.produit);
  const iles: IleCalculee[] = [...principalesFinales];
  const { rep, stable } = repartirTout(mines);
  if (!stable) avertissements.push("La répartition n'a pas convergé en cinq tours : les besoins des îles de production sont approchés");

  // ─── 3. POSE RÉELLE, PUIS UN RATTRAPAGE ─────────────────────────────────────────────
  const affectation = new Map(Object.entries(rep.affectation));
  const empreinteProd = (p: IleProductrice) => JSON.stringify({
    v: VERSION_CALCUL, n: o.catalog.length, i: c.iles.find((x) => x.cle === p.cle)!.ileId, e: c.iles.find((x) => x.cle === p.cle)!.emplacementsInactifs,
    f: p.fertilites, d: p.dieu, ...reglagesProd, a: affectation.get(p.cle),
  });
  const empreintes = new Map<string, string>();
  const poser = async (cles: string[]) => {
    let k = 0;
    const res = await parallele(cles.map((cle) => async (): Promise<readonly [string, PoseProduction]> => {
      const p = productrices.find((x) => x.cle === cle)!;
      const empreinte = empreinteProd(p);
      empreintes.set(cle, empreinte);
      const reprise = avant.get(`${cle}|${empreinte}`);
      if (reprise?.role === "production") {
        reutilisees++;
        progres(`Île de production ${++k}/${cles.length} reprise du calcul précédent`);
        return [cle, {
          plan: reprise.plan, habitants: reprise.habitants, maisons: reprise.maisons, argent: reprise.argent ?? 0,
          consomme: reprise.consomme, terrePrise: reprise.terrePrise,
          manques: reprise.manques, avertissements: reprise.avertissements,
          objectif: reprise.affecte.map((a) => ({ ...a, pose: reprise.produit.find((x) => x.good === a.good)?.parMinute ?? 0 })),
        }] as const;
      }
      const r = await o.executeurs.production({
        grid: grilles.get(cle)!, catalog: o.catalog,
        commande: {
          region: p.region, maisons: [], objectif: affectation.get(cle)!, routes: c.reglages.routes,
          fertilites: p.fertilites,
          ...(c.reglages.productiviteGlobale ? { productivite: { globale: c.reglages.productiviteGlobale } } : {}),
          ...(p.dieu ? { dieu: p.dieu } : {}),
          ...(kEntretien !== 1 ? { facteurEntretien: kEntretien } : {}),
        },
      });
      recalculees++;
      progres(`Île de production ${++k}/${cles.length} posée`);
      // LES BESOINS SUIVENT CE QUI EST POSÉ. Le devis chiffre les biens des ouvriers et les
      // matières à faire venir pour TOUT l'objectif ; une île qui n'en pose que le tiers n'en
      // consomme que le tiers. Les compter en entier creusait le manque du monde : acheter une
      // île dont la côte refuse les marais salants l'augmentait au lieu de le réduire.
      const demande = r.objectif.reduce((s, ob) => s + ob.parMinute, 0);
      const part = demande > 0 ? Math.min(1, r.objectif.reduce((s, ob) => s + ob.pose, 0) / demande) : 1;
      const consomme = new Map<string, number>();
      for (const b of r.nomenclature.biens) if (b.source === "import") consomme.set(b.good, (consomme.get(b.good) ?? 0) + b.parMinute * part * kConso);
      for (const b of r.imports) consomme.set(b.good, (consomme.get(b.good) ?? 0) + b.parMinute * part);
      return [cle, {
        plan: plan(r), habitants: r.habitants, maisons: Object.values(r.maisonsParPalier).reduce((a, b) => a + b, 0),
        argent: Math.round(r.argent.impots - r.argent.entretien * kEntretien),
        objectif: r.objectif.map((ob) => ({ good: ob.good, parMinute: ob.parMinute, pose: ob.pose })),
        consomme: versListe(consomme), manques: r.manques, avertissements: r.avertissements,
        ...(r.qualite ? { terrePrise: Math.round((r.qualite.land * (100 - r.qualite.pct.free)) / 100) } : {}),
      }] as const;
    }), n);
    return new Map(res);
  };
  const poses = await poser([...affectation.keys()]);
  // ─── RATTRAPAGE : CE QUI MANQUE AU MONDE TEL QU'IL EST POSÉ ─────────────────────────
  // Consommation moins production, bien par bien, sur les plans RÉELS — ce qu'une île n'a pas
  // tenu, mais aussi les besoins nés de la pose (biens des ouvriers, matières). Le manque repart
  // vers les îles qui ont encore de la place, et l'on recommence quelques tours.
  // Une île est jugée sur sa terre RÉELLEMENT prise, pas sur le devis, et n'est écartée que pour
  // le bien qu'elle n'a pas tenu : une côte saturée n'empêche pas d'y semer du blé. Écartée en
  // bloc au premier bien manqué, toute île qui ratait un côtier sortait du rattrapage, et il ne
  // restait personne à qui confier le reste.
  const pleines = new Set<string>();
  const raisons = new Map(rep.nonCouvert.map((x) => [x.good, x.raison]));
  let pris: BudgetsPris = rep;
  for (let tour = 0; tour < TOURS_RATTRAPAGE; tour++) {
    const solde = new Map<string, number>();
    for (const i of principalesCalculees) { ajouter(solde, i.consomme); ajouter(solde, i.produit, -1); }
    for (const [cle, r] of poses) {
      ajouter(solde, r.consomme);
      for (const ob of r.objectif) {
        solde.set(ob.good, (solde.get(ob.good) ?? 0) - ob.pose);
        if (ob.parMinute - ob.pose > 0.05) pleines.add(`${cle}|${ob.good}`);
      }
      // la terre vraiment prise remplace l'estimation du devis
      if (r.terrePrise !== undefined) pris = { ...pris, terreUtilisee: { ...pris.terreUtilisee, [cle]: r.terrePrise } };
    }
    const manque = Object.fromEntries([...solde].filter(([, v]) => v > 0.05));
    if (!Object.keys(manque).length) break;
    progres(`Rattrapage de ce qui manque (tour ${tour + 1})`);
    const r2 = repartir(manque, productrices, opts, pris, pleines);
    for (const x of r2.nonCouvert) raisons.set(x.good, x.raison);
    const aRefaire = Object.keys(r2.affectation);
    if (!aRefaire.length) break;
    for (const cle of aRefaire) {
      const m = new Map<string, number>();
      ajouter(m, affectation.get(cle) ?? []);
      ajouter(m, r2.affectation[cle]);
      affectation.set(cle, versListe(m));
    }
    // la terre des îles reposées sera relue sur leur nouveau plan ; côte et emplacements se cumulent
    pris = cumulerBudgets(pris, { coteUtilisee: r2.coteUtilisee, placesUtilisees: r2.placesUtilisees });
    for (const [cle, r] of await poser(aRefaire)) poses.set(cle, r);
  }

  for (const i of autres) {
    const r = poses.get(i.cle);
    if (!r) {
      iles.push({ cle: i.cle, role: "inutilisee", habitants: 0, maisons: 0, produit: [], consomme: [], affecte: [], manques: [], avertissements: [] });
      continue;
    }
    iles.push({
      cle: i.cle, role: "production", empreinte: empreintes.get(i.cle), plan: r.plan, habitants: r.habitants, maisons: r.maisons,
      argent: r.argent, produit: r.objectif.filter((ob) => ob.pose > 0).map((ob) => ({ good: ob.good, parMinute: ob.pose })),
      consomme: r.consomme, affecte: affectation.get(i.cle) ?? [], ...(r.terrePrise !== undefined ? { terrePrise: r.terrePrise } : {}),
      manques: r.manques, avertissements: r.avertissements,
    });
  }

  // ─── 4. FLUX ENTRE ÎLES, BILAN, SUGGESTIONS D'ACHAT ─────────────────────────────────
  const offre = new Map<string, Map<string, number>>(); // bien → île → u/min
  const besoin = new Map<string, Map<string, number>>();
  const noter = (t: Map<string, Map<string, number>>, cle: string, l: BienDebit[]) => {
    for (const b of l) {
      const m = t.get(b.good) ?? new Map<string, number>();
      m.set(cle, (m.get(cle) ?? 0) + b.parMinute);
      t.set(b.good, m);
    }
  };
  for (const i of iles) { noter(offre, i.cle, i.produit); noter(besoin, i.cle, i.consomme); }
  const flux: Flux[] = [];
  const deficits: Deficit[] = [];
  const surplus = new Map<string, number>();
  /** Pourquoi ce bien manque : ce que dit la répartition, sinon l'île qui n'a pas tenu sa pose. */
  const raisonDe = (good: string): string => {
    const dite = raisons.get(good);
    if (dite) return dite;
    const courtes = [...poses].filter(([, r]) => r.objectif.some((ob) => ob.good === good && ob.parMinute - ob.pose > 0.05))
      .map(([cle]) => nomIle(c.iles.find((x) => x.cle === cle)!));
    return courtes.length
      ? `objectif non tenu à la pose sur ${courtes.join(", ")}`
      : "besoin né de la pose (ouvriers ou matières d'une île de production), resté sans île";
  };
  for (const good of new Set([...offre.keys(), ...besoin.keys()])) {
    const prod = offre.get(good) ?? new Map<string, number>();
    const cons = besoin.get(good) ?? new Map<string, number>();
    // une île se sert d'abord elle-même : pas de route pour ce qu'elle consomme de sa production
    for (const [cle, v] of cons) {
      const p = prod.get(cle) ?? 0;
      const pris = Math.min(p, v);
      if (pris > 0) { prod.set(cle, p - pris); cons.set(cle, v - pris); }
    }
    const producteurs = [...prod].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [vers, v0] of [...cons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      let v = v0;
      for (const p of producteurs) {
        if (v <= 0.005) break;
        const q = Math.min(v, p[1]);
        if (q <= 0.005) continue;
        flux.push({ de: p[0], vers, good, parMinute: arrondi(q) });
        p[1] -= q;
        v -= q;
      }
      if (v > 0.05) {
        const d = deficits.find((x) => x.good === good);
        if (d) d.parMinute = arrondi(d.parMinute + v);
        else deficits.push({ good, parMinute: arrondi(v), raison: raisonDe(good) });
      }
    }
    const reste = producteurs.reduce((s, p) => s + p[1], 0);
    if (reste > 0.05) surplus.set(good, reste);
  }
  deficits.sort((a, b) => b.parMinute - a.parMinute || nomDuBien(a.good).localeCompare(nomDuBien(b.good)));

  // Ce qui manque, les îles qu'on pourrait acheter le couvriraient-elles ? Jamais celle d'un
  // adversaire ; une île aux fertilités inconnues est estimée sans fertilité, et le dit.
  const achetables = c.iles.filter((i) => (i.propriete === "achetable" || i.propriete === "inconnue") && grilles.has(i.cle));
  const suggestions = deficits.length && achetables.length
    ? suggererAchats(
      Object.fromEntries(deficits.map((d) => [d.good, d.parMinute])),
      achetables.map((i) => ({ ile: versProductrice(i, grilles.get(i.cle)!, lookup), fertilitesInconnues: i.fertilites === null })),
      opts,
    )
    : [];

  return {
    calculeLe: new Date().toISOString(),
    iles,
    flux: flux.sort((a, b) => a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers) || b.parMinute - a.parMinute),
    deficits,
    bilan: {
      habitants: Math.round(iles.reduce((s, i) => s + i.habitants, 0)),
      argent: Math.round(iles.reduce((s, i) => s + (i.argent ?? 0), 0)),
      maisons: iles.reduce((s, i) => s + i.maisons, 0),
      surplus: versListe(surplus),
    },
    suggestions,
    reutilisees,
    recalculees,
    avertissements,
  };
}

/** Nom lisible d'une île de la configuration. */
export const nomIle = (i: Pick<IleDuMonde, "ileId" | "libelle">): string => i.libelle ?? i.ileId;
export const nomPalier = (guid: string): string => tierByGuid(guid)?.name ?? guid;
