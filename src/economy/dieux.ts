import { economy, type Patron } from "./economy";
import type { Attrs } from "./attributes";

/**
 * ═══ LES DIEUX TUTÉLAIRES : CE QU'ILS RENDENT, SELON LA DÉVOTION ═══════════════════════
 *
 * Un dieu par île, choisi par le joueur. Ses deux effets locaux montent par paliers de
 * DÉVOTION (`milestones` : [dévotion, échelle]) ; l'échelle MULTIPLIE la valeur de l'effet :
 *  - le premier, chez sept dieux sur huit, est une PRODUCTIVITÉ (valeur 1 × échelle 10 → 150,
 *    soit +10 % à +150 %) sur un groupe d'ateliers (« Ceres Goods » : fermes, moulins…) ;
 *  - le second touche les résidences (Cérès Population, Minerve Connaissance, Cernunnos Santé
 *    et Connaissance), la main-d'œuvre (Vulcain), ou des ateliers, navires et troupes.
 *
 * LA DÉVOTION SUIT LA FOI DE L'ÎLE. Le jeu le dit en toutes lettres : « La Dévotion dépend du
 * niveau de Foi de l'île. Dès lors qu'un dieu tutélaire est choisi, la Dévotion augmente
 * progressivement jusqu'à atteindre cette valeur de Foi. » La Foi est la somme de la Croyance
 * de toutes les maisons (besoins, services, rang de cité) : elle grandit avec la population.
 * Un plan d'île, qui décrit un état établi, prend donc la dévotion ÉGALE à sa Foi. La montée
 * dans le temps (`DevotionRateScaling`, 1,65 à 119 points par seconde) n'importe qu'au
 * démarrage d'une partie.
 */

/** Les huit dieux, dans l'ordre alphabétique de leur nom affiché. */
export function dieux(): Patron[] {
  return [...(economy.patrons ?? [])].sort((a, b) => nomDuDieu(a).localeCompare(nomDuDieu(b)));
}

export const nomDuDieu = (p: Patron): string => p.nameFr || p.name;

export function dieuParId(id: string | undefined): Patron | undefined {
  return id ? (economy.patrons ?? []).find((p) => p.id === id) : undefined;
}

/** Le dieu dont `defId` est un autel, s'il y en a un. */
export function dieuDeLAutel(defId: string): Patron | undefined {
  return (economy.patrons ?? []).find((p) => p.shrines?.includes(defId) || p.shrineDefId === defId);
}

/** Échelle atteinte à cette dévotion : celle du dernier palier franchi, 0 sous le premier. */
export function echelleA(milestones: [number, number][], devotion: number): number {
  let echelle = 0;
  for (const [seuil, v] of milestones) if (devotion >= seuil) echelle = v;
  return echelle;
}

/** Dévotion d'équilibre d'une île : sa Foi (voir l'en-tête). */
export const devotionDeFoi = (foi: number): number => Math.max(0, Math.floor(foi));

/** Prochain palier d'effet au-dessus de cette dévotion, tous effets locaux confondus. */
export function prochainPalier(p: Patron, devotion: number): number | undefined {
  let best: number | undefined;
  for (const e of p.local) for (const [seuil] of e.milestones) {
    if (seuil > devotion && (best === undefined || seuil < best)) best = seuil;
  }
  return best;
}

/** Pools des résidences : « All Residences » et « All Attribute Buildings ». */
const RESIDENCE_POOLS = new Set(["31046", "43097"]);

export interface EffetsDuDieu {
  dieu: Patron;
  devotion: number;
  /** Productivité ajoutée aux ateliers dopés, en points de pourcentage (+60 = ×1,6). */
  productivitePct: number;
  /** Ateliers dopés (defIds), les deux régions. */
  ateliers: string[];
  /** Attributs ajoutés à CHAQUE résidence de l'île. */
  residence: Attrs;
  /** Main-d'œuvre fournie par les résidences, en pourcentage (Vulcain). */
  mainDoeuvrePct: number;
  /** Seuils de l'île franchis : autel (1 000), merveille (4 000), dominance (7 000). */
  autel: boolean;
  merveille: boolean;
  dominant: boolean;
}

export function effetsDuDieu(dieu: Patron, devotion: number): EffetsDuDieu {
  const r = economy.religion ?? {};
  const out: EffetsDuDieu = {
    dieu, devotion, productivitePct: 0, ateliers: [], residence: {}, mainDoeuvrePct: 0,
    autel: devotion >= (r.shrineThreshold ?? 1000),
    merveille: devotion >= (r.wonderThreshold ?? 4000),
    dominant: devotion >= (r.dominantThreshold ?? 7000),
  };
  for (const e of dieu.local) {
    const echelle = echelleA(e.milestones, devotion);
    if (!echelle) continue;
    const prod = e.factory?.ProductivityUpgrade ?? 0;
    if (prod && e.boosted?.length) {
      out.productivitePct += prod * echelle;
      for (const id of e.boosted) if (!out.ateliers.includes(id)) out.ateliers.push(id);
    }
    if (e.workforcePct && e.targets.some((t) => RESIDENCE_POOLS.has(t))) {
      out.mainDoeuvrePct += e.workforcePct * echelle;
    }
    if (e.targets.some((t) => RESIDENCE_POOLS.has(t))) {
      for (const [k, v] of Object.entries(e.attrs)) out.residence[k] = (out.residence[k] ?? 0) + v * echelle;
    }
  }
  return out;
}

/**
 * MULTIPLICATEUR DE PRODUCTIVITÉ par atelier (defId → 1,6 pour +60 %), vide sans dieu.
 *
 * Un atelier plus productif tourne plus vite : il consomme et produit davantage par minute,
 * dans la même proportion. Le rapport intrant / produit ne change pas, seul le NOMBRE
 * d'ateliers qu'une demande réclame baisse — six moulins à +50 % font le travail de neuf.
 */
export function productiviteDuDieu(dieu: Patron | undefined, devotion: number): Record<string, number> {
  if (!dieu) return {};
  const fx = effetsDuDieu(dieu, devotion);
  if (!fx.productivitePct) return {};
  const m = 1 + fx.productivitePct / 100;
  return Object.fromEntries(fx.ateliers.map((id) => [id, m]));
}

/** Ce qu'un dieu rend, en une ligne : productivité et effet sur les maisons. */
export function resumeEffets(productivitePct: number, nbAteliers: number, residence: Record<string, number>): string {
  const lbl: Record<string, string> = {
    Population: "habitants", Knowledge: "Connaissance", Health: "Santé", Prestige: "Prestige",
  };
  const parts: string[] = [];
  if (productivitePct) parts.push(`productivité +${productivitePct} % sur ${nbAteliers} ateliers`);
  for (const [k, v] of Object.entries(residence)) if (v) parts.push(`${lbl[k] ?? k} +${v} par maison`);
  return parts.join(", ") || "aucun effet à cette dévotion";
}
