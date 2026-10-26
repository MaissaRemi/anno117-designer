import type { GridShape, Layout, PlacedBuilding } from "../model/types";
import type { PlanQuality } from "../optimizer/planQuality";
import type { Nomenclature } from "./nomenclature";

/**
 * ═══ DISPOSER UNE COMMANDE — TYPES ET OUTILS COMMUNS ══════════════════════════════════
 *
 * Étape 5 de la refonte (`docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`). Le
 * placeur lui-même est `ilots.ts` ; ce module porte ce que son résultat promet.
 *
 * Premier essai, mesuré puis abandonné : poser la commande avec `planLattice` dans une zone
 * bornée grandissant depuis le comptoir. Sur 300 Patriciens : 7 Temples et 6 Forums, 12 % du
 * sol en maisons, 27 % en routes, et l'eau qui n'arrivait pas. Ce moteur remplit une île ; il
 * ne sait pas dimensionner un quartier. Les chiffres sont dans le plan de refonte.
 */

export interface DispositionOpts {
  /** Hauteurs quantifiées de l'île (pente des aqueducs). */
  heights?: Int8Array;
}

export interface LignePosee {
  defId: string;
  nom: string;
  role: string;
  demande: number;
  pose: number;
}

export interface PlanQuartiers {
  /** Grille TUILE de l'île, comme les moteurs. */
  layout: Layout;
  nomenclature: Nomenclature;
  /** Ce qui était demandé et ce qui est posé, ligne par ligne (maisons, services, institutions). */
  lignes: LignePosee[];
  habitants: number;
  maisonsParPalier: Record<string, number>;
  /** Bilan de l'île par attribut vital, rang de cité compris — indicatif. */
  bilan: Record<string, number>;
  viable: boolean;
  /** La zone bâtie : son masque, sa taille en cases, et les tours de pose qu'il a fallu. */
  zone: { usable: boolean[]; cases: number; passes: number };
  /** Usage du sol À L'INTÉRIEUR de la zone. */
  qualite: PlanQuality;
  /** Toutes les maisons demandées sont posées, à leur palier, et reliées au comptoir. */
  servi: boolean;
  /** Ce qui manque, chiffré. Vide si `servi`. */
  manques: string[];
  /** Consommateurs d'eau retirés faute de raccordement : où ils auraient dû être. */
  inactifs?: PlacedBuilding[];
  avertissements: string[];
}

/** Petit tas binaire : (distance, indice) — l'indice départage, donc l'ordre est total. */
class Tas {
  private d: number[] = [];
  private c: number[] = [];
  get taille() { return this.d.length; }
  pousser(dist: number, cell: number) {
    this.d.push(dist); this.c.push(cell);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.avant(p, i)) break;
      this.echanger(i, p); i = p;
    }
  }
  tirer(): [number, number] {
    const top: [number, number] = [this.d[0], this.c[0]];
    const ld = this.d.pop()!, lc = this.c.pop()!;
    if (this.d.length) {
      this.d[0] = ld; this.c[0] = lc;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.d.length && !this.avant(m, l)) m = l;
        if (r < this.d.length && !this.avant(m, r)) m = r;
        if (m === i) break;
        this.echanger(i, m); i = m;
      }
    }
    return top;
  }
  private avant(a: number, b: number) { return this.d[a] < this.d[b] || (this.d[a] === this.d[b] && this.c[a] <= this.c[b]); }
  private echanger(a: number, b: number) {
    [this.d[a], this.d[b]] = [this.d[b], this.d[a]];
    [this.c[a], this.c[b]] = [this.c[b], this.c[a]];
  }
}

/**
 * Distance OCTILE le long de la terre depuis des graines (10 en ligne droite, 14 en diagonale,
 * la diagonale n'étant permise qu'entre deux cases de terre, pour qu'une zone prise par
 * distance croissante reste d'un seul tenant en 4-adjacence). −1 si inaccessible.
 */
export function distancesDeCroissance(grid: GridShape, graines: number[]): Int32Array {
  return croissance(grid, graines).dist;
}

function croissance(grid: GridShape, graines: number[]): { dist: Int32Array } {
  const W = grid.w, H = grid.h, N = W * H;
  const dist = new Int32Array(N).fill(-1);
  const fait = new Uint8Array(N);
  const tas = new Tas();
  for (const g of graines) if (grid.usable[g] && dist[g] < 0) { dist[g] = 0; tas.pousser(0, g); }
  while (tas.taille) {
    const [d, c] = tas.tirer();
    if (fait[c] || d !== dist[c]) continue;
    fait[c] = 1;
    const x = c % W, y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!grid.usable[n] || fait[n]) continue;
      if (dx && dy && !(grid.usable[y * W + nx] && grid.usable[ny * W + x])) continue;
      const nd = d + (dx && dy ? 14 : 10);
      if (dist[n] < 0 || nd < dist[n]) { dist[n] = nd; tas.pousser(nd, n); }
    }
  }
  return { dist };
}
