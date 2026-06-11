import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { footprintCells } from "../engine/geometry";
import { canPlace, computeRadiusCoverage, makeLookup, validateLayout } from "../engine/rules";
import type { PlacedBuilding } from "../model/types";
import { drawScene, screenToGrid, type HoverPreview, type View } from "../render/draw";
import { useStore } from "../state/store";

export function GridCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const layout = useStore((s) => s.layout);
  const catalog = useStore((s) => s.catalog);
  const mode = useStore((s) => s.mode);
  const selectedDefId = useStore((s) => s.selectedDefId);
  const rotation = useStore((s) => s.rotation);
  const selectedUid = useStore((s) => s.selectedUid);
  const showRadius = useStore((s) => s.showRadius);
  const coverageHighlight = useStore((s) => s.coverageHighlight);

  const [view, setView] = useState<View>({ originX: 20, originY: 20, cell: 22 });
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef<null | "pan" | "paint" | "move">(null);
  const panStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const moveUid = useRef<string | null>(null);

  const lookup = useMemo(() => makeLookup(catalog), [catalog]);
  const issues = useMemo(() => validateLayout(layout, lookup), [layout, lookup]);
  const coverage = useMemo(() => computeRadiusCoverage(layout, lookup), [layout, lookup]);

  const buildingAt = useCallback(
    (gx: number, gy: number): PlacedBuilding | null => {
      for (let i = layout.buildings.length - 1; i >= 0; i--) {
        const b = layout.buildings[i];
        const def = lookup(b.defId);
        if (!def) continue;
        if (footprintCells(def, b.x, b.y, b.rotation).some((c) => c.x === gx && c.y === gy)) {
          return b;
        }
      }
      return null;
    },
    [layout.buildings, lookup],
  );

  // Aperçu de pose.
  const hover: HoverPreview | null = useMemo(() => {
    if (mode !== "place" || !selectedDefId || !hoverCell) return null;
    const def = lookup(selectedDefId);
    if (!def) return null;
    const valid = canPlace(layout, lookup, def, hoverCell.x, hoverCell.y, rotation);
    return { def, x: hoverCell.x, y: hoverCell.y, rot: rotation, valid };
  }, [mode, selectedDefId, hoverCell, rotation, layout, lookup]);

  // Redimensionnement du canvas selon le conteneur.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = wrap.clientWidth;
      canvas.height = wrap.clientHeight;
      redraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, { layout, lookup, view, issues, coverage, showRadius, selectedUid, hover, coverageHighlight });
  }, [layout, lookup, view, issues, coverage, showRadius, selectedUid, hover, coverageHighlight]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const eventCell = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return screenToGrid(view, e.clientX - rect.left, e.clientY - rect.top);
  };

  const applyPaint = (gx: number, gy: number) => {
    const s = useStore.getState();
    switch (mode) {
      case "draw-grid":
        s.setUsable(gx, gy, true);
        break;
      case "erase-grid":
        s.setUsable(gx, gy, false);
        break;
      case "road":
        s.paintRoad(gx, gy);
        break;
      case "field":
        s.paintField(gx, gy);
        break;
      case "erase":
        s.eraseRoad(gx, gy);
        s.eraseFieldAt(gx, gy);
        break;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    const { x: gx, y: gy } = eventCell(e);
    const s = useStore.getState();

    // Pan : bouton du milieu ou clic droit.
    if (e.button === 1 || e.button === 2) {
      dragging.current = "pan";
      panStart.current = { mx: e.clientX, my: e.clientY, ox: view.originX, oy: view.originY };
      return;
    }
    if (e.button !== 0) return;

    if (mode === "place") {
      s.addBuildingAt(gx, gy);
      return;
    }
    if (mode === "select" || mode === "move") {
      const b = buildingAt(gx, gy);
      s.setSelectedUid(b?.uid ?? null);
      if (mode === "move" && b && !b.locked) {
        dragging.current = "move";
        moveUid.current = b.uid;
      }
      return;
    }
    // outils de peinture
    dragging.current = "paint";
    applyPaint(gx, gy);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cell = eventCell(e);
    setHoverCell(cell);

    if (dragging.current === "pan" && panStart.current) {
      const p = panStart.current;
      setView((v) => ({ ...v, originX: p.ox + (e.clientX - p.mx), originY: p.oy + (e.clientY - p.my) }));
      return;
    }
    if (dragging.current === "paint") {
      applyPaint(cell.x, cell.y);
      return;
    }
    if (dragging.current === "move" && moveUid.current) {
      useStore.getState().moveBuilding(moveUid.current, cell.x, cell.y);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    dragging.current = null;
    panStart.current = null;
    moveUid.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cell = Math.max(6, Math.min(80, v.cell * factor));
      const k = cell / v.cell;
      // garde le point sous le curseur stable
      return {
        cell,
        originX: mx - (mx - v.originX) * k,
        originY: my - (my - v.originY) * k,
      };
    });
  };

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="canvas-hint">
        {hoverCell ? `x:${hoverCell.x} y:${hoverCell.y}` : ""} · molette = zoom · clic droit = déplacer la vue
      </div>
    </div>
  );
}
