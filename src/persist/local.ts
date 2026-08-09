import type { Catalog, GridShape, Layout } from "../model/types";
import { upscale2x } from "../data/islands";
import { seedCatalog } from "../data/seed";

// v8 : grille VIVANTE en ½-tuiles (cellsPerTile=2) pour la construction 45°.
//      Un état v7 (tuiles) est suréchantillonné ×2 au chargement.
const KEY = "anno117-designer:state:v8";
const KEY_V7 = "anno117-designer:state:v7";

interface Persisted {
  catalog: Catalog;
  layout: Layout;
}

/** Sauvegarde auto dans le navigateur (localStorage). */
export function saveState(catalog: Catalog, layout: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ catalog, layout }));
  } catch {
    // quota plein / mode privé : on ignore silencieusement.
  }
}

/** Suréchantillonne un layout TUILE (v7) en ½-tuiles (v8) : tout ×2, masques upscale2x. */
export function migrateV7toV8(data: Persisted): Persisted {
  const g = data.layout.grid;
  const tw = g.w, th = g.h;
  const grid: GridShape = {
    w: tw * 2,
    h: th * 2,
    usable: upscale2x(g.usable, tw, th),
    water: g.water ? upscale2x(g.water, tw, th) : undefined,
    rivers: g.rivers ? upscale2x(g.rivers, tw, th) : undefined,
    slots: g.slots?.map((s) => ({ ...s, x: s.x * 2, y: s.y * 2 })),
    islandId: g.islandId,
    cellsPerTile: 2,
  };
  const x2 = <T extends { x: number; y: number }>(arr: T[] | undefined): T[] | undefined =>
    arr?.map((e) => ({ ...e, x: e.x * 2, y: e.y * 2 }));
  return {
    catalog: data.catalog,
    layout: {
      grid,
      buildings: data.layout.buildings.map((b) => ({ ...b, x: b.x * 2, y: b.y * 2 })),
      roads: x2(data.layout.roads) ?? [],
      fields: x2(data.layout.fields) ?? [],
      aqueducts: x2(data.layout.aqueducts),
    },
  };
}

/**
 * LE CATALOGUE DU JEU EST AUTORITAIRE, LE CATALOGUE PERSISTÉ NE L'EST PAS.
 *
 * Le catalogue était rendu tel qu'il avait été enregistré, sans jamais être confronté aux
 * données extraites du jeu. Un navigateur ayant ouvert l'application une fois gardait donc
 * indéfiniment la version des définitions de ce jour-là — y compris les CHAMPS QUI N'EXISTAIENT
 * PAS ENCORE.
 *
 * C'est ce qui a fait poser une divinité de chaque sur une île. `uniqueType` a été ajouté à
 * l'extraction bien après les premières ouvertures : dans un catalogue figé, les seize
 * sanctuaires n'en portent aucun, `uniqueCap` renvoie donc l'infini, et plus rien ne borne le
 * nombre ni la variété. Mesuré sur le poste concerné : 6 dieux × 4 exemplaires, plus 8 copies
 * de l'ancien archétype — là où le même plan, calculé sur le catalogue extrait, en pose UN.
 *
 * Le défaut est sournois parce qu'il est INVISIBLE côté serveur : le code servi était bien à
 * jour, les mesures faites sur le catalogue extrait étaient justes, et rien ne les reliait à ce
 * que le navigateur exécutait vraiment.
 *
 * La règle est donc : toute définition présente dans les données du jeu ÉCRASE sa copie
 * persistée. Ce que l'utilisateur a ajouté lui-même — un identifiant absent des données
 * extraites — est conservé intact. Contrepartie assumée : une retouche faite sur un bâtiment du
 * jeu via l'éditeur de catalogue est perdue au rechargement. C'est le bon compromis pour une
 * application dont toute l'économie est dérivée de fichiers regénérés par outillage : une
 * donnée périmée y casse l'optimiseur en silence, une retouche perdue se refait.
 */
function refreshFromGameData(persisted: Catalog): Catalog {
  const jeu = seedCatalog();
  const parId = new Map(jeu.map((d) => [d.id, d]));
  const propres = persisted.filter((d) => !parId.has(d.id));
  return [...jeu, ...propres];
}

export function loadState(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Persisted;
      if (!data.catalog || !data.layout) return null;
      return { ...data, catalog: refreshFromGameData(data.catalog) };
    }
    // pas de v8 : tenter une migration depuis v7 (tuiles → ½-tuiles ×2)
    const rawV7 = localStorage.getItem(KEY_V7);
    if (!rawV7) return null;
    const dataV7 = JSON.parse(rawV7) as Persisted;
    if (!dataV7.catalog || !dataV7.layout) return null;
    const migrated = migrateV7toV8(dataV7);
    // Un état v7 est par construction le plus ancien : son catalogue est celui qui a le plus
    // de retard sur les données du jeu. Il passe donc par le même rafraîchissement.
    migrated.catalog = refreshFromGameData(migrated.catalog);
    saveState(migrated.catalog, migrated.layout); // persiste la version migrée
    try { localStorage.removeItem(KEY_V7); } catch { /* ignore */ } // évite de re-migrer chaque chargement
    return migrated;
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_V7);
  } catch {
    /* ignore */
  }
}
