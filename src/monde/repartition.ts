import type { BuildingDef } from "../model/types";
import type { DefLookup } from "../engine/rules";
import type { RoadType } from "../engine/roads";
import { economy, goodName } from "../economy/economy";
import { nomenclature, type Nomenclature } from "../commande/nomenclature";

/**
 * ═══ RÉPARTIR LA DEMANDE D'UN MONDE ENTRE SES ÎLES DE PRODUCTION ══════════════════════
 *
 * Étape 3 de la planification globale (`docs/superpowers/specs/2026-10-30-planification-
 * globale-design.md`). Sur des ESTIMATIONS : le devis d'une île (`nomenclature`) coûte moins
 * d'une milliseconde, on peut donc en faire des centaines avant de lancer la vraie pose.
 *
 * Chaque bien va sur une île de sa province (bâtiments propres à chaque monde) qui sait le
 * produire (fertilité, emplacements), dans la limite de sa terre. Les biens les plus contraints
 * passent d'abord (moins d'îles capables), puis les plus demandés ; chaque bien va d'abord à
 * l'île où il coûte le moins de terre par unité, et se partage entre îles si la place manque.
 */

export interface BienDebit { good: string; parMinute: number }

export interface IleProductrice {
  cle: string;
  region: string;
  /** Fertilités pour le moteur : jamais vide (cf. `fertilitesPourMoteur`). */
  fertilites: string[];
  emplacements: Record<string, number>;
  /** Cases de terre constructible, à l'échelle des moteurs (tuile). */
  terre: number;
  /** Nombre d'exemplaires d'un bâtiment côtier que la côte de l'île accueille (cf.
   *  `capaciteCote`, `calcul.ts`). Un pourcentage de la bande d'eau par province promettait
   *  30 marais salants là où 18 tiennent, et 9 ramasseurs de coques pour 3. */
  capaciteCote: (defId: string) => number;
  dieu?: string;
}

export interface OptionsRepartition {
  catalog: BuildingDef[];
  lookup: DefLookup;
  routes: RoadType;
  productiviteGlobale: number;
  /** Facteur de consommation des maisons (réglage de la partie). Défaut 1. */
  consommation?: number;
  /** Facteur d'entretien : main-d'œuvre des bâtiments (réglage de la partie). Défaut 1. */
  facteurEntretien?: number;
}

/**
 * Les moteurs d'île lisent une liste de fertilités VIDE comme « tout est présent » (convention
 * de « Remplir l'île », où le joueur ne déclare souvent rien). Dans un monde, une île sans
 * fertilité cochée n'en a aucune : on passe alors un GUID qui ne correspond à aucune fertilité.
 * Inconnues (`null`) : traitées comme aucune, le plan le dit.
 */
export const AUCUNE_FERTILITE = "0";
export const fertilitesPourMoteur = (f: string[] | null): string[] => (f && f.length ? f : [AUCUNE_FERTILITE]);

/** Part de la terre qu'une île de production peut vraiment bâtir : routes, côte, formes. 0,65
 *  jusqu'au 12/11 : la pose tenait alors moins (champs en morceaux, lots seuls). Monde d'essai,
 *  terre prise par la pose à 0,65 : 65 à 69 %, toutes les îles bornées par la terre ; à 0,75 :
 *  déficits 68,0 → 55,7 u/min, 99,5 % de l'affecté posé (0,7 : 55,5 en 20 lignes ; 0,8 : 61,6
 *  et la pose ne tient plus que 96,8 %, des cultivateurs de lavande sans place). */
const REMPLISSAGE = 0.75;
/** Emplacements dont le nombre borne une exploitation (le marais ne borne rien). */
const LIMITANTS = ["mountain", "river"] as const;
const EPS = 1e-6;
/** Ce qui manque, selon le budget qui a borné le bien sur le plus d'îles. */
const RAISON_BORNE: Record<string, string> = {
  terre: "plus assez de place sur tes îles de production",
  cote: "plus assez de côte sur tes îles de production : leurs places côtières sont prises",
  mountain: "plus assez d'emplacements de montagne libres sur tes îles de production",
  river: "plus assez d'emplacements de rivière libres sur tes îles de production",
  emplacement: "les emplacements de tes îles de production n'en donnent pas plus",
  pose: "tes îles de production qui le font n'en ont pas tenu plus à la pose",
};

