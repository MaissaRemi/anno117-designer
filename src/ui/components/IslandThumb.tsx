import { useEffect, useRef } from "react";
import { decodeMask, type Island } from "../../data/islands";
import { riversOf, zonesOf } from "../../data/terrain";

/**
 * VIGNETTE D'UNE ÎLE, pour la reconnaître d'un coup d'œil : terre constructible, relief,
 * rivières et bande d'eau côtière, d'après les zones du jeu (`terrain.zonesOf`). À défaut de
 * zones, la silhouette seule. `rotation` tourne l'image : une même île peut apparaître tournée
 * sur la carte d'une partie.
 */

interface Couches { w: number; h: number; terre: boolean[]; relief?: boolean[]; eau?: boolean[]; rivieres?: boolean[] }
const cache = new Map<string, Couches>();

function couchesDe(island: Island): Couches {
  let c = cache.get(island.id);
  if (!c) {
    const { w, h } = island.size;
    const z = zonesOf(island.id, w, h);
    c = z
      ? { w, h, terre: z.terre, relief: z.relief, eau: z.eau, rivieres: riversOf(island.id, w, h) }
      : { w, h, terre: decodeMask(island.mask, w, h) };
    cache.set(island.id, c);
  }
  return c;
}

const COULEURS = {
  terre: [124, 179, 66], relief: [139, 125, 107], riviere: [74, 144, 217], eau: [38, 78, 92],
} as const;

export function IslandThumb({ island, size = 64, rotation = 0 }: { island: Island; size?: number; rotation?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { w, h, terre, relief, eau, rivieres } = couchesDe(island);
    const scale = size / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;
    const img = ctx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const gx = Math.floor((px - ox) / scale);
        const gy = Math.floor((py - oy) / scale);
        if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
        const i = gy * w + gx;
        const c = rivieres?.[i] ? COULEURS.riviere : terre[i] ? COULEURS.terre : relief?.[i] ? COULEURS.relief
          : eau?.[i] ? COULEURS.eau : null;
        if (!c) continue;
        const o = (py * size + px) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [island, size]);
  return (
    <canvas ref={ref} width={size} height={size} className="island-thumb"
      style={{ width: size, height: size, transform: rotation ? `rotate(${rotation}deg)` : undefined }} />
  );
}
