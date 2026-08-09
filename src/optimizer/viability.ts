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
/** Réglages du garde-fou. */
export interface ViabilityOpts {
  /**
   * DÉFICIT VITAL TOLÉRÉ PAR MAISON. `0` reproduit exactement le comportement historique.
   *
   * Le veto est binaire : un attribut vital négatif d'un point sur toute l'île fait raser
   * jusqu'au retour à zéro. Or la donnée du jeu décrit l'incendie comme un TAUX DE RISQUE
   * (`GAME_MECHANICS.md §10`, `CityStatus/IncidentInterval`), pas comme une interdiction — et
   * l'échelle de rang compte quarante paliers jusqu'à 260 000 habitants, dont vingt-cinq que
   * le veto binaire rend inatteignables. Le modèle contredit sa propre table.
   *
   * La tolérance ouvre cette marge sans la décider à la place du joueur : elle reste à zéro
   * par défaut, et c'est l'interface qui l'expose.
   */
  tolerance?: number;
}

export function viableSubset<T extends Weighed>(
  set: T[],
  region: string,
  opts?: ViabilityOpts,
): T[] {
  const tol = Math.max(0, opts?.tolerance ?? 0);
  const ladder = cityStatusLadder(region);
  const rankAt = (pop: number): Record<string, number> => {
    let a: Record<string, number> = {};
    for (const st of ladder) { if (pop < st.population) break; a = st.attrs; }
    return a;
  };
  /** Bilan par attribut vital pour un sous-ensemble donné, malus de rang compris. */
  const balance = (n: number, pop: number, sum: Record<string, number>) => {
    const rank = rankAt(pop);
    const out: Record<string, number> = {};
    for (const k of VITAL_ATTRS) out[k] = (sum[k] ?? 0) + n * (rank[k] ?? 0) + tol * n;
    return out;
  };

  let keep: T[] = set;
  const removed: T[] = [];

  // ─── RETRAIT ────────────────────────────────────────────────────────────────────────
  // Par lots de 2 % : refaire n² tours coûterait des minutes sur une carte continentale.
  for (let guard = 0; guard < 400 && keep.length; guard++) {
    let pop = 0;
    const sum: Record<string, number> = {};
    for (const p of keep) {
      pop += p.cap;
      for (const k of VITAL_ATTRS) sum[k] = (sum[k] ?? 0) + (p.attrs[k] ?? 0);
    }
    const bal = balance(keep.length, pop, sum);
    const manquants = VITAL_ATTRS.filter((k) => bal[k]! < 0);
    if (!manquants.length) break;

    // ═══ ON TRIE SUR TOUS LES ATTRIBUTS EN DÉFICIT, PAS SUR LE PIRE ═══════════════════
    //
    // Le tri ne portait que sur l'attribut le plus déficitaire du moment. Mesuré sur la carte
    // continentale du DLC : le Bonheur commande les quatre-vingt-dix-neuf premières
    // itérations, alors que c'est la Sécurité incendie qui ferme la boucle. Le garde-fou
    // détruisait donc des maisons bien pourvues en incendie au profit d'un attribut qui
    // n'était même pas celui qui bloquerait à l'arrivée.
    //
    // Chaque attribut déficitaire est ramené à une échelle commune avant d'être sommé — sans
    // quoi le Bonheur, dont les valeurs sont d'un ordre de grandeur supérieur, dominerait le
    // score et le tri redeviendrait mono-attribut par accident.
    const echelle: Record<string, number> = {};
    for (const k of manquants) {
      let m = 1;
      for (const p of keep) { const v = Math.abs(p.attrs[k] ?? 0); if (v > m) m = v; }
      echelle[k] = m;
    }
    const score = (p: T) => {
      let s = 0;
      for (const k of manquants) s += (p.attrs[k] ?? 0) / echelle[k]!;
      return s;
    };
    // départage par position : c'est lui qui rend les plans reproductibles.
    const sorted = [...keep].sort((p, q) => (score(p) - score(q)) || (p.key - q.key));
    const coupe = Math.max(1, Math.ceil(keep.length * 0.02));
    for (let i = 0; i < coupe; i++) removed.push(sorted[i]!);
    keep = sorted.slice(coupe);
  }

  // ─── RÉADMISSION ────────────────────────────────────────────────────────────────────
  //
  // Le retrait par lots DÉPASSE par construction : le dernier lot de 2 % emporte des maisons
  // qui auraient tenu. Sur la continentale, cent soixante-douze itérations à 2 % ne laissent
  // que 3 % de l'effectif — le résultat est alors dicté par le nombre d'itérations autant que
  // par la contrainte.
  //
  // On rend donc au plan les meilleures maisons retirées, une à une, tant que le bilan tient.
  // La passe ne peut que gagner : elle part du résultat du retrait et n'accepte qu'un ajout
  // qui laisse l'île viable. Les totaux sont tenus en incrémental — recalculer le bilan à
  // chaque essai serait quadratique.
  if (removed.length) {
    let pop = 0;
    const sum: Record<string, number> = {};
    for (const k of VITAL_ATTRS) sum[k] = 0;
    for (const p of keep) {
      pop += p.cap;
      for (const k of VITAL_ATTRS) sum[k]! += p.attrs[k] ?? 0;
    }
    // marge la plus faible d'abord écartée : on tente les plus généreuses en tête.
    const marge = (p: T) => {
      let m = Infinity;
      for (const k of VITAL_ATTRS) m = Math.min(m, p.attrs[k] ?? 0);
      return m;
    };
    const cands = [...removed].sort((p, q) => (marge(q) - marge(p)) || (p.key - q.key));
    // Une maison refusée peut le rester à cause de la population, pas de ses propres
    // attributs : on s'arrête après une série d'échecs plutôt qu'au premier.
    let echecs = 0;
    for (const p of cands) {
      if (echecs >= 64) break;
      const nPop = pop + p.cap;
      const nSum: Record<string, number> = {};
      for (const k of VITAL_ATTRS) nSum[k] = sum[k]! + (p.attrs[k] ?? 0);
      const bal = balance(keep.length + 1, nPop, nSum);
      if (VITAL_ATTRS.some((k) => bal[k]! < 0)) { echecs++; continue; }
      echecs = 0;
      keep.push(p);
      pop = nPop;
      for (const k of VITAL_ATTRS) sum[k] = nSum[k]!;
    }
    keep.sort((p, q) => p.key - q.key); // ordre stable en sortie
  }

  return keep;
}