/** Le devis d'une île pour un objectif : bâtiments, ouvriers, biens de leurs maisons, imports. */
export function devisIle(ile: IleProductrice, objectif: BienDebit[], o: OptionsRepartition): Nomenclature {
  return nomenclature({
    region: ile.region, maisons: [], objectif, routes: o.routes,
    fertilites: ile.fertilites, emplacements: ile.emplacements,
    ...(o.productiviteGlobale ? { productivite: { globale: o.productiviteGlobale } } : {}),
    ...(ile.dieu ? { dieu: ile.dieu } : {}),
    ...(o.facteurEntretien && o.facteurEntretien !== 1 ? { facteurEntretien: o.facteurEntretien } : {}),
  }, o.catalog, o.lookup);
}

/** Terre consommée par l'objectif : production et quartiers des ouvriers. */
export const terreDuDevis = (n: Nomenclature): number => n.surface.production + n.surface.quartiers;

/** Ce qu'il faut AUSSI fournir à l'île pour qu'elle tienne son objectif : les biens de ses
 *  ouvriers et les matières premières qu'elle ne peut pas produire. */
export function besoinsDuDevis(n: Nomenclature, consommation = 1): BienDebit[] {
  const m = new Map<string, number>();
  // les biens des maisons ouvrières suivent le réglage de consommation ; les matières, non
  for (const b of n.biens) if (b.source === "import" && b.parMinute > 0) m.set(b.good, (m.get(b.good) ?? 0) + b.parMinute * consommation);
  for (const i of n.imports) m.set(i.good, (m.get(i.good) ?? 0) + i.parMinute);
  return [...m].map(([good, parMinute]) => ({ good, parMinute }));
}

export interface Repartition {
  affectation: Record<string, BienDebit[]>;
  /** Budgets estimés consommés par île : terre (cases), côte (part de 0 à 1), emplacements par type. */
  terreUtilisee: Record<string, number>;
  coteUtilisee: Record<string, number>;
  placesUtilisees: Record<string, Record<string, number>>;
  nonCouvert: { good: string; parMinute: number; raison: string }[];
}

/** Ce qu'une répartition précédente a déjà pris sur les îles (passe de rattrapage). */
export type BudgetsPris = Partial<Pick<Repartition, "terreUtilisee" | "coteUtilisee" | "placesUtilisees">>;

/** Cumule les budgets pris par deux répartitions successives. */
export function cumulerBudgets(a: BudgetsPris, b: BudgetsPris): Required<BudgetsPris> {
  const somme = (x: Record<string, number> = {}, y: Record<string, number> = {}) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const places: Record<string, Record<string, number>> = {};
  for (const cle of new Set([...Object.keys(a.placesUtilisees ?? {}), ...Object.keys(b.placesUtilisees ?? {})])) {
    places[cle] = somme(a.placesUtilisees?.[cle], b.placesUtilisees?.[cle]);
  }
  return {
    terreUtilisee: somme(a.terreUtilisee, b.terreUtilisee),
    coteUtilisee: somme(a.coteUtilisee, b.coteUtilisee),
    placesUtilisees: places,
  };
}

