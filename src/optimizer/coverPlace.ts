import { computeRadiusCoverage, type DefLookup } from "../engine/rules";
import { footprintCells, isUsable } from "../engine/geometry";
import { uid } from "../model/factories";
import type { Layout, PlacedBuilding } from "../model/types";
import { economy } from "../economy/economy";

export interface CoverPlaceResult {
  added: PlacedBuilding[];
  perService: { serviceId: string; name: string; placed: number; gap: number }[];
}

interface Opts {
  maxPerService?: number; // garde-fou
  candidateStride?: number; // échantillonnage des positions candidates
}

/**
 * Place gloutonnement des bâtiments de service pour couvrir un MAXIMUM de
 * résidences (vise 100 % par service). Couverture par distance-rue si des routes
 * existent, sinon euclidienne. Les positions candidates touchent une route
 * (accès requis) ; leurs zones de couverture sont précalculées une fois (elles ne
 * dépendent que des routes + grille), donc le glouton est un set-cover rapide.
 */
export function placeServicesForCoverage(layout: Layout, lookup: DefLookup, opts: Opts = {}): CoverPlaceResult {
  const maxPer = opts.maxPerService ?? 40;
  const grid = layout.grid;
  const { w: W, h: H } = grid;

  // occupé : emprises bâtiments + champs + routes + hors-terre
  const occ = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (!isUsable(grid, i % W, Math.floor(i / W))) occ[i] = 1;
  for (const b of layout.buildings) {
    const def = lookup(b.defId);
    if (!def) continue;
    for (const c of footprintCells(def, b.x, b.y, b.rotation)) if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) occ[c.y * W + c.x] = 1;
  }
  for (const f of layout.fields) if (f.x >= 0 && f.y >= 0 && f.x < W && f.y < H) occ[f.y * W + f.x] = 1;
  const roadSet = new Set(layout.roads.map((r) => `${r.x},${r.y}`));
  for (const r of layout.roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) occ[r.y * W + r.x] = 1;

  // résidences posées + tier
  const tierByResidence = new Map<string, (typeof economy.tiers)[number]>();
  for (const t of economy.tiers) if (t.residenceId) tierByResidence.set(t.residenceId, t);
  const residences = layout.buildings
    .map((b, idx) => ({ b, idx, tier: tierByResidence.get(b.defId) }))
    .filter((r) => r.tier);

  // couverture existante par service
  const cov = computeRadiusCoverage(layout, lookup);
  const existingCover = new Map<string, Set<string>>();
  for (const b of layout.buildings) {
    const set = cov.get(b.uid);
    if (!set) continue;
    let u = existingCover.get(b.defId);
    if (!u) existingCover.set(b.defId, (u = new Set()));
    for (const k of set) u.add(k);
  }

  // services requis (à rayon) -> résidences qui les exigent
  const required = new Map<string, { resIdx: number; cells: string[] }[]>();
  for (const { b, tier } of residences) {
    const def = lookup(b.defId)!;
    const cells = footprintCells(def, b.x, b.y, b.rotation).map((c) => `${c.x},${c.y}`);
    const resIdx = layout.buildings.indexOf(b);
    for (const s of tier!.services) {
      if (!s.building) continue;
      const sdef = lookup(s.building);
      if (!sdef || !(sdef.streetRange || sdef.radius?.range)) continue; // rayon inconnu -> skip
      let arr = required.get(s.building);
      if (!arr) required.set(s.building, (arr = []));
      arr.push({ resIdx, cells });
    }
  }

  const added: PlacedBuilding[] = [];
  const perService: CoverPlaceResult["perService"] = [];

  // couverture d'un placement hypothétique (réutilise la logique street/euclidienne)
  const coverageOf = (defId: string, x: number, y: number): Set<string> => {
    const tmp: Layout = { grid, buildings: [{ uid: "tmp", defId, x, y, rotation: 0, locked: false }], roads: layout.roads, fields: [] };
    return computeRadiusCoverage(tmp, lookup).get("tmp") ?? new Set();
  };

  for (const [serviceId, resList] of required) {
    const sdef = lookup(serviceId)!;
    const fw = sdef.size.w, fh = sdef.size.h;
    const existing = existingCover.get(serviceId) ?? new Set<string>();

    // résidences pas encore couvertes par ce service
    let uncovered = resList.filter((r) => !r.cells.some((k) => existing.has(k)));

    // positions candidates : emprise libre + (si routes) adjacente à une route
    const fits = (x: number, y: number): boolean => {
      if (x + fw > W || y + fh > H) return false;
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (occ[(y + j) * W + (x + i)]) return false;
      return true;
    };
    const touchesRoad = (x: number, y: number): boolean => {
      if (roadSet.size === 0) return true;
      for (let j = -1; j <= fh; j++) for (let i = -1; i <= fw; i++) {
        if ((i >= 0 && i < fw && j >= 0 && j < fh)) continue;
        if (roadSet.has(`${x + i},${y + j}`)) return true;
      }
      return false;
    };
    const stride = opts.candidateStride ?? 2;
    const candidates: { x: number; y: number; ids: Set<number> }[] = [];
    for (let y = 0; y + fh <= H; y += stride) {
      for (let x = 0; x + fw <= W; x += stride) {
        if (!fits(x, y) || !touchesRoad(x, y)) continue;
        const set = coverageOf(serviceId, x, y);
        const ids = new Set<number>();
        for (let ri = 0; ri < uncovered.length; ri++) if (uncovered[ri].cells.some((k) => set.has(k))) ids.add(ri);
        if (ids.size > 0) candidates.push({ x, y, ids });
      }
    }

    // glouton max-cover
    const coveredIdx = new Set<number>();
    let placed = 0;
    while (coveredIdx.size < uncovered.length && placed < maxPer) {
      let best = -1, bestGain = 0;
      for (let ci = 0; ci < candidates.length; ci++) {
        let gain = 0;
        for (const id of candidates[ci].ids) if (!coveredIdx.has(id)) gain++;
        if (gain > bestGain) { bestGain = gain; best = ci; }
      }
      if (best < 0 || bestGain === 0) break;
      const c = candidates[best];
      added.push({ uid: uid("cov"), defId: serviceId, x: c.x, y: c.y, rotation: 0, locked: false });
      placed++;
      for (const id of c.ids) coveredIdx.add(id);
      // occuper l'emprise -> invalider les candidats qui s'y chevauchent
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) occ[(c.y + j) * W + (c.x + i)] = 1;
      candidates.splice(best, 1);
      for (let k = candidates.length - 1; k >= 0; k--) {
        const o = candidates[k];
        if (o.x < c.x + fw && o.x + fw > c.x && o.y < c.y + fh && o.y + fh > c.y) candidates.splice(k, 1);
      }
    }
    perService.push({ serviceId, name: sdef.name, placed, gap: uncovered.length - coveredIdx.size });
  }

  return { added, perService };
}
