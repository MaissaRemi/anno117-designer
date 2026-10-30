import type { RoadType } from "../engine/roads";
import type { AqueductTile, FieldTile, PlacedBuilding, RoadTile } from "../model/types";

/**
 * Un plan à poser dans l'éditeur (`applyOptimization`). Le nom vient de l'ancien optimiseur à
 * recuit (`greedy`, `anneal`, `score`), retiré le 30/10/2026 : plus rien ne l'appelait depuis
 * l'île de production. Les planificateurs d'aujourd'hui rendent ce même format.
 */
export interface OptimizeResult {
  buildings: PlacedBuilding[]; // bâtiments placés par l'optimiseur (hors verrouillés)
  roads: RoadTile[]; // routes générées (hors existantes)
  fields: FieldTile[]; // champs générés
  aqueducts?: AqueductTile[]; // conduites d'eau générées (plan d'île)
  /** type de route pour lequel le plan a été calculé : le layout le reprend */
  roadType?: RoadType;
  placed: number; // nb de bâtiments placés
  requested: number; // nb total demandé
  placedByDef: Record<string, number>;
  score: number;
  breakdown: { count: number; roadLen: number; bboxArea: number; coverage: number };
}
