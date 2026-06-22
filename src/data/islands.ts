import raw from "./islands.generated.json";

export interface Island {
  id: string;
  name: string;
  region: string;
  size: { w: number; h: number };
  land: number;
  mask: string; // RLE alterné (commence par nb de 0)
}

export const islands: Island[] = raw as Island[];

/** Décode le masque RLE en tableau de booléens (longueur w*h). */
export function decodeMask(rle: string, w: number, h: number): boolean[] {
  const out = new Array<boolean>(w * h);
  let idx = 0;
  let cur = false;
  for (const part of rle.split(",")) {
    const n = parseInt(part, 10);
    for (let i = 0; i < n && idx < out.length; i++) out[idx++] = cur;
    cur = !cur;
  }
  while (idx < out.length) out[idx++] = false;
  return out;
}

export function islandById(id: string): Island | undefined {
  return islands.find((i) => i.id === id);
}

/**
 * Suréchantillonne un masque booléen ×2 (chaque tuile → bloc 2×2, plus proche voisin) :
 * conversion tuile → ½-tuile pour la grille vivante (cf. geometry.ts cellsPerTile).
 * `(2w)×(2h)` cellules ; `out[(2y+dy)·2w + 2x+dx] = src[y·w + x]`.
 */
export function upscale2x(mask: boolean[], w: number, h: number): boolean[] {
  const W = w * 2;
  const out = new Array<boolean>(W * h * 2).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = mask[y * w + x];
    out[(2 * y) * W + 2 * x] = v;
    out[(2 * y) * W + 2 * x + 1] = v;
    out[(2 * y + 1) * W + 2 * x] = v;
    out[(2 * y + 1) * W + 2 * x + 1] = v;
  }
  return out;
}
