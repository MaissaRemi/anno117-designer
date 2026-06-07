import { useState } from "react";
import { useStore } from "../state/store";
import { exportJson, importJson } from "../persist/json";
import { exportPng } from "../persist/png";
import { OptimizerPanel } from "./OptimizerPanel";

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
  const [optOpen, setOptOpen] = useState(false);

  const onImport = async () => {
    try {
      const file = await importJson();
      loadAll(file.catalog, file.layout);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onPng = () => {
    const canvas = document.querySelector("canvas");
    if (canvas) exportPng(canvas);
  };

  return (
    <div className="topbar">
      <strong className="brand">Anno 117 · Designer</strong>

      <button onClick={() => canUndo && undo()} disabled={!canUndo} title="Annuler (Ctrl+Z)">
        ↶ Annuler
      </button>
      <button onClick={() => canRedo && redo()} disabled={!canRedo} title="Rétablir (Ctrl+Y)">
        ↷ Rétablir
      </button>

      <span className="sep" />

      <label className="grid-size">
        Grille
        <input
          type="number"
          min={5}
          max={200}
          value={layout.grid.w}
          onChange={(e) => resizeGrid(clamp(e.target.value, layout.grid.w), layout.grid.h)}
        />
        ×
        <input
          type="number"
          min={5}
          max={200}
          value={layout.grid.h}
          onChange={(e) => resizeGrid(layout.grid.w, clamp(e.target.value, layout.grid.h))}
        />
      </label>

      <span className="spacer" />

      <button className="primary" onClick={() => setOptOpen(true)}>
        ⚙ Optimiser
      </button>
      <button onClick={() => confirm("Nouvelle disposition vide ?") && newLayout()}>Nouveau</button>
      <button onClick={() => exportJson(catalog, layout)}>⬇ JSON</button>
      <button onClick={onImport}>⬆ JSON</button>
      <button onClick={onPng}>🖼 PNG</button>

      {optOpen && <OptimizerPanel onClose={() => setOptOpen(false)} />}
    </div>
  );
}

function clamp(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(5, Math.min(200, n));
}
