import { parse, serialize, type SaveFile } from "../model/serialize";
import type { Catalog, Layout } from "../model/types";

/** Télécharge la disposition + catalogue en fichier JSON. */
export function exportJson(catalog: Catalog, layout: Layout, filename = "anno117-plan.json"): void {
  const blob = new Blob([serialize(catalog, layout)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ouvre un sélecteur de fichier et renvoie le contenu parsé. */
export function importJson(): Promise<SaveFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("Aucun fichier sélectionné."));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(parse(String(reader.result)));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
      reader.readAsText(file);
    };
    input.click();
  });
}
