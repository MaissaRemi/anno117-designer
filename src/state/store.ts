import { create } from "zustand";
import { emptyLayout, placeBuilding, uid } from "../model/factories";
import type {
  BuildingDef,
  Catalog,
  Layout,
  PlacedBuilding,
  Rotation,
} from "../model/types";
import { cellKey, footprintCells } from "../engine/geometry";
import { makeLookup } from "../engine/rules";
import { seedCatalog } from "../data/seed";
import { loadState, saveState } from "../persist/local";
import type { OptimizeResult } from "../optimizer/types";

export type Tool =
  | "select"
  | "place"
  | "move"
  | "draw-grid"
  | "erase-grid"
  | "road"
  | "field"
  | "erase";

const clone = <T>(v: T): T => structuredClone(v);

interface State {
  catalog: Catalog;
  layout: Layout;
  mode: Tool;
  selectedDefId: string | null; // def à poser
  rotation: Rotation; // rotation courante de pose
  selectedUid: string | null; // bâtiment sélectionné
  fieldOwnerUid: string | null; // bâtiment dont on peint le champ
  showRadius: boolean;
  past: Layout[];
  future: Layout[];

  // --- réglages d'édition ---
  setMode: (m: Tool) => void;
  setSelectedDef: (id: string | null) => void;
  setSelectedUid: (uid: string | null) => void;
  setFieldOwner: (uid: string | null) => void;
  rotateCurrent: () => void;
  toggleRadius: () => void;

  // --- mutations layout (avec undo) ---
  addBuildingAt: (x: number, y: number) => void;
  moveBuilding: (uid: string, x: number, y: number) => void;
  removeBuilding: (uid: string) => void;
  rotateBuilding: (uid: string) => void;
  toggleLock: (uid: string) => void;
  paintRoad: (x: number, y: number) => void;
  eraseRoad: (x: number, y: number) => void;
  paintField: (x: number, y: number) => void;
  eraseFieldAt: (x: number, y: number) => void;
  setUsable: (x: number, y: number, usable: boolean) => void;
  resizeGrid: (w: number, h: number) => void;

  // --- catalogue ---
  addDef: (def: BuildingDef) => void;
  updateDef: (def: BuildingDef) => void;
  removeDef: (id: string) => void;

  // --- fichier / historique ---
  undo: () => void;
  redo: () => void;
  newLayout: () => void;
  loadAll: (catalog: Catalog, layout: Layout) => void;
  applyOptimization: (result: OptimizeResult) => void;

  lookup: () => (id: string) => BuildingDef | undefined;
}

const persisted = loadState();

