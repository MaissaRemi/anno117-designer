import type { ExitSide } from "./exit";

/**
 * CE QUI MANQUE, CHIFFRÉ.
 *
 * Le refus n'est pas une exception à message vague. En boîte imposée il n'y a plus de
 * rattrapage par agrandissement : le refus est la sortie NORMALE d'une contrainte trop
 * serrée, et il doit dire quoi ajouter et de combien. Un refus qui ne se lit pas rend le
 * mode inutilisable.
 */
export type Unmet =
  | { kind: "champ"; defId: string; uid: string; obtenu: number; requis: number }
  | { kind: "aire-libre"; defId: string; uid: string; obtenu: number; requis: number }
  | { kind: "route"; defId: string; uid: string }
  | { kind: "portee"; defId: string; uid: string; distance: number; portee: number }
  | { kind: "non-pose"; defId: string; manque: number }
  | { kind: "sortie"; side: ExitSide };

export interface PlanRefus {
  refuse: true;
  raison: string;
  nonServis: Unmet[];
}

/** Phrase lisible pour un manque — l'interface l'affiche telle quelle. */
export function direUnmet(u: Unmet, nom: (defId: string) => string): string {
  switch (u.kind) {
    case "champ":
      return `${nom(u.defId)} : ${u.obtenu} cases de champ sur ${u.requis}`;
    case "aire-libre":
      return `${nom(u.defId)} : ${u.obtenu} cases libres autour sur ${u.requis} exigées`;
    case "route":
      return `${nom(u.defId)} : aucun accès route relié à la sortie`;
    case "portee":
      return `${nom(u.defId)} : aucun entrepôt sous ${u.portee} en distance-rue`;
    case "non-pose":
      return `${nom(u.defId)} : ${u.manque} exemplaire(s) sans place`;
    case "sortie":
      return `Aucune sortie de route possible sur le bord ${u.side}`;
  }
}
