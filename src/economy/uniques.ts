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
 * répétable.
 *
 * UN SEUL, et le choix est mesuré. L'île n'a besoin que d'un sanctuaire — c'est ce que
 * l'utilisateur attend du jeu, et la population le confirme : sur `roman_island_small_06`, un
 * sanctuaire loge 10 279 habitants contre 9 888 avec deux et 10 137 avec sept. Les copies
 * supplémentaires prennent du sol sans rien rendre de plus, le rayon d'un sanctuaire couvrant
 * déjà l'essentiel du quartier qu'il sert.
 *
 * Reste un plancher, pas un plafond : la requête peut relever `permits` si la partie a
 * débloqué davantage de dévotion.
 */
export const DEFAULT_PERMITS: Record<string, number> = { [SHRINE_PERMIT]: 1 };

/** Combien d'exemplaires de ce bâtiment l'île accepte, tous porteurs du même type confondus. */
export function uniqueCap(d: BuildingDef, permits?: Record<string, number>): number {
  if (!d.uniqueType) return d.unique ? 1 : Infinity;
  const cfg = economy.uniqueTypes?.[d.uniqueType];
  if (!cfg) return 1; // type inconnu de la config : prudence
  const hard = cfg.allowed ?? Infinity;
  // UN PERMIS EST CONSOMMÉ PAR EXEMPLAIRE : c'est bien un PLAFOND, pas un simple déverrouillage.
  //
  // Tenté un temps de lire le permis comme un interrupteur — permis en poche, copies à volonté.
  // Réfuté par l'observation : le plan posait alors 7 sanctuaires sur `roman_island_small_06` et
  // 13 sur `celtic_island_large_07`. Le nombre détenu borne bien le nombre posé.
  //
  // Ce que ce plafond ne dit PAS, c'est de quelle divinité il s'agit : `uniqueUsed` est indexé
  // par TYPE, si bien que deux permis autorisent deux sanctuaires — pas deux dieux. L'unicité du
  // dieu est une règle distincte, tenue par l'élection du patron dans `islandPlan`.
  //
  // Le plafond dur reste `allowed` quand le jeu en déclare un (Colisée, quartier général : 1).
  const held = cfg.permit
    ? (permits?.[cfg.permit] ?? DEFAULT_PERMITS[cfg.permit] ?? 0)
    : Infinity;
  return Math.min(hard, held);
}
