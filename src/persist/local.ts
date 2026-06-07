import type { Catalog, Layout } from "../model/types";

// v2 : nouveau catalogue (données réelles extraites du jeu).
const KEY = "anno117-designer:state:v2";

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

export function loadState(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Persisted;
    if (!data.catalog || !data.layout) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
