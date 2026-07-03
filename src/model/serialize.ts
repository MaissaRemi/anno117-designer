import type { Catalog, Layout } from "./types";

export interface SaveFile {
  app: "anno117-designer";
  version: number; // 8 = grille ½-tuile (cellsPerTile). Un fichier tuile (v≤7) est migré ×2 à l'import.
  catalog: Catalog;
  layout: Layout;
}

export function toSaveFile(catalog: Catalog, layout: Layout): SaveFile {
  return { app: "anno117-designer", version: 8, catalog, layout };
}

export function serialize(catalog: Catalog, layout: Layout): string {
  return JSON.stringify(toSaveFile(catalog, layout), null, 2);
}

export function parse(text: string): SaveFile {
  const data = JSON.parse(text) as Partial<SaveFile>;
  if (data.app !== "anno117-designer") {
    throw new Error("Fichier invalide : ce n'est pas une sauvegarde Anno 117 Designer.");
  }
  if (!data.catalog || !data.layout) {
    throw new Error("Fichier invalide : catalogue ou disposition manquant.");
  }
  return data as SaveFile;
}

export interface RefIssues {
  orphanDefs: string[]; // defId référencés mais absents du catalogue (bâtiments invisibles)
  orphanFieldOwners: number; // champs dont le bâtiment propriétaire n'existe pas
}

/**
 * Vérifie l'intégrité référentielle d'une disposition : tout `defId` doit exister
 * dans le catalogue et tout champ doit pointer un bâtiment réel. Sinon → éléments
 * invisibles au rendu (perte de données silencieuse). À appeler avant import.
 */
export function findOrphanRefs(catalog: Catalog, layout: Layout): RefIssues {
  const defIds = new Set(catalog.map((d) => d.id));
  const buildingUids = new Set(layout.buildings.map((b) => b.uid));
  const orphanDefs = new Set<string>();
  for (const b of layout.buildings) if (!defIds.has(b.defId)) orphanDefs.add(b.defId);
  let orphanFieldOwners = 0;
  for (const f of layout.fields) if (!buildingUids.has(f.ownerUid)) orphanFieldOwners++;
  return { orphanDefs: [...orphanDefs], orphanFieldOwners };
}
