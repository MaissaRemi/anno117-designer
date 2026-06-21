import type { AqueductTile, BuildingDef, FieldTile, GridShape, PlacedBuilding, RoadTile } from "../model/types";

/** Objectif pondéré (sliders UI, 0..1 chacun). */
export interface Weights {
  count: number; // maximiser le nb de bâtiments placés
  roads: number; // minimiser la longueur de routes
  compact: number; // minimiser l'emprise (compacité)
  coverage: number; // maximiser la couverture par les rayons
}

export interface RequestItem {
  defId: string;
  qty: number;
}

export interface OptimizeRequest {
  catalog: BuildingDef[];
  grid: GridShape;
  lockedBuildings: PlacedBuilding[]; // fixes : conservés tels quels
  existingRoads: RoadTile[]; // routes déjà dessinées (comptent pour l'accès)
  existingFields: FieldTile[]; // champs des bâtiments verrouillés
  items: RequestItem[];
  weights: Weights;
  timeMs: number; // budget de calcul (ignoré si maxIters est défini)
  seed?: number; // graine du PRNG du recuit (défaut fixe → reproductible)
  maxIters?: number; // si défini : nb d'itérations FIXE (au lieu du budget temps) → déterministe
}

export interface OptimizeResult {
  buildings: PlacedBuilding[]; // bâtiments placés par l'optimiseur (hors verrouillés)
  roads: RoadTile[]; // routes générées (hors existantes)
  fields: FieldTile[]; // champs générés
  aqueducts?: AqueductTile[]; // conduites d'eau générées (plan d'île)
  placed: number; // nb de bâtiments placés
  requested: number; // nb total demandé
  placedByDef: Record<string, number>;
  score: number;
  breakdown: { count: number; roadLen: number; bboxArea: number; coverage: number };
}

export interface Progress {
  type: "progress";
  iter: number;
  best: number; // meilleur score
  placed: number;
  requested: number;
}

export interface Done {
  type: "done";
  result: OptimizeResult;
}

export type WorkerMessage = Progress | Done;

export const DEFAULT_WEIGHTS: Weights = { count: 1, roads: 0.3, compact: 0.3, coverage: 0.2 };
