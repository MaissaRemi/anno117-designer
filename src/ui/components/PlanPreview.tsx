import { useEffect, useMemo, useRef } from "react";
import { footprintSize } from "../../engine/geometry";
import type { DefLookup } from "../../engine/rules";
import { economy } from "../../economy/economy";
import type { GridShape, PlacedBuilding, RoadTile } from "../../model/types";

/**
 * Carte de prévisualisation d'un plan, colorée PAR PALIER ATTEINT.
 *
 * Le panneau de résultat ne disait que « 62 % au palier cible » — sans dire OÙ sont les
 * 38 % restants ni pourquoi. Or c'est exactement l'information qui permet de décider :
 * une bordure non desservie ne se corrige pas comme un trou au milieu de l'île.
 *
 * Rendu en deux temps : on peint une ImageData à la résolution EXACTE de la grille (une
 * case = un pixel), puis on l'étire au canvas sans lissage. Une île 640² fait 410 000
 * cases — les dessiner en `fillRect` bloquerait le thread UI plusieurs centaines de ms.
 */

export interface PlanPreviewProps {
  grid: GridShape;
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  aqueducts?: { x: number; y: number }[];
  lookup: DefLookup;
  /** Côté max du rendu, en pixels CSS. */
  size?: number;
}

/** Palette par rang dans la chaîne résidentielle : sombre en bas, or au palier cible. */
const TIER_RAMP = ["#4a5568", "#5b7fa8", "#3fa796", "#c9a227", "#e8c547"];
const COL_SEA = [8, 14, 24] as const;
const COL_LAND = [30, 34, 40] as const;
const COL_ROAD = [96, 100, 108] as const;
const COL_AQUA = [64, 176, 208] as const;
const COL_SERVICE = [214, 92, 76] as const;
const COL_ROOT = [255, 214, 92] as const;

const hexToRgb = (h: string): readonly [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

export function PlanPreview({ grid, buildings, roads, aqueducts, lookup, size = 320 }: PlanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** residenceId → couleur, par rang dans la chaîne (capacité croissante). */
  const colorOfResidence = useMemo(() => {
    const res = economy.tiers.filter((t) => t.residenceId).sort((a, b) => a.capacityDefault - b.capacityDefault);
    const m = new Map<string, readonly [number, number, number]>();
    res.forEach((t, i) => {
      const c = TIER_RAMP[Math.min(TIER_RAMP.length - 1, Math.round((i / Math.max(1, res.length - 1)) * (TIER_RAMP.length - 1)))];
      m.set(t.residenceId!, hexToRgb(c));
    });
    return m;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = grid.w, H = grid.h;
    const img = new ImageData(W, H);
    const px = img.data;
    const put = (x: number, y: number, c: readonly [number, number, number]) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    };

    // 1. terrain
    for (let i = 0; i < W * H; i++) {
      const c = grid.usable[i] ? COL_LAND : COL_SEA;
      const o = i * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    // 2. voirie, puis conduites (elles enjambent, donc elles passent au-dessus)
    for (const r of roads) put(r.x, r.y, COL_ROAD);
    for (const a of aqueducts ?? []) put(a.x, a.y, COL_AQUA);
    // 3. bâtiments : maisons colorées par palier, services en rouge, comptoir en or
    for (const b of buildings) {
      const def = lookup(b.defId);
      if (!def) continue;
      const col = def.roadRoot ? COL_ROOT : (colorOfResidence.get(b.defId) ?? COL_SERVICE);
      const { w, h } = footprintSize(def, b.rotation, grid.cellsPerTile ?? 1);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(b.x + i, b.y + j, col);
    }

    // 4. étirement sans lissage vers le canvas visible
    const scale = Math.min(size / W, size / H);
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    const cw = Math.max(1, Math.round(W * scale)), ch = Math.max(1, Math.round(H * scale));
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }, [grid, buildings, roads, aqueducts, lookup, size, colorOfResidence]);

  return <canvas ref={canvasRef} className="plan-preview" />;
}

/** Légende : un pastille par palier présent + les repères de lecture. */
export function PlanPreviewLegend({ tierCounts }: { tierCounts: Record<string, number> }) {
  const res = economy.tiers.filter((t) => t.residenceId).sort((a, b) => a.capacityDefault - b.capacityDefault);
  const items = res
    .map((t, i) => ({
      name: t.name,
      n: tierCounts[t.guid] ?? 0,
      color: TIER_RAMP[Math.min(TIER_RAMP.length - 1, Math.round((i / Math.max(1, res.length - 1)) * (TIER_RAMP.length - 1)))],
    }))
    .filter((x) => x.n > 0)
    .reverse();
  return (
    <div className="plan-legend">
      {items.map((x) => (
        <span key={x.name}><i style={{ background: x.color }} />{x.name} {x.n.toLocaleString("fr")}</span>
      ))}
      <span><i style={{ background: "#d65c4c" }} />services</span>
      <span><i style={{ background: "#ffd65c" }} />comptoir</span>
      <span><i style={{ background: "#40b0d0" }} />aqueduc</span>
    </div>
  );
}