export function repartir(
  demande: Record<string, number>,
  iles: IleProductrice[],
  o: OptionsRepartition,
  /** Terre, côte et emplacements déjà pris par île (passe de rattrapage) ; sinon rien. Ne
   *  transmettre que la terre laissait le rattrapage redonner une côte et des emplacements déjà
   *  comptés : la seconde pose échouait, et le monde affichait un déficit. */
  dejaPris: BudgetsPris = {},
  /** Couples `île|bien` à ne plus tenter : l'île n'a pas tenu ce bien à la pose. Les autres biens
   *  lui restent ouverts — une côte saturée n'empêche pas d'y semer du blé. */
  pleines: ReadonlySet<string> = new Set(),
): Repartition {
  // TROIS BUDGETS PAR ÎLE, partagés entre tous ses biens : la terre, la côte, les emplacements.
  // Les compter bien par bien laissait deux mines se disputer les mêmes emplacements de montagne
  // et remplissait une côte deux fois.
  const cap = new Map(iles.map((i) => [i.cle, i.terre * REMPLISSAGE - (dejaPris.terreUtilisee?.[i.cle] ?? 0)]));
  // la côte est UNE part de 0 à 1, que se partagent des bâtiments de longueurs différentes
  const cote = new Map(iles.map((i) => [i.cle, 1 - (dejaPris.coteUtilisee?.[i.cle] ?? 0)]));
  // Côte et emplacements se comptent en BÂTIMENTS ENTIERS : une demi-mine prend un emplacement.
  const entiers = (n: number) => Math.ceil(n - 1e-3);
  const places = new Map(iles.map((i) => [i.cle, Object.fromEntries(LIMITANTS.map(
    (t) => [t, (i.emplacements[t] ?? 0) - (dejaPris.placesUtilisees?.[i.cle]?.[t] ?? 0)])) as Record<string, number>]));
  const aff = new Map<string, Map<string, number>>();
  const utilisee: Record<string, number> = {};
  const coteUtilisee: Record<string, number> = {};
  const placesUtilisees: Record<string, Record<string, number>> = {};
  const nonCouvert: Repartition["nonCouvert"] = [];

  /** Par unité produite : terre, bâtiments côtiers (et ce que la côte en accueille), emplacements. */
  interface Estimation {
    produit: number; parUnite: number;
    cotiers: { parUnite: number; capacite: number }[];
    places: Record<string, number>;
  }
  const cache = new Map<string, Estimation>();
  const estimer = (ile: IleProductrice, good: string, debit: number): Estimation => {
    const k = `${ile.cle}|${good}|${Math.round(debit * 10)}`;
    let e = cache.get(k);
    if (!e) {
      const n = devisIle(ile, [{ good, parMinute: debit }], o);
      const produit = n.objectif[0]?.produit ?? 0;
      const cotiers = new Map<string, number>();
      const pl: Record<string, number> = {};
      for (const l of n.lignes) {
        if (l.role !== "production") continue;
        const d = o.lookup(l.defId);
        if (d?.partieEau) cotiers.set(d.id, (cotiers.get(d.id) ?? 0) + l.nombre);
        if (d?.slotType && (LIMITANTS as readonly string[]).includes(d.slotType)) pl[d.slotType] = (pl[d.slotType] ?? 0) + l.nombre;
      }
      const u = produit > EPS ? 1 / produit : Infinity;
      e = {
        produit, parUnite: terreDuDevis(n) * u,
        cotiers: [...cotiers].map(([id, nb]) => ({ parUnite: nb * u, capacite: ile.capaciteCote(id) })),
        places: Object.fromEntries(Object.entries(pl).map(([t, v]) => [t, v * u])),
      };
      cache.set(k, e);
    }
    return e;
  };

  const biens = Object.entries(demande).filter(([, v]) => v > EPS);
  const capables = new Map(biens.map(([g, v]) => [g, iles.filter((i) => estimer(i, g, v).produit > EPS)]));
  const eligibles = new Map(biens.map(([g]) => [g, capables.get(g)!.filter((i) => !pleines.has(`${i.cle}|${g}`))]));
  biens.sort((a, b) => eligibles.get(a[0])!.length - eligibles.get(b[0])!.length || b[1] - a[1] || a[0].localeCompare(b[0]));

  for (const [good, total] of biens) {
    let reste = total;
    // le budget qui a borné ce bien, île par île : la raison dite s'il reste un manque
    const bornes = new Map<string, number>();
    const borne = (b: string) => bornes.set(b, (bornes.get(b) ?? 0) + 1);
    const candidates = [...eligibles.get(good)!]
      .sort((a, b) => estimer(a, good, total).parUnite - estimer(b, good, total).parUnite || a.cle.localeCompare(b.cle));
    for (const ile of candidates) {
      if (reste <= EPS) break;
      const e = estimer(ile, good, reste);
      const place = cap.get(ile.cle)!;
      if (!Number.isFinite(e.parUnite)) continue;
      if (place <= 0) { borne("terre"); continue; }
      // le premier budget épuisé borne : terre, côte, chaque type d'emplacement
      let q = Math.min(reste, e.produit);
      // un devis qui produit moins que demandé est borné par les emplacements de l'île
      let par = e.produit < reste - EPS ? "emplacement" : "terre";
      const min = (v: number, b: string) => { if (v < q) { q = v; par = b; } };
      min(place / e.parUnite, "terre");
      const coteLibre = cote.get(ile.cle)!;
      // les côtiers d'une même chaîne (maquereaux ET marais salants du garum) se partagent la côte
      const coteParUnite = e.cotiers.reduce((s, c) => s + c.parUnite / c.capacite, 0);
      if (coteParUnite > 0) {
        min(coteLibre / coteParUnite, "cote");
        for (const c of e.cotiers) min(Math.floor(q * c.parUnite + 1e-3) / c.parUnite, "cote");
      }
      const pl = places.get(ile.cle)!;
      for (const [t, v] of Object.entries(e.places)) if (v > 0) min(Math.floor(pl[t] + 1e-3) / v, t);
      if (q < reste - EPS) borne(par);
      if (q <= EPS) continue;
      const m = aff.get(ile.cle) ?? new Map<string, number>();
      m.set(good, (m.get(good) ?? 0) + q);
      aff.set(ile.cle, m);
      cap.set(ile.cle, place - q * e.parUnite);
      const cotePrise = e.cotiers.reduce((s, c) => s + entiers(q * c.parUnite) / c.capacite, 0);
      cote.set(ile.cle, coteLibre - cotePrise);
      coteUtilisee[ile.cle] = (coteUtilisee[ile.cle] ?? 0) + cotePrise;
      const prises = (placesUtilisees[ile.cle] ??= {});
      for (const [t, v] of Object.entries(e.places)) { const nb = entiers(q * v); pl[t] -= nb; prises[t] = (prises[t] ?? 0) + nb; }
      utilisee[ile.cle] = (utilisee[ile.cle] ?? 0) + q * e.parUnite;
      reste -= q;
    }
    if (reste > 0.01) {
      nonCouvert.push({
        good, parMinute: Math.round(reste * 100) / 100,
        raison: !capables.get(good)!.length
          ? (economy.producers[good]?.length
            ? "aucune de tes îles de production ne peut le produire (province, fertilité ou emplacement)"
            : "aucun bâtiment ne le produit")
          : RAISON_BORNE[[...bornes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
            ?? (eligibles.get(good)!.length < capables.get(good)!.length ? "pose" : "terre")],
      });
    }
  }

  const affectation: Record<string, BienDebit[]> = {};
  for (const [cle, m] of aff) {
    // arrondi VERS LE BAS : un centième de trop réclame un bâtiment de plus que la côte ou les
    // emplacements n'en accueillent
    affectation[cle] = [...m].map(([good, parMinute]) => ({ good, parMinute: Math.floor(parMinute * 100 + 1e-6) / 100 }))
      .filter((b) => b.parMinute > 0).sort((a, b) => b.parMinute - a.parMinute);
  }
  return { affectation, terreUtilisee: utilisee, coteUtilisee, placesUtilisees, nonCouvert: nonCouvert.sort((a, b) => b.parMinute - a.parMinute) };
}

export const nomDuBien = (g: string): string => goodName(g);

// ─── SUGGESTIONS D'ACHAT ────────────────────────────────────────────────────────────────

export interface SuggestionAchat {
  cle: string;
  /** Ce que l'île couvrirait de ce qui manque, bien par bien. */
  couvre: BienDebit[];
  /** u/min couverts, et part du manque total. */
  total: number;
  part: number;
  /** Ce qu'elle réclamerait en retour : matières qu'elle ne produit pas, biens de ses ouvriers. */
  enRetour: number;
  /** Fertilités non renseignées : estimée sans fertilité, donc peut-être sous-estimée. */
  fertilitesInconnues: boolean;
}

/**
 * Les îles à acheter qui couvriraient le plus de ce qui manque — choisies l'une après l'autre :
 * la deuxième est jugée sur ce que la première laisse, pour proposer des achats COMPLÉMENTAIRES
 * plutôt que trois îles qui couvrent les mêmes biens.
 *
 * Jugées sur leur GAIN NET : ce qu'elles couvriraient, moins ce qu'elles réclameraient en
 * retour. Une île sans fertilité qui ferait des tuniques en important tout son lin couvre peu,
 * et coûte presque autant qu'elle rapporte.
 */
export function suggererAchats(
  manque: Record<string, number>,
  candidates: { ile: IleProductrice; fertilitesInconnues: boolean }[],
  o: OptionsRepartition,
  max = 3,
): SuggestionAchat[] {
  const total = Object.values(manque).reduce((a, b) => a + b, 0);
  if (total <= EPS) return [];
  const reste = { ...manque };
  const restantes = [...candidates];
  const out: SuggestionAchat[] = [];
  while (out.length < max && restantes.length) {
    let meilleure: { k: number; couvre: BienDebit[]; somme: number; enRetour: number } | null = null;
    for (let k = 0; k < restantes.length; k++) {
      const cand = restantes[k];
      const couvre = repartir(reste, [cand.ile], o).affectation[cand.ile.cle] ?? [];
      const somme = couvre.reduce((a, b) => a + b.parMinute, 0);
      if (somme <= 0.05) continue;
      const enRetour = besoinsDuDevis(devisIle(cand.ile, couvre, o), o.consommation).reduce((a, b) => a + b.parMinute, 0);
      if (somme - enRetour > 0.05 && (!meilleure || somme - enRetour > meilleure.somme - meilleure.enRetour)) meilleure = { k, couvre, somme, enRetour };
    }
    if (!meilleure) break;
    const { k, couvre, somme, enRetour } = meilleure;
    const cand = restantes.splice(k, 1)[0];
    for (const b of couvre) reste[b.good] = Math.max(0, (reste[b.good] ?? 0) - b.parMinute);
    out.push({
      cle: cand.ile.cle, couvre, total: Math.round(somme * 100) / 100, part: somme / total,
      enRetour: Math.round(enRetour * 100) / 100, fertilitesInconnues: cand.fertilitesInconnues,
    });
  }
  return out;
}
