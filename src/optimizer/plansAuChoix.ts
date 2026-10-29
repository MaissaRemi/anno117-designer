import { severiteVitale } from "./viability";

/**
 * ═══ PLANS AU CHOIX ═══════════════════════════════════════════════════════════════════
 *
 * Le moteur évalue des dizaines de plans complets et n'en montrait qu'un : le meilleur selon
 * une règle fixée d'avance (habitants, ou maisons au palier, escomptés d'un prix du bilan que
 * j'avais choisi). Le joueur, lui, arbitre mieux que n'importe quel poids : on lui montre
 * jusqu'à trois plans qui excellent chacun sur un critère différent, et il choisit.
 *
 * Deux règles pour que le choix ait un sens :
 *  - FRONT DE PARETO : un plan battu sur tous les critères à la fois par un autre n'est
 *    jamais proposé ;
 *  - CONTRASTE : un plan n'est ajouté que s'il fait nettement mieux, sur son critère, que
 *    tous ceux déjà retenus — trois variantes du même plan à 1 % près n'aident personne.
 */

/** Ce qu'un plan doit exposer pour être comparé. `IslandPlanResult` le satisfait. */
export interface PlanComparable {
  residents: number;
  houses: number;
  fullyCovered: number;
  attrsTotal: Record<string, number>;
  money: { net: number };
  feasible: boolean;
}

export type Critere = "habitants" | "maisons" | "bilan" | "argent";

export const LIBELLE_CRITERE: Record<Critere, string> = {
  habitants: "Le plus d'habitants",
  maisons: "Le plus de maisons au palier",
  bilan: "Le bilan le plus sain",
  argent: "Le plus rentable",
};

/** Valeur d'un critère, PLUS GRAND = MEILLEUR (le bilan est la sévérité changée de signe). */
export function valeurCritere(p: PlanComparable, c: Critere): number {
  switch (c) {
    case "habitants": return p.residents;
    case "maisons": return p.fullyCovered;
    case "bilan": return -severiteVitale(p.attrsTotal, p.houses);
    case "argent": return p.money.net;
  }
}

/**
 * Avance minimale pour qu'un plan compte comme « nettement meilleur » sur un critère :
 * 1 % des habitants ou des maisons, 2 % de l'argent, 0,2 point de déficit par maison.
 */
function avanceNette(c: Critere, ref: number): number {
  switch (c) {
    case "habitants":
    case "maisons": return Math.max(1, Math.abs(ref) * 0.01);
    case "argent": return Math.max(1, Math.abs(ref) * 0.02);
    case "bilan": return 0.2;
  }
}

const CRITERES: Critere[] = ["habitants", "maisons", "bilan", "argent"];

/** `a` domine `b` : au moins aussi bon partout, strictement meilleur quelque part. */
function domine(a: PlanComparable, b: PlanComparable): boolean {
  let mieux = false;
  for (const c of CRITERES) {
    const va = valeurCritere(a, c), vb = valeurCritere(b, c);
    if (va < vb) return false;
    if (va > vb) mieux = true;
  }
  return mieux;
}

export interface PlanChoisi<P> {
  plan: P;
  /** Critères sur lesquels ce plan est le meilleur des plans proposés. */
  atouts: Critere[];
}

/**
 * Jusqu'à `max` plans contrastés, le `recommande` en tête — celui que la règle du moteur
 * désigne ; les autres sont pris sur le front de Pareto des `candidats`, un par critère.
 */
export function choisirPlansContrastes<P extends PlanComparable>(
  recommande: P,
  candidats: P[],
  max = 3,
): PlanChoisi<P>[] {
  const jouables = candidats.filter((p) => p !== recommande && (p.feasible || !recommande.feasible));
  const front = jouables.filter((p) => ![recommande, ...jouables].some((q) => q !== p && domine(q, p)));
  const retenus: P[] = [recommande];
  for (const c of CRITERES) {
    if (retenus.length >= max) break;
    let meilleur: P | undefined;
    for (const p of front) {
      if (retenus.includes(p)) continue;
      if (!meilleur || valeurCritere(p, c) > valeurCritere(meilleur, c)) meilleur = p;
    }
    if (!meilleur) continue;
    const record = Math.max(...retenus.map((p) => valeurCritere(p, c)));
    if (valeurCritere(meilleur, c) >= record + avanceNette(c, record)) retenus.push(meilleur);
  }
  return retenus.map((plan) => ({
    plan,
    atouts: CRITERES.filter((c) => {
      const v = valeurCritere(plan, c);
      return retenus.every((q) => valeurCritere(q, c) <= v);
    }),
  }));
}
