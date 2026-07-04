import { useState } from "react";
import { useStore } from "../state/store";
import { islands } from "../data/islands";
import { exportJson, importJson } from "../persist/json";
import { exportPng } from "../persist/png";
import { findOrphanRefs } from "../model/serialize";
import { migrateV7toV8 } from "../persist/local";
import { renderFullCanvas } from "../render/exportImage";
import { IslandPicker } from "./IslandPicker";

export function TopBar() {
  const catalog = useStore((s) => s.catalog);
  const layout = useStore((s) => s.layout);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const newLayout = useStore((s) => s.newLayout);
  const loadAll = useStore((s) => s.loadAll);
  const resizeGrid = useStore((s) => s.resizeGrid);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [menu, setMenu] = useState(false);
  const [islOpen, setIslOpen] = useState(false);

  const islandName = layout.grid.islandId ? islands.find((i) => i.id === layout.grid.islandId)?.name : null;
  const close = () => setMenu(false);

  const onImport = async () => {
    try {
      const raw = await importJson();
      const file = (raw.layout.grid.cellsPerTile ?? 1) === 2 ? raw : migrateV7toV8(raw);
      const issues = findOrphanRefs(file.catalog, file.layout);
      if (issues.orphanDefs.length || issues.orphanFieldOwners) {
        const preview = issues.orphanDefs.slice(0, 5).join(", ") + (issues.orphanDefs.length > 5 ? "…" : "");
        const ok = confirm(
          `⚠ Références manquantes dans la disposition importée :\n` +
            `• ${issues.orphanDefs.length} type(s) de bâtiment absent(s) du catalogue${preview ? ` (${preview})` : ""}\n` +
            (issues.orphanFieldOwners ? `• ${issues.orphanFieldOwners} champ(s) sans bâtiment propriétaire\n` : "") +
            `Ces éléments seront invisibles. Charger quand même ?`,
        );
        if (!ok) return;
      }
      loadAll(file.catalog, file.layout);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onPng = () => exportPng(renderFullCanvas(layout, catalog));

  return (
    <div className="topbar">
      <span className="tb-title">Anno 117 · Designer</span>
      {islandName && <span className="tb-island">— {islandName}</span>}

      <span className="spacer" />

      <button className="icon-btn" onClick={() => canUndo && undo()} disabled={!canUndo} title="Annuler (Ctrl+Z)" aria-label="Annuler">↶</button>
      <button className="icon-btn" onClick={() => canRedo && redo()} disabled={!canRedo} title="Rétablir (Ctrl+Y)" aria-label="Rétablir">↷</button>
      <span className="sep" />
      <button onClick={() => setIslOpen(true)}>🏝 Charger une île</button>

      <div className="menu">
        <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu fichier">⋯</button>
        {menu && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={close} />
            <div className="menu-pop">
              <label>
                Grille
                <input type="number" min={10} max={400} value={layout.grid.w}
                  onChange={(e) => resizeGrid(clamp(e.target.value, layout.grid.w), layout.grid.h)} style={{ width: 60 }} />
                ×
                <input type="number" min={10} max={400} value={layout.grid.h}
                  onChange={(e) => resizeGrid(layout.grid.w, clamp(e.target.value, layout.grid.h))} style={{ width: 60 }} />
              </label>
              <div className="sep-h" />
              <button onClick={() => { close(); if (confirm("Nouvelle disposition vide ?")) newLayout(); }}>🗑 Nouveau</button>
              <button onClick={() => { close(); onImport(); }}>⬆ Importer JSON</button>
              <button onClick={() => { close(); exportJson(catalog, layout); }}>⬇ Exporter JSON</button>
              <button onClick={() => { close(); onPng(); }}>🖼 Exporter PNG</button>
            </div>
          </>
        )}
      </div>

      {islOpen && <IslandPicker onClose={() => setIslOpen(false)} />}
    </div>
  );
}

function clamp(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(400, n));
}
