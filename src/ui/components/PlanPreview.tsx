import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { footprintCells, footprintSize } from "../../engine/geometry";
import type { DefLookup } from "../../engine/rules";
import { economy } from "../../economy/economy";
import type { BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../../model/types";

/**
 * Carte de prévisualisation d'un plan — colorée par PALIER ATTEINT, navigable, et capable
 * de montrer la portée réelle d'un service au survol.
 *
 * Trois raisons d'exister :
 *  1. le panneau de résultat annonçait « 77 % au palier cible » sans dire OÙ sont les 23 %
 *     restants — or une bordure non desservie ne se corrige pas comme un trou central ;
 *  2. sur une île de 640² il faut pouvoir zoomer pour juger d'un quartier ;
 *  3. la portée d'un service se mesure LE LONG DES RUES, pas à vol d'oiseau : c'est
 *     contre-intuitif, et seul un survol qui allume le réseau atteint le rend lisible.
 *
 * Rendu en trois couches hors-écran, à la résolution EXACTE de la grille (une case = un
 * pixel), étirées sans lissage. Une île 640² fait 410 000 cases : les dessiner en
 * `fillRect` bloquerait le thread UI. Le fond n'est recalculé que si le plan change ; le
 * surlignage, que si le bâtiment survolé change.
 */

export interface PlanPreviewProps {
  grid: GridShape;
  buildings: PlacedBuilding[];
  roads: RoadTile[];
  aqueducts?: { x: number; y: number }[];
  lookup: DefLookup;
  /** Côté MAXIMAL du rendu, en pixels CSS. La carte s'adapte sinon à la place disponible. */
  size?: number;
}

/** Palette par rang dans la chaîne résidentielle : sombre en bas, or au palier cible. */
const TIER_RAMP = ["#4a5568", "#5b7fa8", "#3fa796", "#c9a227", "#e8c547"];
const COL_SEA: RGB = [8, 14, 24];
const COL_LAND: RGB = [30, 34, 40];
const COL_ROAD: RGB = [96, 100, 108];
const COL_AQUA: RGB = [64, 176, 208];
const COL_SERVICE: RGB = [214, 92, 76];
const COL_ROOT: RGB = [255, 214, 92];
const COL_REACH: RGB = [88, 224, 120]; // rues à portée du service survolé
const COL_FOCUS: RGB = [255, 255, 255]; // le service survolé lui-même

type RGB = readonly [number, number, number];
const hexToRgb = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

const rangeOf = (d: BuildingDef): number => d.streetRange || d.radius?.range || 0;

/**
 * Côté du tampon de dessin, en pixels. Volontairement DÉCORRÉLÉ de la taille affichée :
 * le canvas est étiré par le CSS (`width: 100%` + `aspect-ratio`), ce qui le rend
 * naturellement responsive sans mesurer quoi que ce soit en JavaScript. Une première
 * version utilisait un `ResizeObserver` ; outre la complexité, ses rappels ne sont livrés
 * que pendant les étapes de rendu, donc jamais dans un onglet non composité — la carte
 * restait figée à sa taille initiale. Le CSS n'a pas ce défaut.
 */
const BUFFER = 1024;

export function PlanPreview({ grid, buildings, roads, aqueducts, lookup, size = 720 }: PlanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const hlRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState({ z: 1, ox: 0, oy: 0 });
  const [hover, setHover] = useState<number>(-1); // index du bâtiment survolé
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const W = grid.w, H = grid.h;
  const cpt = grid.cellsPerTile ?? 1;
  // dimensions du TAMPON (pas de l'affichage) : l'île y est inscrite en entier
  const cw = W >= H ? BUFFER : Math.max(1, Math.round((BUFFER * W) / H));
  const ch = H >= W ? BUFFER : Math.max(1, Math.round((BUFFER * H) / W));
  /** px de tampon par case de grille */
  const unit = cw / W;

  /** residenceId → couleur, par rang dans la chaîne (capacité croissante). */
  const colorOfResidence = useMemo(() => {
    const res = economy.tiers.filter((t) => t.residenceId).sort((a, b) => a.capacityDefault - b.capacityDefault);
    const m = new Map<string, RGB>();
    res.forEach((t, i) => {
      const c = TIER_RAMP[Math.min(TIER_RAMP.length - 1, Math.round((i / Math.max(1, res.length - 1)) * (TIER_RAMP.length - 1)))];
      m.set(t.residenceId!, hexToRgb(c));
    });
    return m;
  }, []);

  /** Index case → indice de bâtiment, pour le pointage au survol. Une seule passe. */
  const hitMap = useMemo(() => {
    const m = new Int32Array(W * H).fill(-1);
    for (let i = 0; i < buildings.length; i++) {
      const def = lookup(buildings[i].defId);
      if (!def) continue;
      for (const c of footprintCells(def, buildings[i].x, buildings[i].y, buildings[i].rotation, cpt)) {
        if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) m[c.y * W + c.x] = i;
      }
    }
    return m;
  }, [buildings, lookup, W, H, cpt]);

  const roadSet = useMemo(() => {
    const s = new Set<number>();
    for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) s.add(r.y * W + r.x);
    return s;
  }, [roads, W, H]);

  // ---- couche de FOND : terrain, voirie, conduites, bâtiments ----
  useEffect(() => {
    const img = new ImageData(W, H);
    const px = img.data;
    const put = (x: number, y: number, c: RGB) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    };
    for (let i = 0; i < W * H; i++) {
      const c = grid.usable[i] ? COL_LAND : COL_SEA;
      const o = i * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    for (const r of roads) put(r.x, r.y, COL_ROAD);
    for (const a of aqueducts ?? []) put(a.x, a.y, COL_AQUA);
    for (const b of buildings) {
      const def = lookup(b.defId);
      if (!def) continue;
      const col = def.roadRoot ? COL_ROOT : (colorOfResidence.get(b.defId) ?? COL_SERVICE);
      const { w, h } = footprintSize(def, b.rotation, cpt);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(b.x + i, b.y + j, col);
    }
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(img, 0, 0);
    baseRef.current = off;
    setView({ z: 1, ox: 0, oy: 0 });
  }, [grid, buildings, roads, aqueducts, lookup, colorOfResidence, W, H, cpt]);

  // ---- couche de SURLIGNAGE : portée-rue du service survolé ----
  const hovered = hover >= 0 ? buildings[hover] : null;
  const hoveredDef = hovered ? lookup(hovered.defId) : null;
  useEffect(() => {
    if (!hovered || !hoveredDef || rangeOf(hoveredDef) <= 0) { hlRef.current = null; return; }
    const img = new ImageData(W, H);
    const px = img.data;
    const put = (c: number, col: RGB) => {
      const i = c * 4;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    };
    // BFS le long des routes, même sémantique que `streetCoverage` de l'analyseur :
    // graines = routes adjacentes à l'emprise (distance 1), limite = portée × cellules/tuile
    const limit = rangeOf(hoveredDef) * cpt;
    const cells = footprintCells(hoveredDef, hovered.x, hovered.y, hovered.rotation, cpt);
    const own = new Set(cells.map((c) => c.y * W + c.x));
    const dist = new Map<number, number>();
    let frontier: number[] = [];
    const seed = (c: number) => {
      if (own.has(c) || !roadSet.has(c) || dist.has(c)) return;
      dist.set(c, 1); frontier.push(c);
    };
    for (const c of cells) {
      if (c.x > 0) seed(c.y * W + c.x - 1);
      if (c.x < W - 1) seed(c.y * W + c.x + 1);
      if (c.y > 0) seed((c.y - 1) * W + c.x);
      if (c.y < H - 1) seed((c.y + 1) * W + c.x);
    }
    let d = 1;
    while (frontier.length && d < limit) {
      const next: number[] = [];
      for (const c of frontier) {
        const x = c % W, y = (c / W) | 0;
        for (const nb of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) {
          if (nb < 0 || !roadSet.has(nb) || dist.has(nb)) continue;
          dist.set(nb, d + 1); next.push(nb);
        }
      }
      frontier = next; d++;
    }
    for (const c of dist.keys()) put(c, COL_REACH);
    for (const c of own) put(c, COL_FOCUS);
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    off.getContext("2d")!.putImageData(img, 0, 0);
    hlRef.current = off;
  }, [hovered, hoveredDef, roadSet, W, H, cpt]);

  // ---- composition (tout en pixels de TAMPON) ----
  const paint = useCallback(() => {
    const canvas = canvasRef.current, base = baseRef.current;
    if (!canvas || !base) return;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.z, view.z);
    ctx.drawImage(base, 0, 0, cw, ch);
    if (hlRef.current) ctx.drawImage(hlRef.current, 0, 0, cw, ch);
  }, [cw, ch, view]);

  useEffect(paint, [paint, hover]);

  /** Coordonnées écran → pixels de tampon (le canvas est étiré par le CSS). */
  const toBuffer = (e: { clientX: number; clientY: number }, rect: DOMRect) => ({
    x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * cw,
    y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * ch,
  });

  // ---- interactions : molette = zoom au curseur, glisser = déplacement ----
  // La molette est câblée à la main en NON PASSIF : React attache `onWheel` en passif, donc
  // `preventDefault` y est ignoré et la page défilait au lieu de zoomer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * cw;
      const my = ((e.clientY - rect.top) / Math.max(1, rect.height)) * ch;
      setView((v) => {
        const z = Math.min(24, Math.max(1, v.z * (e.deltaY < 0 ? 1.25 : 1 / 1.25)));
        if (z === v.z) return v;
        // le point sous le curseur reste immobile
        const k = z / v.z;
        let ox = mx - (mx - v.ox) * k;
        let oy = my - (my - v.oy) * k;
        // pas de vide autour de la carte
        ox = Math.min(0, Math.max(cw - cw * z, ox));
        oy = Math.min(0, Math.max(ch - ch * z, oy));
        return { z, ox, oy };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [cw, ch]);
  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
  };
  const onUp = () => { dragRef.current = null; };
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = dragRef.current;
    if (d) {
      // le déplacement écran est converti à l'échelle du tampon
      const k = cw / Math.max(1, rect.width);
      setView((v) => ({
        z: v.z,
        ox: Math.min(0, Math.max(cw - cw * v.z, d.ox + (e.clientX - d.x) * k)),
        oy: Math.min(0, Math.max(ch - ch * v.z, d.oy + (e.clientY - d.y) * k)),
      }));
      return;
    }
    // écran → tampon → case de grille
    const p = toBuffer(e, rect);
    const gx = Math.floor(((p.x - view.ox) / view.z) / unit);
    const gy = Math.floor(((p.y - view.oy) / view.z) / unit);
    const idx = gx >= 0 && gy >= 0 && gx < W && gy < H ? hitMap[gy * W + gx] : -1;
    setHover((h) => (h === idx ? h : idx));
  };

  const legendRange = hoveredDef && rangeOf(hoveredDef) > 0 ? rangeOf(hoveredDef) : null;
  return (
    <div className="plan-preview-box">
      <canvas
        ref={canvasRef}
        className="plan-preview"
        // Le CSS étire le tampon. Les DEUX bornes (largeur max, hauteur d'écran) sont
        // repliées en une SEULE contrainte de largeur : appliquer un `max-height` en plus
        // d'un `aspect-ratio` laisse le navigateur écraser l'île.
        style={{ aspectRatio: `${cw} / ${ch}`, maxWidth: `min(${size}px, calc(62vh * ${(cw / ch).toFixed(4)}))` }}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseMove={onMove}
        onMouseLeave={() => { dragRef.current = null; setHover(-1); }}
        onDoubleClick={() => setView({ z: 1, ox: 0, oy: 0 })}
      />
      <div className="plan-preview-hint">
        {hoveredDef
          ? <><b>{hoveredDef.name}</b>{legendRange ? ` · portée-rue ${legendRange} — les rues atteintes sont en vert` : " · aucune portée"}</>
          : <>molette = zoom · glisser = déplacer · double-clic = vue entière · survoler un service montre sa portée</>}
        {view.z > 1 && <span className="muted"> · ×{view.z.toFixed(1)}</span>}
      </div>
    </div>
  );
}

/** Légende : une pastille par palier présent + les repères de lecture. */
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
