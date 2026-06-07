import type { Catalog, Layout } from "./types";

export interface SaveFile {
  app: "anno117-designer";
  version: 1;
  catalog: Catalog;
  layout: Layout;
}

export function toSaveFile(catalog: Catalog, layout: Layout): SaveFile {
  return { app: "anno117-designer", version: 1, catalog, layout };
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
