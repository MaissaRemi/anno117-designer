import { hasHeights, heightsOf } from "../data/terrain";
import type { BuildingDef, GridShape } from "../model/types";
import { makeLookup } from "../engine/rules";
import { downscaleGrid, scaleResultToHalfTile } from "../optimizer/halfTileAdapter";
import type { Commande } from "./nomenclature";
import { planifierCommande, resumer, type ResultatCommande } from "./planifier";

export interface CommandeRequete {
  grid: GridShape;
  commande: Commande;
  catalog: BuildingDef[];
}

export type CommandeMsg =
  | { type: "done"; result: ResultatCommande }
  | { type: "error"; message: string };

/**
 * Planifie une commande hors du fil de l'interface : une grande île demande plusieurs secondes.
 * Même adaptateur que le plan d'île — on résout en TUILES, on rend en ½-tuiles.
 */
self.onmessage = async (e: MessageEvent<CommandeRequete>) => {
  const post = (m: CommandeMsg) => (self as unknown as Worker).postMessage(m);
  try {
    const { grid, commande, catalog } = e.data;
    const tuile = downscaleGrid(grid);
    const id = grid.islandId;
    const h = id && hasHeights(id) ? await heightsOf(id) : null;
    const heights = h && h.length === tuile.w * tuile.h ? h : undefined;
    const plan = planifierCommande(tuile, commande, catalog, makeLookup(catalog), { heights });
    const r = resumer(plan);
    post({ type: "done", result: scaleResultToHalfTile(r, (grid.cellsPerTile ?? 1) === 2) });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};

export {};
