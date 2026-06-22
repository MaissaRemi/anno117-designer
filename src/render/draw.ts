import { footprintCells, footprintSize, gridScale } from "../engine/geometry";
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
  coverageHighlight?: string[] | null; // cellKeys "x,y" à surligner (maisons non couvertes)
}

export const gridToScreen = (v: View, x: number, y: number): [number, number] => [
  v.originX + x * v.cell,
  v.originY + y * v.cell,
];

/**
 * Fenêtre de cellules visibles (culling) : la grille ½-tuile a 4× plus de cellules, et
 * une couverture/réseau dense peut représenter des millions de fillRect → on borne tout
 * dessin par-cellule à la fenêtre canvas. `inView(x,y)` teste l'appartenance.
 */
function visibleRange(ctx: CanvasRenderingContext2D, v: View, gw: number, gh: number) {
  const { width, height } = ctx.canvas;
  return {
    cx0: Math.max(0, Math.floor((0 - v.originX) / v.cell)),
    cx1: Math.min(gw, Math.ceil((width - v.originX) / v.cell) + 1),
    cy0: Math.max(0, Math.floor((0 - v.originY) / v.cell)),
    cy1: Math.min(gh, Math.ceil((height - v.originY) / v.cell) + 1),
  };
}

export function screenToGrid(v: View, px: number, py: number): { x: number; y: number } {
  return {
    x: Math.floor((px - v.originX) / v.cell),
    y: Math.floor((py - v.originY) / v.cell),
  };
}

export function drawScene(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const { layout, view, lookup } = o;
  const scale = gridScale(layout.grid);
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
    drawBuilding(ctx, view, def, b.x, b.y, b.rotation, scale, {
      selected: b.uid === o.selectedUid,
      locked: b.locked,
      issue: o.issues.get(b.uid),
      name: def.name,
    });
  }

  if (o.coverageHighlight?.length) drawCoverageHighlight(ctx, o);
  if (o.hover) drawHover(ctx, o);
}

/** Surligne en rouge les cases de résidence non couvertes par un service. */
function drawCoverageHighlight(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  const { cx0, cx1, cy0, cy1 } = visibleRange(ctx, v, o.layout.grid.w, o.layout.grid.h);
  ctx.fillStyle = "rgba(255, 80, 80, 0.45)";
  ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
  ctx.lineWidth = 1;
  for (const key of o.coverageHighlight!) {
    const ci = key.indexOf(",");
    const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (x < cx0 || x >= cx1 || y < cy0 || y >= cy1) continue;
    const [sx, sy] = gridToScreen(v, x, y);
    ctx.fillRect(sx, sy, v.cell, v.cell);
    ctx.strokeRect(sx + 0.5, sy + 0.5, v.cell - 1, v.cell - 1);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const { grid } = o.layout;
  const v = o.view;
  // CULLING viewport : ne dessiner que les cellules visibles (la grille ½-tuile a 4× plus
  // de cellules — sur une île 768²→1536² le balayage plein crève le renderer).
  const { cx0, cx1, cy0, cy1 } = visibleRange(ctx, v, grid.w, grid.h);
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const i = y * grid.w + x;
      const usable = grid.usable[i];
      const water = grid.water?.[i];
      const river = grid.rivers?.[i];
      const [sx, sy] = gridToScreen(v, x, y);
      // rivière (argile/ponts) / terre constructible / eau (mer) / hors-zone
      ctx.fillStyle = river ? "#2d5a73" : usable ? "#2b333c" : water ? "#1c3a52" : "#171a1d";
      ctx.fillRect(sx, sy, v.cell, v.cell);
    }
  }
  // slots de ressource (mines / argile / marais / source d'aqueduc) : marqueurs
  if (grid.slots) {
    for (const s of grid.slots) {
      const [sx, sy] = gridToScreen(v, s.x, s.y);
      const cx = sx + v.cell / 2, cy = sy + v.cell / 2;
      const r = Math.max(4, v.cell * 1.2);
      ctx.beginPath();
      if (s.type === "mountain") {
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath();
        ctx.fillStyle = "rgba(170,150,120,0.85)";
      } else if (s.type === "river") {
        ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(90,170,220,0.85)";
      } else { // marsh / autre
        ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(110,160,110,0.85)";
      }
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // lignes de grille (visibles seulement ; sautées si cellules trop petites = bruit/overdraw)
  if (v.cell >= 4) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [, gy0] = gridToScreen(v, 0, cy0);
    const [, gy1] = gridToScreen(v, 0, cy1);
    const [gx0] = gridToScreen(v, cx0, 0);
    const [gx1] = gridToScreen(v, cx1, 0);
    for (let x = cx0; x <= cx1; x++) {
      const [sx] = gridToScreen(v, x, 0);
      ctx.moveTo(sx + 0.5, gy0);
      ctx.lineTo(sx + 0.5, gy1);
    }
    for (let y = cy0; y <= cy1; y++) {
      const [, sy] = gridToScreen(v, 0, y);
      ctx.moveTo(gx0, sy + 0.5);
      ctx.lineTo(gx1, sy + 0.5);
    }
    ctx.stroke();
  }
}

