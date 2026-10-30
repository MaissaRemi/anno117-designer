import rawCatalog from "../data/catalog.generated.json";
import { economy, worldOf } from "../economy/economy";
import type { BuildingDef } from "../model/types";
import type { IleDuMonde } from "./configuration";

/**
 * FERTILITÉS D'UNE ÎLE, rangées comme le joueur les lit en jeu : terrestres, maritimes,
 * minières, de rivière (et, en Albion, de marais et de prairie).
 *
 * La catégorie vient des DONNÉES : l'emplacement du bâtiment qui exige la fertilité (`slotType`
 * ou `placement` du catalogue). Une fertilité qu'aucun bâtiment n'exige (sardines, blé, avoine,
 * charbon, argile, obsidienne dans les données extraites) n'est pas proposée : la saisir ne
 * changerait rien au calcul.
 */

export type CategorieFertilite = "terre" | "cote" | "montagne" | "riviere" | "marais" | "prairie" | "foret";

export const LIBELLES_CATEGORIE: Record<CategorieFertilite, string> = {
  terre: "Terrestres", cote: "Maritimes", montagne: "Minières", riviere: "Rivière",
  marais: "Marais", prairie: "Prairie", foret: "Forêt",
};
const ORDRE: CategorieFertilite[] = ["terre", "cote", "montagne", "riviere", "marais", "prairie", "foret"];

const catalog = rawCatalog as unknown as BuildingDef[];

const categorieDe = (d: BuildingDef | undefined): CategorieFertilite => {
  const t = d?.slotType ?? (d?.placement === "water" ? "coastal" : undefined);
  switch (t) {
    case "coastal": return "cote";
    case "mountain": return "montagne";
    case "river": return "riviere";
    case "marsh": return "marais";
    case "meadow": return "prairie";
    case "forest": return "foret";
    default: return "terre";
  }
};

export interface FertiliteProposee {
  guid: string;
  nom: string;
  /** Une fertilité peut servir deux sortes d'emplacement (l'or : mine et rivière) : elle
   *  apparaît alors dans les deux groupes, et c'est la même case qu'on coche. */
  categories: CategorieFertilite[];
}

let cache: Map<string, FertiliteProposee[]> | undefined;

/** Fertilités qu'un bâtiment de la province exige, groupées par catégorie, dans l'ordre d'affichage. */
export function fertilitesDeLaProvince(province: string): { categorie: CategorieFertilite; libelle: string; fertilites: FertiliteProposee[] }[] {
  if (!cache) {
    const parId = new Map(catalog.map((d) => [d.id, d]));
    cache = new Map();
    for (const [id, p] of Object.entries(economy.buildingProd)) {
      const f = p.fertility;
      if (!f || !economy.fertilities[f]) continue;
      const d = parId.get(id);
      const monde = worldOf(economy.buildingRegion[id] ?? d?.region ?? "Roman");
      const liste = cache.get(monde) ?? [];
      const cat = categorieDe(d);
      const deja = liste.find((x) => x.guid === f);
      if (!deja) liste.push({ guid: f, nom: economy.fertilities[f], categories: [cat] });
      else if (!deja.categories.includes(cat)) deja.categories.push(cat);
      cache.set(monde, liste);
    }
  }
  const liste = cache.get(worldOf(province)) ?? [];
  return ORDRE
    .map((categorie) => ({
      categorie,
      libelle: LIBELLES_CATEGORIE[categorie],
      fertilites: liste.filter((f) => f.categories.includes(categorie)).sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    }))
    .filter((g) => g.fertilites.length > 0);
}

/** Les fertilités d'une île, en clair (« lin, olives, Gisement de fer »). */
export const fertilitesLisibles = (i: Pick<IleDuMonde, "fertilites">): string =>
  i.fertilites === null ? "fertilités inconnues"
    : i.fertilites.map((f) => (economy.fertilities[f] ?? f).replace(/^Fertilité \((.*)\)$/, "$1")).join(", ") || "aucune fertilité";
