import type { BuildingDef, GridShape, Layout } from "../model/types";
import { makeLookup } from "../engine/rules";
import { buildIslandGrid } from "../data/islandGrid";
import { tierByGuid } from "../economy/economy";
import type { IslandPlanRequest, IslandPlanResult } from "../optimizer/islandPlan";
import type { CommandeRequete } from "../commande/planifierWorker";
import type { ResultatCommande } from "../commande/planifier";
import { palierParDefaut, provinceDe, type ConfigurationMonde, type IleDuMonde } from "./configuration";
import {
  besoinsDuDevis, devisIle, fertilitesPourMoteur, nomDuBien, repartir, suggererAchats,
  type BienDebit, type IleProductrice, type OptionsRepartition, type SuggestionAchat,
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

const arrondi = (v: number) => Math.round(v * 100) / 100;
const versListe = (m: Map<string, number>): BienDebit[] =>
  [...m].filter(([, v]) => v > 0.005).map(([good, v]) => ({ good, parMinute: arrondi(v) })).sort((a, b) => b.parMinute - a.parMinute);
const ajouter = (m: Map<string, number>, l: readonly BienDebit[], k = 1) => {
  for (const b of l) m.set(b.good, (m.get(b.good) ?? 0) + k * b.parMinute);
};

/** Exécute des tâches, `n` à la fois, en gardant l'ordre des résultats. */
async function parallele<T>(taches: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out = new Array<T>(taches.length);
  let i = 0;
  const ouvrier = async () => {
    while (i < taches.length) {
      const k = i++;
      out[k] = await taches[k]();
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

/** Une île en île de production : ce que la répartition et la pose savent d'elle. */
export function versProductrice(i: IleDuMonde, g: GridShape): IleProductrice {
  return {
    cle: i.cle, region: provinceDe(i), fertilites: fertilitesPourMoteur(i.fertilites),
    emplacements: emplacementsDe(g), terre: compter(g.usable, g), cote: compter(g.water, g),
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
  const reglagesProd = { routes: c.reglages.routes, productiviteGlobale: c.reglages.productiviteGlobale };

  // ─── 1. ÎLES PRINCIPALES ────────────────────────────────────────────────────────────
  let faites = 0;
  const principalesCalculees = await parallele(principales.map((ile) => async (): Promise<IleCalculee> => {
    const f = ile.fertilites;
    const tierGuid = ile.palier ?? palierParDefaut(provinceDe(ile));
    const empreinte = JSON.stringify({ i: ile.ileId, tierGuid, f, d: ile.dieu, o: c.reglages.objectif, r: c.reglages.routes, e: ile.emplacementsInactifs });
    const reprise = avant.get(`${ile.cle}|${empreinte}`);
    if (reprise?.role === "principale") {
      reutilisees++;
      progres(`Île principale ${++faites}/${principales.length} reprise du calcul précédent`);
      return reprise;
    }
    const r = await o.executeurs.principale({
      catalog: o.catalog, grid: grilles.get(ile.cle)!, tierGuid,
      coverageFloor: 0.8, needMode: "all", objectif: c.reglages.objectif, roadType: c.reglages.routes,
      // une mine ne se pose que sur un gisement déclaré : sans fertilité cochée, aucune
      exploitSlots: !!f?.length, ...(f?.length ? { islandFertilities: f } : {}),
      ...(ile.dieu ? { dieu: ile.dieu } : {}), devotionSelonFoi: true,
    });
    recalculees++;
    progres(`Île principale ${++faites}/${principales.length} calculée`);
    const produit = new Map<string, number>();
    for (const e of r.exploited) if (e.served) produit.set(e.good, (produit.get(e.good) ?? 0) + e.perMin);
    return {
      cle: ile.cle, role: "principale", empreinte, plan: plan(r), habitants: r.residents, maisons: r.houses,
      argent: r.money.net, palier: r.tierName, produit: versListe(produit),
      consomme: r.importGoods.map((b) => ({ good: b.good, parMinute: b.perMin })), affecte: [],
      manques: [...r.gaps], avertissements: f === null ? ["Fertilités inconnues : aucune mine posée"] : [],
    };
  }), n);

  const demandeVilles = new Map<string, number>();
  const mines = new Map<string, number>();
  for (const i of principalesCalculees) {
    ajouter(demandeVilles, i.consomme);
    ajouter(mines, i.produit);
  }
  const iles: IleCalculee[] = [...principalesCalculees];

  // ─── 2. RÉPARTITION, EN REBOUCLANT SUR LES BESOINS DES ÎLES DE PRODUCTION ───────────
  const productrices = autres.filter((i) => grilles.has(i.cle)).map((i) => versProductrice(i, grilles.get(i.cle)!));
  for (const i of autres) if (i.fertilites === null) avertissements.push(`${nomIle(i)} : fertilités inconnues, traitée comme sans fertilité`);
  const opts: OptionsRepartition = { catalog: o.catalog, lookup, ...reglagesProd };
  const net = (m: Map<string, number>) => {
    const d: Record<string, number> = {};
    for (const [g, v] of m) { const r = v - (mines.get(g) ?? 0); if (r > 0.005) d[g] = r; }
    return d;
  };
  progres("Répartition de la production");
  let demande = new Map(demandeVilles);
  let rep = repartir(net(demande), productrices, opts);
  for (let tour = 0; tour < 5; tour++) {
    const suivante = new Map(demandeVilles);
    for (const p of productrices) {
      const a = rep.affectation[p.cle];
      if (a?.length) ajouter(suivante, besoinsDuDevis(devisIle(p, a, opts)));
    }
    const ecart = [...new Set([...suivante.keys(), ...demande.keys()])]
      .reduce((s, g) => s + Math.abs((suivante.get(g) ?? 0) - (demande.get(g) ?? 0)), 0);
    demande = suivante;
    rep = repartir(net(demande), productrices, opts);
    if (ecart < 0.5) break;
  }

  // ─── 3. POSE RÉELLE, PUIS UN RATTRAPAGE ─────────────────────────────────────────────
  const affectation = new Map(Object.entries(rep.affectation));
  const empreinteProd = (p: IleProductrice) => JSON.stringify({
    i: c.iles.find((x) => x.cle === p.cle)!.ileId, e: c.iles.find((x) => x.cle === p.cle)!.emplacementsInactifs,
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
          consomme: reprise.consomme,
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
      for (const b of r.nomenclature.biens) if (b.source === "import") consomme.set(b.good, (consomme.get(b.good) ?? 0) + b.parMinute * part);
      for (const b of r.imports) consomme.set(b.good, (consomme.get(b.good) ?? 0) + b.parMinute * part);
      return [cle, {
        plan: plan(r), habitants: r.habitants, maisons: Object.values(r.maisonsParPalier).reduce((a, b) => a + b, 0),
        argent: r.argent.net,
        objectif: r.objectif.map((ob) => ({ good: ob.good, parMinute: ob.parMinute, pose: ob.pose })),
        consomme: versListe(consomme), manques: r.manques, avertissements: r.avertissements,
      }] as const;
    }), n);
    return new Map(res);
  };
  const poses = await poser([...affectation.keys()]);
  // ce que la pose n'a pas tenu repart, une fois, vers les îles qui ont encore de la place
  const manque = new Map<string, number>();
  const pleines = new Set<string>();
  for (const [cle, r] of poses) {
    for (const ob of r.objectif) {
      const m = ob.parMinute - ob.pose;
      if (m > 0.05) { manque.set(ob.good, (manque.get(ob.good) ?? 0) + m); pleines.add(cle); }
    }
  }
  let nonCouvert = rep.nonCouvert;
  if (manque.size) {
    progres("Rattrapage de ce qui n'a pas tenu");
    const r2 = repartir(Object.fromEntries(manque), productrices, opts, rep.terreUtilisee, pleines);
    const aRefaire: string[] = [];
    for (const [cle, l] of Object.entries(r2.affectation)) {
      const m = new Map<string, number>();
      ajouter(m, affectation.get(cle) ?? []);
      ajouter(m, l);
      affectation.set(cle, versListe(m));
      aRefaire.push(cle);
    }
    if (aRefaire.length) for (const [cle, r] of await poser(aRefaire)) poses.set(cle, r);
    nonCouvert = [...nonCouvert, ...r2.nonCouvert];
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
      consomme: r.consomme, affecte: affectation.get(i.cle) ?? [],
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
  const raisonDe = new Map(nonCouvert.map((x) => [x.good, x.raison]));
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
        else deficits.push({ good, parMinute: arrondi(v), raison: raisonDe.get(good) ?? "production posée insuffisante" });
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
      achetables.map((i) => ({ ile: versProductrice(i, grilles.get(i.cle)!), fertilitesInconnues: i.fertilites === null })),
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
