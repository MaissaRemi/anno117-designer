import type { BuildingDef, GridShape } from "../model/types";
import type { DefLookup } from "../engine/rules";
import type { DispositionOpts } from "./disposition";
import { nomenclature, type Commande } from "./nomenclature";
import { planifierCommande, type PlanCommande } from "./planifier";

/**
 * ═══ PRODUIRE LE MAXIMUM ══════════════════════════════════════════════════════════════
 *
 * Les débits de l'objectif ne sont plus des quantités mais des PROPORTIONS : on cherche le plus
 * grand multiple que l'île pose en entier. Aucune formule ne le donne (formes de la terre, côte,
 * emplacements, quartiers d'ouvriers) : on POSE, on lit ce qui a tenu, et on recommence plus
 * haut ou plus bas — quelques poses, la première guidée par le devis.
 */

/** Part de la terre qu'une île de production bâtit vraiment : le premier essai (cf. `repartition.ts`). */
const REMPLISSAGE = 0.65;
/** Un objectif est tenu à 2 % près : un dernier bâtiment arrondi ne doit pas tout rejeter. */
const TENU = 0.98;
/** Nombre de poses au plus ; une grande île en demande plusieurs secondes chacune. */
const ESSAIS = 8;
/** Écart entre le plus haut multiple tenu et le plus bas refusé où l'on s'arrête. */
const PRECISION = 1.05;
/** Part de la terre visée quand on monte : au-delà, les poses échouent presque toujours. */
const VISEE = 0.8;

/** Part de l'objectif posée, sur le bien le moins bien tenu. */
export const tenue = (p: PlanCommande): number =>
  p.objectif.reduce((m, o) => Math.min(m, o.parMinute > 0 ? o.pose / o.parMinute : 1), 1);

export function planifierMaximum(
  grid: GridShape,
  commande: Commande,
  catalog: BuildingDef[],
  lookup: DefLookup,
  opts: DispositionOpts = {},
): PlanCommande {
  const base = (commande.objectif ?? []).filter((o) => o.parMinute > 0);
  const aLEchelle = (k: number): Commande => ({
    ...commande,
    objectif: base.map((o) => ({ ...o, parMinute: Math.floor(o.parMinute * k * 100) / 100 })).filter((o) => o.parMinute > 0),
  });
  const surface = nomenclature(aLEchelle(1), catalog, lookup).surface.total;
  if (!base.length || surface <= 0) return planifierCommande(grid, commande, catalog, lookup, opts);

  let k = (REMPLISSAGE * grid.usable.filter(Boolean).length) / surface;
  let bas = 0, haut = Infinity;
  let meilleur: PlanCommande | undefined, dernier: PlanCommande | undefined;
  /** Ce qui a manqué à l'essai refusé le plus proche du maximum : la raison du plafond. */
  let refus: string[] = [];
  for (let i = 0; i < ESSAIS; i++) {
    const c = aLEchelle(k);
    if (!c.objectif!.length) break;
    const p = planifierCommande(grid, c, catalog, lookup, opts);
    const t = tenue(p);
    dernier = p;
    // tenu, et ce qui est posé a ses ouvriers (E3) : un plan qui en manque n'est pas un maximum
    const loge = commande.mainOeuvre === "signaler" || !Object.keys(p.mainOeuvre.manque).length;
    if (t >= TENU && loge) { meilleur = p; bas = k; } else { haut = k; refus = p.manques; }
    if (bas > 0 && haut / bas < PRECISION) break;
    // rien de tenu encore : on vise ce qui vient d'être posé ; tenu sans plafond connu : on monte
    // selon la terre restée libre (le devis peut être loin du compte) ; sinon on coupe en deux
    const prise = Math.max(0.05, 1 - p.qualite.pct.free / 100);
    k = bas === 0 ? k * Math.max(t, 0.1) * 0.9
      : haut === Infinity ? k * Math.min(3, Math.max(1.15, VISEE / prise))
        : (bas + haut) / 2;
  }
  if (meilleur && refus.length) {
    // sans cette ligne, une île aux trois quarts vide (une mine de trop, faute d'emplacement)
    // passerait pour un échec du moteur
    return { ...meilleur, avertissements: [...meilleur.avertissements, `Au-delà, la pose ne tient plus : ${refus.slice(0, 3).join(" ; ")}`] };
  }
  return meilleur ?? dernier ?? planifierCommande(grid, commande, catalog, lookup, opts);
}
