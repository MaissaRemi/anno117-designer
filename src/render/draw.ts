import { footprintCells, footprintSize } from "../engine/geometry";
import type { BuildingIssues } from "../engine/rules";
import type { BuildingDef, Layout, Rotation } from "../model/types";

export interface View {
  originX: number; // décalage écran en px
  originY: number;
  cell: number; // taille d'une case en px
}

export type Lookup = (id: string) => BuildingDef | undefined;

export interface HoverPreview {
  def: BuildingDef;
  x: number;
  y: number;
  rot: Rotation;
  valid: boolean;
}

export interface DrawOpts {
  layout: Layout;
  lookup: Lookup;
  view: View;
  issues: Map<string, BuildingIssues>;
  coverage: Map<string, Set<string>>;
  showRadius: boolean;
  selectedUid: string | null;
  hover: HoverPreview | null;
}

export const gridToScreen = (v: View, x: number, y: number): [number, number] => [
  v.originX + x * v.cell,
  v.originY + y * v.cell,
];

export function screenToGrid(v: View, px: number, py: number): { x: number; y: number } {
  return {
    x: Math.floor((px - v.originX) / v.cell),
    y: Math.floor((py - v.originY) / v.cell),
  };
}

export function drawScene(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const { layout, view, lookup } = o;
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#1b1f24";
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, o);
  if (o.showRadius) drawCoverage(ctx, o);
  drawRoads(ctx, o);
  drawFields(ctx, o);

  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    drawBuilding(ctx, view, def, b.x, b.y, b.rotation, {
      selected: b.uid === o.selectedUid,
      locked: b.locked,
      issue: o.issues.get(b.uid),
      name: def.name,
    });
  }

  if (o.hover) drawHover(ctx, o);
}

function drawGrid(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const { grid } = o.layout;
  const v = o.view;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const usable = grid.usable[y * grid.w + x];
      const [sx, sy] = gridToScreen(v, x, y);
      ctx.fillStyle = usable ? "#2b333c" : "#171a1d";
      ctx.fillRect(sx, sy, v.cell, v.cell);
    }
  }
  // lignes de grille
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= grid.w; x++) {
    const [sx, sy] = gridToScreen(v, x, 0);
    ctx.moveTo(sx + 0.5, sy);
    ctx.lineTo(sx + 0.5, sy + grid.h * v.cell);
  }
  for (let y = 0; y <= grid.h; y++) {
    const [sx, sy] = gridToScreen(v, 0, y);
    ctx.moveTo(sx, sy + 0.5);
    ctx.lineTo(sx + grid.w * v.cell, sy + 0.5);
  }
  ctx.stroke();
}

function drawCoverage(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  ctx.fillStyle = "rgba(124,179,66,0.15)";
  for (const set of o.coverage.values()) {
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      const [sx, sy] = gridToScreen(v, x, y);
      ctx.fillRect(sx, sy, v.cell, v.cell);
    }
  }
}

function drawRoads(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  ctx.fillStyle = "#55606b";
  for (const r of o.layout.roads) {
    const [sx, sy] = gridToScreen(v, r.x, r.y);
    ctx.fillRect(sx + 1, sy + 1, v.cell - 2, v.cell - 2);
  }
}

function drawFields(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  for (const f of o.layout.fields) {
    const [sx, sy] = gridToScreen(v, f.x, f.y);
    ctx.fillStyle = "rgba(150,200,90,0.55)";
    ctx.fillRect(sx + 1, sy + 1, v.cell - 2, v.cell - 2);
    ctx.strokeStyle = "rgba(120,170,70,0.9)";
    ctx.strokeRect(sx + 1.5, sy + 1.5, v.cell - 3, v.cell - 3);
  }
}

interface BuildingStyle {
  selected: boolean;
  locked: boolean;
  issue?: BuildingIssues;
  name: string;
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  v: View,
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rotation,
  style: BuildingStyle,
): void {
  const { w, h } = footprintSize(def, rot);
  const [sx, sy] = gridToScreen(v, x, y);
  const pw = w * v.cell;
  const ph = h * v.cell;

  ctx.fillStyle = def.color;
  ctx.fillRect(sx + 1, sy + 1, pw - 2, ph - 2);

  // bordure : rouge si problème, blanc si sélection, sinon sombre
  const hasIssue = style.issue && !style.issue.ok;
  ctx.lineWidth = style.selected ? 3 : 2;
  ctx.strokeStyle = hasIssue
    ? "#e53935"
    : style.selected
      ? "#ffffff"
      : "rgba(0,0,0,0.5)";
  ctx.strokeRect(sx + 1.5, sy + 1.5, pw - 3, ph - 3);

  // cadenas si verrouillé
  if (style.locked) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = `${Math.min(v.cell, 16)}px sans-serif`;
    ctx.fillText("🔒", sx + 3, sy + Math.min(v.cell, 16));
  }

  // nom si la place le permet
  if (pw > 34 && v.cell >= 8) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";
    const label = style.name.length > w * 3 ? style.name.slice(0, w * 3 - 1) + "…" : style.name;
    ctx.fillText(label, sx + 4, sy + ph / 2);
  }
}

function drawHover(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const h = o.hover!;
  const v = o.view;
  const cells = footprintCells(h.def, h.x, h.y, h.rot);
  ctx.fillStyle = h.valid ? "rgba(124,179,66,0.4)" : "rgba(229,57,53,0.4)";
  for (const c of cells) {
    const [sx, sy] = gridToScreen(v, c.x, c.y);
    ctx.fillRect(sx, sy, v.cell, v.cell);
  }
}
