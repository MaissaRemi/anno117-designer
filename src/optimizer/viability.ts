import { cityStatusLadder } from "../economy/economy";
import { VITAL_ATTRS } from "../economy/attributes";

/**
 * ═══ CE MODULE EST LA SEULE SOURCE DE VÉRITÉ SUR « VIABLE » ═══════════════════════════
 *
 * Il y a DEUX questions distinctes, et les confondre a déjà coûté cher :
 *
 *  - « quelles maisons garder ? » — c'est `viableSubset`, le GARDE-FOU, et il est STRICT :
 *    il rase jusqu'au retour à zéro, seule la tolérance demandée par le joueur l'assouplit ;
 *  - « ce plan est-il livrable ? » — c'est `verdictViable`, le VERDICT, qui ajoute le
 *    plancher de bruit du modèle.
 *
 * La règle vivait à trois endroits : ici, dans `islandPlan` et dans `invariants`, chacun avec
 * sa propre version du test. L'invariant `viable-coherent` comparait ainsi le drapeau à un
 * zéro strict et criait FAUTE sur les plans les plus sains du moteur, parce qu'il ignorait le
 * plancher que le verdict appliquait. Une règle métier écrite en trois exemplaires finit
 * toujours par diverger : les deux fonctions cohabitent donc ici, et nulle part ailleurs.
 */

/**
 * ═══ PLANCHER DE BRUIT DU MODÈLE D'ATTRIBUTS ══════════════════════════════════════════
 *
 * Déficit vital par maison en deçà duquel un plan est tenu pour viable. Ce n'est PAS la
 * tolérance du joueur — celle-là vaut zéro par défaut et s'ajoute à ce plancher : c'est la
 * RÉSOLUTION du modèle, en dessous de laquelle un écart ne signifie plus rien.
 *
 * Les attributs sont des entiers par maison, et la couverture est discrète : deux maisons du
 * même palier n'ont pas le même bilan selon les services qui les atteignent. Le total de l'île
 * hérite donc d'un bruit d'arrondi proportionnel au nombre de maisons.
 *
 * MESURÉ, et c'est ce qui a rendu ce plancher nécessaire. Sur `roman_island_medium_05`, le
 * palier Patriciens loge 20 904 habitants avec `FireSafety = −21` sur 625 maisons — soit
 * −0,034 par maison, quand le Bonheur vaut +3 637 et l'Argent +46 414. Le drapeau `viable`
 * étant binaire et `better()` le classant AVANT la population, `autoTier` écartait ce palier
 * et se rabattait sur Plébéiens : 4 992 habitants. **Vingt et un points de déficit coûtaient
 * seize mille habitants.** Même effondrement sur `roman_island_large_06` : 29 265 → 4 980.
 *
 * Raser jusqu'au retour à zéro n'y répond pas : le déficit est DIFFUS, la maison moyenne n'est
 * négative que de 0,034, il faudrait en raser plus de six cents — un tiers de l'île. Le razage
 * ne répare que les déficits concentrés.
 *
 * LA MARGE EST MINCE, ET C'EST MESURÉ. Sur les 55 îles, le déficit livré le plus profond est
 * −0,0452 par maison (`roman_island_medium_04`, Bonheur) : le plancher n'a qu'un facteur 1,11
 * d'avance. Pire, la distribution est TRONQUÉE par construction — une île dont le palier haut
 * dépasserait 0,05 ne l'affiche pas, elle s'effondre au palier inférieur où le déficit est nul.
 * Ce plancher est donc un pare-feu, pas une réponse : la réponse est un CLASSEMENT qui cesse
 * de faire dépendre un facteur quatre de population d'un drapeau binaire.
 */
export const BRUIT_VITAL = 0.05;

/**
 * VERDICT du plan LIVRÉ : tolérance joueur + plancher de bruit, par maison.
 *
 * Ne jamais l'employer pour décider quelles maisons garder — c'est le rôle de `viableSubset`,
 * et il doit rester strict. Le plancher ne juge que le plan fini.
 */
