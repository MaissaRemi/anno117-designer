import { computeRadiusCoverage, makeLookup, validateLayout } from "../engine/rules";
import type { BuildingDef, Layout } from "../model/types";
import { drawScene, type View } from "./draw";

/**
 * View qui fait tenir TOUTE la grille (w×h cases) dans `maxPx`, marge incluse —
 * indépendant du zoom/pan courant de l'éditeur. Utilisé pour l'export PNG plein cadre.
 */
export function fitView(
  w: number,
  h: number,
  maxPx = 2400,
  margin = 16,
): { view: View; width: number; height: number } {
  const cell = Math.max(2, Math.floor((maxPx - 2 * margin) / Math.max(w, h)));
  return {
    view: { originX: margin, originY: margin, cell },
    width: w * cell + 2 * margin,
    height: h * cell + 2 * margin,
  };
}

/**
 * Rend la disposition ENTIÈRE sur un canvas hors-écran (toute l'île, pas le viewport
 * visible). Recalcule lookup/issues/couverture car ils vivent dans GridCanvas.
 */
export function renderFullCanvas(layout: Layout, catalog: BuildingDef[], maxPx = 2400): HTMLCanvasElement {
  const lookup = makeLookup(catalog);
  const { view, width, height } = fitView(layout.grid.w, layout.grid.h, maxPx);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible pour l'export.");
  drawScene(ctx, {
    layout,
    lookup,
    view,
    issues: validateLayout(layout, lookup),
    coverage: computeRadiusCoverage(layout, lookup),
    showRadius: false, // export = plan net, sans les disques de rayon ni surlignage
    selectedUid: null,
    hover: null,
    coverageHighlight: null,
  });
  return canvas;
}
