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