export const verdictViable = (
  attrs: Record<string, number>,
  houses: number,
  tolerance = 0,
): boolean =>
  VITAL_ATTRS.every((k) => (attrs[k] ?? 0) + (Math.max(0, tolerance) + BRUIT_VITAL) * houses >= 0);

/**
 * ═══ DÉFICIT VITAL LE PLUS PROFOND, PAR MAISON ════════════════════════════════════════
 *
 * `0` quand le bilan est sain. C'est la seule échelle sur laquelle deux plans se comparent :
 * un total brut ne dit rien sans le nombre de maisons qui le porte — −26 sur 575 maisons est
 * un plan sain, −26 sur 10 est une ville en flammes.
 */
export const severiteVitale = (attrs: Record<string, number>, houses: number): number => {
  if (houses <= 0) return VITAL_ATTRS.some((k) => (attrs[k] ?? 0) < 0) ? Infinity : 0;
  let pire = 0;
  for (const k of VITAL_ATTRS) {
    const parMaison = (attrs[k] ?? 0) / houses;
    if (parMaison < pire) pire = parMaison;
  }
  return pire < 0 ? -pire : 0; // `-pire` rendrait -0 sur un bilan sain, que `Object.is` distingue
};

/**
 * SÉVÉRITÉ au-delà de laquelle une ville est tenue pour ingérable, en points vitaux par
 * maison. Sert d'échelle à l'escompte de risque, pas de seuil : la fonction qui l'emploie est
 * continue, et c'est tout l'intérêt.
 *
 * Un point de déficit PAR MAISON est déjà énorme — une résidence patricienne plafonne à +7 de
 * sécurité incendie, et le malus de rang de cité atteint −7 vers 30 000 habitants. Une ville
 * qui perdrait un point par maison sur un attribut vital est hors de tout rattrapage.
 */
export const SEVERITE_INGERABLE = 1;

/**
 * ═══ POPULATION EFFECTIVE : LA POPULATION, ESCOMPTÉE DU RISQUE QU'ELLE PORTE ══════════
 *
 * C'EST LA RÉPONSE À LA FALAISE, et le drapeau binaire n'en était que le pare-feu.
 *
 * Les comparateurs classaient par `viable` AVANT la population. Un plan à −0,034 par maison
 * perdait donc contre un plan sain quatre fois moins peuplé : mesuré, 20 904 habitants écartés
 * au profit de 4 992 sur `roman_island_medium_05`. Le plancher de bruit a déplacé la falaise
 * sans la supprimer — il reste un SEUIL DUR, et sur `roman_island_medium_04` le plan livré
 * n'en est qu'à 11 % (−0,0452 pour un plancher à 0,05). Un rien le fait rebasculer.
 *
 * Tout seuil dur produit une falaise. On escompte donc, continûment : un déficit dans la bande
 * tolérée ne coûte RIEN — le comportement des plans sains est inchangé au habitant près — et
 * au-delà, la population est réduite au prorata du risque, jusqu'à s'annuler à
 * `SEVERITE_INGERABLE`. Un plan vraiment mauvais ne peut donc plus gagner en logeant plus,
 * mais un plan meilleur ne se fait plus écarter pour trois centièmes de point.
 *
 * Le DRAPEAU `viable` ne change pas et reste juste : c'est le CLASSEMENT qui cesse d'être
 * binaire, jamais l'avertissement rendu à l'utilisateur.
 */
export const populationEffective = (
  residents: number,
  attrs: Record<string, number>,
  houses: number,
  tolerance = 0,
): number => {
  const bande = Math.max(0, tolerance) + BRUIT_VITAL;
  const nette = Math.max(0, severiteVitale(attrs, houses) - bande);
  if (nette === 0) return residents;
  return residents * Math.max(0, 1 - nette / SEVERITE_INGERABLE);
};

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
