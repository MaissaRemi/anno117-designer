import type { Catalog, GridShape, Layout } from "../model/types";
import { upscale2x } from "../data/islands";

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

export function loadState(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Persisted;
      if (!data.catalog || !data.layout) return null;
      return data;
    }
    // pas de v8 : tenter une migration depuis v7 (tuiles → ½-tuiles ×2)
    const rawV7 = localStorage.getItem(KEY_V7);
    if (!rawV7) return null;
    const dataV7 = JSON.parse(rawV7) as Persisted;
    if (!dataV7.catalog || !dataV7.layout) return null;
    const migrated = migrateV7toV8(dataV7);
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
