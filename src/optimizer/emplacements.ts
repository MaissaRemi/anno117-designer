import type { BuildingDef, GridShape } from "../model/types";

/** Pose d'un bâtiment d'emplacement : coin haut-gauche et orientation. */
export interface PoseEmplacement { x: number; y: number; w: number; h: number; rot: 0 | 90 }

/** Écart toléré autour du point de l'emplacement : ses coordonnées sont arrondies à la case. */
const TOLERANCE = 1;

/**
 * ═══ UN EMPLACEMENT EST UN ENDROIT PRÉDÉFINI ═══════════════════════════════════════════
 *
 * Mines, carrières et source d'aqueduc ne se posent pas « près » d'un emplacement de
 * montagne : elles se posent DESSUS, à l'endroit que l'île prévoit. L'ancienne règle les
 * cherchait dans un rayon de huit cases, dans n'importe quelle orientation, et creusait
 * ensuite une route à travers le relief pour les atteindre — rien de tout cela n'existe en jeu.
 *
 * Les données ne donnent que le CENTRE de l'emplacement, pas son orientation. Parmi les deux
 * orientations centrées (à une case près, pour l'arrondi), la bonne est celle dont un grand
 * côté touche la terre constructible — l'accès de la route — puis celle qui repose le plus sur
 * la pente, là où l'emplacement est creusé dans la montagne.
 *
 * Rend les poses par préférence décroissante ; c'est à l'appelant de vérifier qu'elles sont
 * libres. Pure : même grille, même emplacement, même réponse — la réservation de
 * l'emplacement et la pose du bâtiment tombent ainsi au même endroit.
 */
export function posesSurEmplacement(
  grid: GridShape,
  def: Pick<BuildingDef, "size" | "rotatable">,
  slot: { x: number; y: number },
): PoseEmplacement[] {
  const W = grid.w, H = grid.h;
  const sx = Math.round(slot.x), sy = Math.round(slot.y);
  const dims: [number, number, 0 | 90][] = [[def.size.w, def.size.h, 0]];
  if (def.rotatable !== false && def.size.w !== def.size.h) dims.push([def.size.h, def.size.w, 90]);
  const dedans = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  // la façade déjà réservée (cf. `facadeDe`) compte comme terre : la même île, réservée ou non,
  // doit rendre la même pose
  const terre = (x: number, y: number) => dedans(x, y) && (grid.usable[y * W + x] || (grid.voies?.[y * W + x] ?? false));
  const pente = (x: number, y: number) =>
    dedans(x, y) && !grid.usable[y * W + x] && !(grid.water?.[y * W + x] ?? false) && !(grid.voies?.[y * W + x] ?? false);
  const cands: { p: PoseEmplacement; acces: number; relief: number; ecart: number }[] = [];
  for (const [w, h, rot] of dims) {
    for (let dy = -TOLERANCE; dy <= TOLERANCE; dy++) for (let dx = -TOLERANCE; dx <= TOLERANCE; dx++) {
      const x = sx - (w >> 1) + dx, y = sy - (h >> 1) + dy;
      if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
      let relief = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (pente(x + i, y + j)) relief++;
      // accès : cases de terre le long des GRANDS côtés, là où donne la façade
      let acces = 0;
      if (w >= h) for (let i = 0; i < w; i++) { if (terre(x + i, y - 1)) acces++; if (terre(x + i, y + h)) acces++; }
      if (h >= w) for (let j = 0; j < h; j++) { if (terre(x - 1, y + j)) acces++; if (terre(x + w, y + j)) acces++; }
      cands.push({ p: { x, y, w, h, rot }, acces, relief, ecart: Math.abs(dx) + Math.abs(dy) });
    }
  }
  return cands
    .sort((a, b) => Number(b.acces > 0) - Number(a.acces > 0) || b.relief - a.relief || a.ecart - b.ecart || b.acces - a.acces)
    .map((c) => c.p);
}

/**
 * FAÇADE d'une pose : la rangée de cases le long du grand côté qui donne sur le plus de terre
 * constructible. C'est par là que passe la route d'accès ; la laisser à la merci d'un îlot ou
 * d'une maison laissait une source d'aqueduc sans route, donc inactive.
 */
export function facadeDe(grid: GridShape, p: PoseEmplacement): number[] {
  const W = grid.w, H = grid.h;
  const cotes: [number, number][][] = p.w >= p.h
    ? [p.y - 1, p.y + p.h].map((y) => Array.from({ length: p.w }, (_, i): [number, number] => [p.x + i, y]))
    : [p.x - 1, p.x + p.w].map((x) => Array.from({ length: p.h }, (_, j): [number, number] => [x, p.y + j]));
  const rangees = cotes.map((r) => r.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H).map(([x, y]) => y * W + x));
  const terre = (r: number[]) => r.filter((c) => grid.usable[c] || grid.voies?.[c]).length;
  return terre(rangees[0]) >= terre(rangees[1]) ? rangees[0] : rangees[1];
}