export const useStore = create<State>((set, get) => {
  // Pousse un instantané du layout courant dans l'historique, applique `mutate`.
  function commit(mutate: (l: Layout) => Layout | void): void {
    set((s) => {
      const next = clone(s.layout);
      const result = mutate(next) ?? next;
      return { layout: result, past: [...s.past, s.layout].slice(-100), future: [] };
    });
    persist();
  }

  function persist(): void {
    const s = get();
    saveState(s.catalog, s.layout);
  }

  return {
    catalog: persisted?.catalog ?? seedCatalog(),
    layout: persisted?.layout ?? emptyLayout(40, 40),
    mode: "select",
    selectedDefId: null,
    rotation: 0,
    selectedUid: null,
    fieldOwnerUid: null,
    showRadius: true,
    past: [],
    future: [],

    setMode: (m) => set({ mode: m }),
    setSelectedDef: (id) => set({ selectedDefId: id, mode: id ? "place" : get().mode }),
    setSelectedUid: (u) => set({ selectedUid: u }),
    setFieldOwner: (u) => set({ fieldOwnerUid: u }),
    rotateCurrent: () => set((s) => ({ rotation: rotate90(s.rotation) })),
    toggleRadius: () => set((s) => ({ showRadius: !s.showRadius })),

    addBuildingAt: (x, y) => {
      const { selectedDefId, rotation } = get();
      if (!selectedDefId) return;
      const b = placeBuilding(selectedDefId, x, y, rotation, false);
      commit((l) => {
        l.buildings.push(b);
      });
      set({ selectedUid: b.uid });
    },

    moveBuilding: (u, x, y) =>
      commit((l) => {
        const b = l.buildings.find((bb) => bb.uid === u);
        if (b && !b.locked) {
          b.x = x;
          b.y = y;
        }
      }),

    removeBuilding: (u) =>
      commit((l) => {
        l.buildings = l.buildings.filter((b) => b.uid !== u);
        l.fields = l.fields.filter((f) => f.ownerUid !== u);
      }),

    rotateBuilding: (u) =>
      commit((l) => {
        const b = l.buildings.find((bb) => bb.uid === u);
        if (b) b.rotation = rotate90(b.rotation);
      }),

    toggleLock: (u) =>
      commit((l) => {
        const b = l.buildings.find((bb) => bb.uid === u);
        if (b) b.locked = !b.locked;
      }),

    paintRoad: (x, y) =>
      commit((l) => {
        if (!l.roads.some((r) => r.x === x && r.y === y)) l.roads.push({ x, y });
      }),

    eraseRoad: (x, y) =>
      commit((l) => {
        l.roads = l.roads.filter((r) => !(r.x === x && r.y === y));
      }),

    paintField: (x, y) => {
      const { fieldOwnerUid, catalog } = get();
      if (!fieldOwnerUid) return;
      const lk = makeLookup(catalog);
      commit((l) => {
        const owner = l.buildings.find((b) => b.uid === fieldOwnerUid);
        if (!owner) return;
        const def = lk(owner.defId);
        if (!def?.field) return;
        if (l.fields.some((f) => f.x === x && f.y === y)) return;
        l.fields.push({ x, y, ownerUid: fieldOwnerUid, fieldType: def.field.fieldType });
      });
    },

    eraseFieldAt: (x, y) =>
      commit((l) => {
        l.fields = l.fields.filter((f) => !(f.x === x && f.y === y));
      }),

    setUsable: (x, y, usable) =>
      commit((l) => {
        if (x < 0 || y < 0 || x >= l.grid.w || y >= l.grid.h) return;
        l.grid.usable[y * l.grid.w + x] = usable;
      }),

    resizeGrid: (w, h) =>
      commit((l) => {
        const next = new Array(w * h).fill(true);
        for (let y = 0; y < Math.min(h, l.grid.h); y++) {
          for (let x = 0; x < Math.min(w, l.grid.w); x++) {
            next[y * w + x] = l.grid.usable[y * l.grid.w + x];
          }
        }
        l.grid = { w, h, usable: next };
      }),

    addDef: (def) => {
      set((s) => ({ catalog: [...s.catalog, def] }));
      persist();
    },
    updateDef: (def) => {
      set((s) => ({ catalog: s.catalog.map((d) => (d.id === def.id ? def : d)) }));
      persist();
    },
    removeDef: (id) => {
      set((s) => ({ catalog: s.catalog.filter((d) => d.id !== id) }));
      persist();
    },

    undo: () =>
      set((s) => {
        if (!s.past.length) return s;
        const previous = s.past[s.past.length - 1];
        return {
          layout: previous,
          past: s.past.slice(0, -1),
          future: [s.layout, ...s.future].slice(0, 100),
        };
      }),
    redo: () =>
      set((s) => {
        if (!s.future.length) return s;
        const next = s.future[0];
        return {
          layout: next,
          past: [...s.past, s.layout],
          future: s.future.slice(1),
        };
      }),

    newLayout: () => {
      set((s) => ({
        layout: emptyLayout(s.layout.grid.w, s.layout.grid.h),
        past: [],
        future: [],
        selectedUid: null,
      }));
      persist();
    },

    loadAll: (catalog, layout) => {
      set({ catalog, layout, past: [], future: [], selectedUid: null });
      persist();
    },

    applyOptimization: (result) =>
      commit((l) => {
        const lockedUids = new Set(l.buildings.filter((b) => b.locked).map((b) => b.uid));
        const lockedBuildings = l.buildings.filter((b) => b.locked);
        const lockedFields = l.fields.filter((f) => lockedUids.has(f.ownerUid));
        // routes : garder celles dessinées par l'utilisateur, remplacer les auto-générées
        const roadKey = (r: { x: number; y: number }) => `${r.x},${r.y}`;
        const roadSet = new Map<string, typeof l.roads[number]>();
        for (const r of l.roads) if (!r.gen) roadSet.set(roadKey(r), r);
        for (const r of result.roads) if (!roadSet.has(roadKey(r))) roadSet.set(roadKey(r), { ...r, gen: true });
        l.buildings = [...lockedBuildings, ...result.buildings];
        l.fields = [...lockedFields, ...result.fields];
        l.roads = Array.from(roadSet.values());
      }),

    lookup: () => makeLookup(get().catalog),
  };
});

function rotate90(r: Rotation): Rotation {
  return (((r + 90) % 360) as Rotation);
}

/** Cellules occupées par un bâtiment donné — réexport pratique pour l'UI. */
export function cellsOf(def: BuildingDef, b: PlacedBuilding): string[] {
  return footprintCells(def, b.x, b.y, b.rotation).map((c) => cellKey(c.x, c.y));
}

export { uid };
