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
  /** Cases de la bande d'eau côtière constructible (tuile). */
  cote: number;
  dieu?: string;
}

export interface OptionsRepartition {
  catalog: BuildingDef[];
  lookup: DefLookup;
  routes: RoadType;
  productiviteGlobale: number;
}

/**
 * Les moteurs d'île lisent une liste de fertilités VIDE comme « tout est présent » (convention
 * de « Remplir l'île », où le joueur ne déclare souvent rien). Dans un monde, une île sans
 * fertilité cochée n'en a aucune : on passe alors un GUID qui ne correspond à aucune fertilité.
 * Inconnues (`null`) : traitées comme aucune, le plan le dit.
 */
export const AUCUNE_FERTILITE = "0";
export const fertilitesPourMoteur = (f: string[] | null): string[] => (f && f.length ? f : [AUCUNE_FERTILITE]);

/** Part de la terre qu'une île de production peut vraiment bâtir : routes, côte, formes. */
const REMPLISSAGE = 0.65;
/**
 * Part de la bande d'eau côtière que couvrent vraiment les parties dans l'eau des bâtiments
 * côtiers. Mesuré le 30/10/2026 en posant 80 exemplaires : 14 et 15 % (cabanes de pêcheur sur
 * roman_island_large_03 et medium_01), 11 % (escargotières, 12 % bancs d'huîtres) ; l'Albion
 * pose bien moins (2 à 4 %, aucun ramasseur de coques : défaut de pose côtière ouvert).
 */
const COTE_UTILE = 0.12;
/** Emplacements dont le nombre borne une exploitation (le marais ne borne rien). */
const LIMITANTS = ["mountain", "river"] as const;
const EPS = 1e-6;

/** Le devis d'une île pour un objectif : bâtiments, ouvriers, biens de leurs maisons, imports. */
export function devisIle(ile: IleProductrice, objectif: BienDebit[], o: OptionsRepartition): Nomenclature {
  return nomenclature({
    region: ile.region, maisons: [], objectif, routes: o.routes,
    fertilites: ile.fertilites, emplacements: ile.emplacements,
    ...(o.productiviteGlobale ? { productivite: { globale: o.productiviteGlobale } } : {}),
    ...(ile.dieu ? { dieu: ile.dieu } : {}),
  }, o.catalog, o.lookup);
}

/** Terre consommée par l'objectif : production et quartiers des ouvriers. */
export const terreDuDevis = (n: Nomenclature): number => n.surface.production + n.surface.quartiers;

/** Ce qu'il faut AUSSI fournir à l'île pour qu'elle tienne son objectif : les biens de ses
 *  ouvriers et les matières premières qu'elle ne peut pas produire. */
export function besoinsDuDevis(n: Nomenclature): BienDebit[] {
  const m = new Map<string, number>();
  for (const b of n.biens) if (b.source === "import" && b.parMinute > 0) m.set(b.good, (m.get(b.good) ?? 0) + b.parMinute);
  for (const i of n.imports) m.set(i.good, (m.get(i.good) ?? 0) + i.parMinute);
  return [...m].map(([good, parMinute]) => ({ good, parMinute }));
}

export interface Repartition {
  affectation: Record<string, BienDebit[]>;
  /** Terre estimée consommée par île. */
  terreUtilisee: Record<string, number>;
  nonCouvert: { good: string; parMinute: number; raison: string }[];
}

