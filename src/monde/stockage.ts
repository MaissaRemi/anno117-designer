import { normaliserConfiguration, type ConfigurationMonde } from "./configuration";

/**
 * STOCKAGE DES CONFIGURATIONS DE MONDE — IndexedDB.
 *
 * Pas `localStorage` : il plafonne autour de 5 Mo pour tout le site, et une configuration
 * portera bientôt les plans de plusieurs îles. Sans IndexedDB (navigation privée de certains
 * navigateurs, tests), un dépôt en mémoire prend le relais : l'outil marche, rien ne survit au
 * rechargement, et `persistant` le dit à l'interface.
 *
 * Tout ce qui sort du dépôt passe par `normaliserConfiguration` : une base écrite par une
 * version précédente, ou abîmée, ne doit pas faire tomber l'onglet.
 */

export interface DepotMondes {
  readonly persistant: boolean;
  lister(): Promise<ConfigurationMonde[]>;
  enregistrer(c: ConfigurationMonde): Promise<void>;
  supprimer(id: string): Promise<void>;
}

const BASE = "anno117-designer";
const MAGASIN = "mondes";

/** Les plus récemment modifiées d'abord. */
const trier = (l: ConfigurationMonde[]) => l.sort((a, b) => b.modifieLe.localeCompare(a.modifieLe) || a.id.localeCompare(b.id));
const valides = (brut: unknown[]) => brut.map(normaliserConfiguration).filter((c): c is ConfigurationMonde => c !== null);

export function depotEnMemoire(): DepotMondes {
  const m = new Map<string, ConfigurationMonde>();
  return {
    persistant: false,
    lister: async () => trier(valides([...m.values()].map((c) => structuredClone(c)))),
    enregistrer: async (c) => { m.set(c.id, structuredClone(c)); },
    supprimer: async (id) => { m.delete(id); },
  };
}

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MAGASIN)) req.result.createObjectStore(MAGASIN, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function depotIndexedDB(db: IDBDatabase): DepotMondes {
  const transaction = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const t = db.transaction(MAGASIN, mode);
      const r = f(t.objectStore(MAGASIN));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    persistant: true,
    lister: async () => trier(valides(await transaction("readonly", (s) => s.getAll()))),
    enregistrer: async (c) => { await transaction("readwrite", (s) => s.put(c)); },
    supprimer: async (id) => { await transaction("readwrite", (s) => s.delete(id)); },
  };
}

let depot: Promise<DepotMondes> | undefined;

/** Le dépôt de l'application : IndexedDB si possible, sinon en mémoire. Ouvert une seule fois. */
export function depotMondes(): Promise<DepotMondes> {
  depot ??= (typeof indexedDB === "undefined" ? Promise.reject(new Error("pas d'IndexedDB")) : ouvrir())
    .then(depotIndexedDB, () => depotEnMemoire());
  return depot;
}

/** Contenu d'un fichier d'export : une configuration, ou une liste. */
export function lireExport(texte: string): ConfigurationMonde[] {
  let brut: unknown;
  try { brut = JSON.parse(texte); } catch { return []; }
  return valides(Array.isArray(brut) ? brut : [brut]);
}
