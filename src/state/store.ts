import { create } from "zustand";
import { emptyLayout, placeBuilding, resizeGridShape, uid } from "../model/factories";
import type {
  BuildingDef,
  Catalog,
  Layout,
  Rotation,
} from "../model/types";
import { makeLookup } from "../engine/rules";
import { gridScale } from "../engine/geometry";
import { seedCatalog } from "../data/seed";
import { loadState, saveState } from "../persist/local";
import { loadParty, saveParty, type PartyState } from "../persist/party";
import type { ResourceProfile } from "../economy/resources";
import type { OptimizeResult } from "../optimizer/types";
import { decodeMask, islandById, upscale2x } from "../data/islands";
import { riversOf, slotsOf } from "../data/terrain";

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
  diagonalBuild: boolean; // pose 45° activée (DiagonalBuildEnabled du jeu) → rotation par crans de 45°
  coverageHighlight: string[] | null; // cellKeys de résidences non couvertes à surligner
  past: Layout[];
  future: Layout[];

  // --- réglages d'édition ---
  setMode: (m: Tool) => void;
  setSelectedDef: (id: string | null) => void;
  setSelectedUid: (uid: string | null) => void;
  setFieldOwner: (uid: string | null) => void;
  rotateCurrent: () => void;
  toggleRadius: () => void;
  toggleDiagonalBuild: () => void;

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
  loadIsland: (id: string) => void;
  applyOptimization: (result: OptimizeResult) => void;
  setCoverageHighlight: (cells: string[] | null) => void;

  // --- config de partie (îles + profils de ressources, persistés à part) ---
  partyIslands: string[];
  islandProfiles: Record<string, ResourceProfile>;
  setPartyIslands: (ids: string[]) => void;
  addPartyIsland: (id: string) => void;
  removePartyIsland: (id: string) => void;
  setIslandProfile: (id: string, profile: ResourceProfile) => void;

  lookup: () => (id: string) => BuildingDef | undefined;
}

const persisted = loadState();
const persistedParty = loadParty();

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

  function persistParty(): void {
    const s = get();
    saveParty({ partyIslands: s.partyIslands, islandProfiles: s.islandProfiles } satisfies PartyState);
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
    diagonalBuild: false,
    coverageHighlight: null,
    partyIslands: persistedParty.partyIslands,
    islandProfiles: persistedParty.islandProfiles,
    past: [],
    future: [],

    setMode: (m) => set({ mode: m }),
    setSelectedDef: (id) => set({ selectedDefId: id, mode: id ? "place" : get().mode }),
    setSelectedUid: (u) => set({ selectedUid: u }),
    setFieldOwner: (u) => set({ fieldOwnerUid: u }),
    rotateCurrent: () => set((s) => ({ rotation: rotateStep(s.rotation, s.diagonalBuild ? 45 : 90) })),
    toggleRadius: () => set((s) => ({ showRadius: !s.showRadius })),
    // bascule la pose 45° ; en repassant en axe, on resnap la rotation courante au multiple de 90°
    toggleDiagonalBuild: () =>
      set((s) => {
        const diagonalBuild = !s.diagonalBuild;
        const rotation = diagonalBuild ? s.rotation : (snapTo90(s.rotation) as Rotation);
        return { diagonalBuild, rotation };
      }),

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
        if (b) b.rotation = rotateStep(b.rotation, get().diagonalBuild ? 45 : 90);
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
        // 1 clic = 1 TUILE-jeu = bloc scale×scale de cellules (cohérent avec validateFields
        // qui exige def.field.tiles × scale² cellules ; à scale 1 = 1 cellule, inchangé)
        const s = gridScale(l.grid);
        const bx = x - (x % s), by = y - (y % s);
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
          const cx = bx + dx, cy = by + dy;
          if (cx < 0 || cy < 0 || cx >= l.grid.w || cy >= l.grid.h) continue;
          if (l.fields.some((f) => f.x === cx && f.y === cy)) continue;
          l.fields.push({ x: cx, y: cy, ownerUid: fieldOwnerUid, fieldType: def.field!.fieldType });
        }
      });
    },

    eraseFieldAt: (x, y) =>
      commit((l) => {
        const s = gridScale(l.grid);
        const bx = x - (x % s), by = y - (y % s); // efface la TUILE entière
        l.fields = l.fields.filter((f) => !(f.x >= bx && f.x < bx + s && f.y >= by && f.y < by + s));
      }),

    setUsable: (x, y, usable) =>
      commit((l) => {
        if (x < 0 || y < 0 || x >= l.grid.w || y >= l.grid.h) return;
        l.grid.usable[y * l.grid.w + x] = usable;
      }),

    resizeGrid: (w, h) =>
      commit((l) => {
        // préserve le terrain (eau/rivières/slots/île) au lieu de l'effacer
        l.grid = resizeGridShape(l.grid, w, h);
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

    loadIsland: (id) => {
      const isl = islandById(id);
      if (!isl) return;
      // île décodée en TUILES, puis suréchantillonnée ×2 → grille VIVANTE ½-tuile
      // (cellsPerTile=2) : la résolution requise pour la construction 45° (cf. geometry.ts).
      const tw = isl.size.w, th = isl.size.h;
      const usableT = decodeMask(isl.mask, tw, th);
      const riversT = riversOf(id, tw, th);
      if (riversT) for (let i = 0; i < riversT.length; i++) if (riversT[i]) usableT[i] = false; // rivière non constructible
      const usable = upscale2x(usableT, tw, th);
      const water = usable.map((land) => !land); // mer = non-terre
      const rivers = riversT ? upscale2x(riversT, tw, th) : undefined;
      const slots = slotsOf(id).map((s) => ({ type: s.type, x: Math.round(s.x) * 2, y: Math.round(s.y) * 2 }));
      set({
        layout: {
          grid: { w: tw * 2, h: th * 2, usable, water, rivers, slots: slots.length ? slots : undefined, islandId: id, cellsPerTile: 2 },
          buildings: [], fields: [], roads: [],
        },
        past: [],
        future: [],
        selectedUid: null,
      });
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
        // aqueducs : même politique que les routes (les dessinés à la main restent)
        const kept = (l.aqueducts ?? []).filter((a) => !a.gen);
        l.aqueducts = [...kept, ...(result.aqueducts ?? []).map((a) => ({ ...a, gen: true }))];
      }),

    setCoverageHighlight: (cells) => set({ coverageHighlight: cells }),

    setPartyIslands: (ids) => { set({ partyIslands: ids }); persistParty(); },
    addPartyIsland: (id) => {
      set((s) => (s.partyIslands.includes(id) ? s : { partyIslands: [...s.partyIslands, id] }));
      persistParty();
    },
    removePartyIsland: (id) => {
      set((s) => ({ partyIslands: s.partyIslands.filter((x) => x !== id) }));
      persistParty();
    },
    setIslandProfile: (id, profile) => {
      set((s) => ({ islandProfiles: { ...s.islandProfiles, [id]: profile } }));
      persistParty();
    },

    lookup: () => makeLookup(get().catalog),
  };
});

/** Avance la rotation d'un cran (45° en pose diagonale, 90° en axe). 8 valeurs possibles. */
function rotateStep(r: Rotation, step: 45 | 90): Rotation {
  return (((r + step) % 360) as Rotation);
}

/** Resnap au multiple de 90° le plus proche (retour en mode axe depuis une pose 45°). */
function snapTo90(r: Rotation): 0 | 90 | 180 | 270 {
  return ((Math.round(r / 90) * 90) % 360) as 0 | 90 | 180 | 270;
}

export { uid };
