import { cityStatusLadder } from "../economy/economy";
import { VITAL_ATTRS } from "../economy/attributes";

/** Une maison candidate, réduite à ce dont la sélection sous contrainte a besoin. */
export interface Weighed {
  cap: number;
  /** rang déterministe pour départager à contribution égale (= y·W + x) */
  key: number;
  attrs: Readonly<Record<string, number>>;
}

/**
 * ═══ SÉLECTION SOUS CONTRAINTE DE VIABILITÉ ═══════════════════════════════════════════
 *
 * Une maison dont le Bonheur, l'Argent, la Santé ou la Sécurité incendie passe sous zéro
 * déclenche émeutes, incendies et maladies. Le jugement porte sur le TOTAL de l'île, pas sur
 * la pire maison : un quartier de bordure en déficit compensé par le cœur ne pose aucun
 * problème.
 *
 * Difficulté : le malus de RANG DE CITÉ dépend de la population totale, qui dépend elle-même
 * des maisons retenues. On ne résout pas ça par itération sur les paliers (elle oscille) mais
 * en retirant par lots les maisons qui contribuent le plus négativement à l'attribut
 * limitant — retirer baisse la population, donc le malus : la boucle converge.
 *
 * ═══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════════════════
 *
 * C'est LA définition de « ce que ce plan livre ». Toute passe qui prétend juger un plan doit
 * passer par ici, et deux moteurs l'ont appris à leurs dépens :
 *
 *  - une passe de réparation de seuil qui jugeait sur la population BRUTE acceptait des poses
 *    que ce garde-fou punissait juste après en rasant des maisons entières : −1,2 % sur
 *    `celtic_island_large_07` pour un gain annoncé positif ;
 *  - `packPlan` ne l'appliquait pas du tout. Il annonçait 21 414 habitants là où les plans
 *    lattice en annonçaient 4 980 — et se faisait éliminer par `better()` au premier critère,
 *    parce qu'un plan au bilan négatif perd contre n'importe quel plan viable. Sa densité,
 *    trois à quatre fois supérieure sur les paliers bas, partait à la poubelle à chaque plan.
 */
export function viableSubset<T extends Weighed>(set: T[], region: string): T[] {
  const ladder = cityStatusLadder(region);
  const rankAt = (pop: number): Record<string, number> => {
    let a: Record<string, number> = {};
    for (const st of ladder) { if (pop < st.population) break; a = st.attrs; }
    return a;
  };
  // On retire par lots (2 %) pour ne pas refaire n² tours sur les grandes îles.
  let keep: T[] = set;
  for (let guard = 0; guard < 400 && keep.length; guard++) {
    let pop = 0;
    for (const p of keep) pop += p.cap;
    const rank = rankAt(pop);
    // Bilan de l'ÎLE : Σ des attributs des maisons retenues, plus le malus de rang appliqué à
    // chacune. L'attribut le plus déficitaire commande le retrait.
    let binding: string | null = null, worst = 0;
    for (const k of VITAL_ATTRS) {
      let t = keep.length * (rank[k] ?? 0);
      for (const p of keep) t += p.attrs[k] ?? 0;
      if (t < 0 && (binding === null || t < worst)) { binding = k; worst = t; }
    }
    if (!binding) break;
    const b = binding;
    // tri déterministe : contribution croissante, puis position — la pire d'abord. Le malus
    // de rang est le même pour toutes, il s'annule dans la comparaison.
    const sorted = [...keep].sort((p, q) => ((p.attrs[b] ?? 0) - (q.attrs[b] ?? 0)) || (p.key - q.key));
    keep = sorted.slice(Math.max(1, Math.ceil(keep.length * 0.02)));
  }
  return keep;
}