export function repartir(
  demande: Record<string, number>,
  iles: IleProductrice[],
  o: OptionsRepartition,
  /** Terre déjà prise par île (passe de rattrapage) ; sinon rien. */
  dejaPris: Record<string, number> = {},
  /** Îles à ne plus charger (elles n'ont pas tenu leur objectif à la pose). */
  pleines: ReadonlySet<string> = new Set(),
): Repartition {
  // TROIS BUDGETS PAR ÎLE, partagés entre tous ses biens : la terre, la côte, les emplacements.
  // Les compter bien par bien laissait deux mines se disputer les mêmes emplacements de montagne
  // et remplissait une côte deux fois.
  const cap = new Map(iles.map((i) => [i.cle, i.terre * REMPLISSAGE - (dejaPris[i.cle] ?? 0)]));
  const cote = new Map(iles.map((i) => [i.cle, i.cote * COTE_UTILE]));
  const places = new Map(iles.map((i) => [i.cle, Object.fromEntries(LIMITANTS.map((t) => [t, i.emplacements[t] ?? 0])) as Record<string, number>]));
  const aff = new Map<string, Map<string, number>>();
  const utilisee: Record<string, number> = {};
  const nonCouvert: Repartition["nonCouvert"] = [];

  /** Par unité produite : terre, côte, emplacements ; et la part produite sur place. */
  interface Estimation { produit: number; parUnite: number; cote: number; places: Record<string, number> }
  const cache = new Map<string, Estimation>();
  const estimer = (ile: IleProductrice, good: string, debit: number): Estimation => {
    const k = `${ile.cle}|${good}|${Math.round(debit * 10)}`;
    let e = cache.get(k);
    if (!e) {
      const n = devisIle(ile, [{ good, parMinute: debit }], o);
      const produit = n.objectif[0]?.produit ?? 0;
      let eau = 0;
      const pl: Record<string, number> = {};
      for (const l of n.lignes) {
        if (l.role !== "production") continue;
        const d = o.lookup(l.defId);
        if (d?.partieEau) eau += l.nombre * d.partieEau.w * d.partieEau.h;
        if (d?.slotType && (LIMITANTS as readonly string[]).includes(d.slotType)) pl[d.slotType] = (pl[d.slotType] ?? 0) + l.nombre;
      }
      const u = produit > EPS ? 1 / produit : Infinity;
      e = {
        produit, parUnite: terreDuDevis(n) * u, cote: eau * u,
        places: Object.fromEntries(Object.entries(pl).map(([t, v]) => [t, v * u])),
      };
      cache.set(k, e);
    }
    return e;
  };

  const biens = Object.entries(demande).filter(([, v]) => v > EPS);
  const capables = new Map(biens.map(([g, v]) => [g, iles.filter((i) => estimer(i, g, v).produit > EPS)]));
  const eligibles = new Map(biens.map(([g]) => [g, capables.get(g)!.filter((i) => !pleines.has(i.cle))]));
  biens.sort((a, b) => eligibles.get(a[0])!.length - eligibles.get(b[0])!.length || b[1] - a[1] || a[0].localeCompare(b[0]));

  for (const [good, total] of biens) {
    let reste = total;
    const candidates = [...eligibles.get(good)!]
      .sort((a, b) => estimer(a, good, total).parUnite - estimer(b, good, total).parUnite || a.cle.localeCompare(b.cle));
    for (const ile of candidates) {
      if (reste <= EPS) break;
      const e = estimer(ile, good, reste);
      const place = cap.get(ile.cle)!;
      if (place <= 0 || !Number.isFinite(e.parUnite)) continue;
      // le premier budget épuisé borne : terre, côte, chaque type d'emplacement
      let q = Math.min(reste, place / e.parUnite, e.produit);
      if (e.cote > 0) q = Math.min(q, cote.get(ile.cle)! / e.cote);
      const pl = places.get(ile.cle)!;
      for (const [t, v] of Object.entries(e.places)) if (v > 0) q = Math.min(q, pl[t] / v);
      if (q <= EPS) continue;
      const m = aff.get(ile.cle) ?? new Map<string, number>();
      m.set(good, (m.get(good) ?? 0) + q);
      aff.set(ile.cle, m);
      cap.set(ile.cle, place - q * e.parUnite);
      cote.set(ile.cle, cote.get(ile.cle)! - q * e.cote);
      for (const [t, v] of Object.entries(e.places)) pl[t] -= q * v;
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
          : "plus assez de place sur tes îles de production",
      });
    }
  }

  const affectation: Record<string, BienDebit[]> = {};
  for (const [cle, m] of aff) {
    affectation[cle] = [...m].map(([good, parMinute]) => ({ good, parMinute: Math.round(parMinute * 100) / 100 }))
      .filter((b) => b.parMinute > 0).sort((a, b) => b.parMinute - a.parMinute);
  }
  return { affectation, terreUtilisee: utilisee, nonCouvert: nonCouvert.sort((a, b) => b.parMinute - a.parMinute) };
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
      const enRetour = besoinsDuDevis(devisIle(cand.ile, couvre, o)).reduce((a, b) => a + b.parMinute, 0);
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
