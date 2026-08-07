import { economy } from "./economy";
import type { BuildingDef } from "../model/types";

/**
 * UNICITÉ DES BÂTIMENTS — combien d'exemplaires d'un même `UniqueType` tiennent sur une île.
 *
 * La règle est déclarée en un seul endroit par le jeu (asset `UniqueBuildingConfig`, GUID
 * 81160), extrait dans `economy.uniqueTypes`. Elle porte sur un TYPE et non sur un bâtiment :
 * les seize autels de dieux — huit divinités × deux régions — partagent `Shrine`, et leur
 * plafond est commun à l'île.
 *
 * Deux mécanismes de nature différente, qui peuvent se cumuler sur un même type :
 *  - `allowed` — plafond DUR, dans les fichiers du jeu, immuable (Monument01 : 1) ;
 *  - `permit` — chaque exemplaire consomme un PERMIS. Le nombre détenu n'est PAS une donnée
 *    du jeu mais un ÉTAT DE PARTIE, que le joueur augmente par la recherche.
 *
 * Les confondre dans une seule table de nombres, comme le faisait `DEFAULT_UNIQUE_QUOTA`,
 * rendait le repli silencieux : `VillaMilitiaAuxilia`, dont le plafond dur vaut 2, aurait été
 * ramenée à 1 dès son entrée au catalogue, sans le moindre signal.
 */

/** Permis d'autel (produit 93771) — celui qui borne les sanctuaires de la divinité tutélaire. */
export const SHRINE_PERMIT = "93771";

/**
 * PERMIS DÉTENUS par défaut, par GUID. Ce sont des valeurs de PARTIE, pas des données
 * extraites : le permis d'autel s'obtient par la dévotion et par deux technologies, dont une
 * répétable. Deux est la valeur réaliste en cours de partie.
 */
export const DEFAULT_PERMITS: Record<string, number> = { [SHRINE_PERMIT]: 2 };

/** Combien d'exemplaires de ce bâtiment l'île accepte, tous porteurs du même type confondus. */
export function uniqueCap(d: BuildingDef, permits?: Record<string, number>): number {
  if (!d.uniqueType) return d.unique ? 1 : Infinity;
  const cfg = economy.uniqueTypes?.[d.uniqueType];
  if (!cfg) return 1; // type inconnu de la config : prudence
  const hard = cfg.allowed ?? Infinity;
  const held = cfg.permit
    ? (permits?.[cfg.permit] ?? DEFAULT_PERMITS[cfg.permit] ?? 0)
    : Infinity;
  return Math.min(hard, held);
}
