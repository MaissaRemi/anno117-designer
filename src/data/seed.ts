import type { Catalog } from "../model/types";
import generated from "./catalog.generated.json";

/**
 * Catalogue par défaut : données réelles extraites des fichiers d'Anno 117
 * (tailles, routes, rayons, champs, production, noms FR, icônes).
 * Régénérable via `python tools/build_catalog.py` + `python tools/extract_icons.py`.
 *
 * Note : les tailles proviennent du BoundingBox des .ifo (approx. ±1 case) —
 * corrigeables via l'éditeur de catalogue.
 */
export function seedCatalog(): Catalog {
  return generated as unknown as Catalog;
}
