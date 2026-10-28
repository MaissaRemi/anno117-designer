import type { BuildingDef } from "../model/types";

/**
 * ═══ LE TYPE DE ROUTE ALLONGE LA PORTÉE DES SERVICES ═══════════════════════════════════
 *
 * La portée d'un service n'est pas une distance mais un BUDGET DE TRAJET le long des rues.
 * Les données du jeu le disent en deux endroits :
 *   - `Street Roman Paved Road` (23996) porte `LogicisticSpeedFactor` = 1.5 ;
 *   - son texte : « Permet un transport plus rapide des marchandises et prolonge ainsi la
 *     portée des bâtiments ».
 * La route en marbre (77947) hérite de la pavée (`BaseAssetGUID` 23996) sans redéfinir le
 * facteur : même vitesse, plus du prestige. Le chemin de terre (8541) n'en porte aucun, donc 1.
 * Pavée et marbre se débloquent par la recherche (`StoneStreets`, `MarbleStreets`).
 *
 * Tant que ce facteur était ignoré, toutes les portées étaient comptées sur la terre : un plan
 * en routes pavées posait ~2,25 fois trop de services (la surface couverte croît au carré).
 *
 * Le type est UNIFORME pour un plan : une route mixte se planifie au type le plus lent.
 */
export type RoadType = "terre" | "pavee" | "marbre";

export const ROAD_TYPES: readonly { id: RoadType; label: string; factor: number }[] = [
  { id: "terre", label: "Chemin de terre", factor: 1 },
  { id: "pavee", label: "Route pavée", factor: 1.5 },
  { id: "marbre", label: "Route en marbre", factor: 1.5 },
];

export const DEFAULT_ROAD_TYPE: RoadType = "terre";

export const roadFactor = (t: RoadType | undefined): number =>
  ROAD_TYPES.find((r) => r.id === (t ?? DEFAULT_ROAD_TYPE))?.factor ?? 1;

/**
 * Portée de PLANIFICATION d'un bâtiment, en cases de route du type donné.
 *
 * `streetRange` se mesure le long des rues : il prend le facteur. `radius.range` est un disque
 * qui ne suit pas les rues (repli des bâtiments sans portée-rue) : il ne le prend pas.
 */
export function planningRange(def: BuildingDef, roadType?: RoadType): number {
  if (def.streetRange) return Math.floor(def.streetRange * roadFactor(roadType));
  return def.radius?.range || 0;
}
