import { useEffect, useRef } from "react";
import { makeLookup } from "../../engine/rules";
import { drawScene } from "../../render/draw";
import { fitView } from "../../render/exportImage";
import type { BuildingDef, Layout } from "../../model/types";

/**
 * Rendu d'un blueprint. Contrairement à `PlanPreview` (une case = un pixel, taillé pour une
 * île de 640²), un blueprint fait quelques dizaines de cases : on réutilise le rendu de
 * l'ÉDITEUR, qui dessine les icônes, les champs et les emprises lisiblement.
 *
 * `issues` et `coverage` sont vides à dessein : la validation du blueprint est faite par le
 * placeur et remonte dans `gaps`, pas par le moteur de règles de l'éditeur — qui raisonne
 * sur une grille d'île.
 */
export function BlueprintCanvas({
  layout, catalog, maxPx = 900,
}: { layout: Layout; catalog: BuildingDef[]; maxPx?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { view, width, height } = fitView(layout.grid.w, layout.grid.h, maxPx);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, {
      layout,
      lookup: makeLookup(catalog),
      view,
      issues: new Map(),
      coverage: new Map(),
      showRadius: false,
      selectedUid: null,
      hover: null,
    });
  }, [layout, catalog, maxPx]);

  return <canvas ref={ref} className="blueprint-canvas" style={{ maxWidth: "100%" }} />;
}