function drawCoverage(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  const { cx0, cx1, cy0, cy1 } = visibleRange(ctx, v, o.layout.grid.w, o.layout.grid.h);
  ctx.fillStyle = "rgba(124,179,66,0.15)";
  for (const set of o.coverage.values()) {
    for (const key of set) {
      const ci = key.indexOf(",");
      const x = +key.slice(0, ci), y = +key.slice(ci + 1);
      if (x < cx0 || x >= cx1 || y < cy0 || y >= cy1) continue; // hors viewport
      const [sx, sy] = gridToScreen(v, x, y);
      ctx.fillRect(sx, sy, v.cell, v.cell);
    }
  }
}

function drawRoads(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  const { cx0, cx1, cy0, cy1 } = visibleRange(ctx, v, o.layout.grid.w, o.layout.grid.h);
  ctx.fillStyle = "#55606b";
  for (const r of o.layout.roads) {
    if (r.x < cx0 || r.x >= cx1 || r.y < cy0 || r.y >= cy1) continue;
    const [sx, sy] = gridToScreen(v, r.x, r.y);
    ctx.fillRect(sx + 1, sy + 1, v.cell - 2, v.cell - 2);
  }
  // conduites d'aqueduc : par-dessus les routes (aqueduc surélevé), teinte eau
  for (const a of o.layout.aqueducts ?? []) {
    if (a.x < cx0 || a.x >= cx1 || a.y < cy0 || a.y >= cy1) continue;
    const [sx, sy] = gridToScreen(v, a.x, a.y);
    ctx.fillStyle = "rgba(77,208,225,0.8)";
    ctx.fillRect(sx + 1, sy + 1, v.cell - 2, v.cell - 2);
    ctx.strokeStyle = "rgba(38,166,184,0.9)";
    ctx.strokeRect(sx + 1.5, sy + 1.5, v.cell - 3, v.cell - 3);
  }
}

function drawFields(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const v = o.view;
  const { cx0, cx1, cy0, cy1 } = visibleRange(ctx, v, o.layout.grid.w, o.layout.grid.h);
  for (const f of o.layout.fields) {
    if (f.x < cx0 || f.x >= cx1 || f.y < cy0 || f.y >= cy1) continue;
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

const isDiagonalRot = (rot: Rotation): boolean => rot === 45 || rot === 135 || rot === 225 || rot === 315;

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  v: View,
  def: BuildingDef,
  x: number,
  y: number,
  rot: Rotation,
  scale: number,
  style: BuildingStyle,
): void {
  const { w, h } = footprintSize(def, rot, scale);
  const [sx, sy] = gridToScreen(v, x, y);
  const pw = w * v.cell;
  const ph = h * v.cell;
  const hasIssue = style.issue && !style.issue.ok;
  const stroke = hasIssue ? "#e53935" : style.selected ? "#ffffff" : "rgba(0,0,0,0.5)";

  if (isDiagonalRot(rot)) {
    // 45° : on peint l'emprise DIAMANT réelle (cellules), pas la bbox carrée
    ctx.fillStyle = def.color;
    for (const c of footprintCells(def, x, y, rot, scale)) {
      const [cx, cy] = gridToScreen(v, c.x, c.y);
      ctx.fillRect(cx, cy, v.cell + 0.5, v.cell + 0.5);
    }
    ctx.lineWidth = style.selected ? 3 : 2;
    ctx.strokeStyle = stroke;
    ctx.strokeRect(sx + 1.5, sy + 1.5, pw - 3, ph - 3); // bbox indicatif
  } else {
    ctx.fillStyle = def.color;
    ctx.fillRect(sx + 1, sy + 1, pw - 2, ph - 2);
    ctx.lineWidth = style.selected ? 3 : 2;
    ctx.strokeStyle = stroke;
    ctx.strokeRect(sx + 1.5, sy + 1.5, pw - 3, ph - 3);
  }

  // cadenas si verrouillé
  if (style.locked) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = `${Math.min(v.cell, 16)}px sans-serif`;
    ctx.fillText("🔒", sx + 3, sy + Math.min(v.cell, 16));
  }

  // nom si la place le permet (axis seulement — le diamant n'a pas de bande nette)
  if (!isDiagonalRot(rot) && pw > 34 && v.cell >= 8) {
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
  const cells = footprintCells(h.def, h.x, h.y, h.rot, gridScale(o.layout.grid));
  ctx.fillStyle = h.valid ? "rgba(124,179,66,0.4)" : "rgba(229,57,53,0.4)";
  for (const c of cells) {
    const [sx, sy] = gridToScreen(v, c.x, c.y);
    ctx.fillRect(sx, sy, v.cell, v.cell);
  }
}
