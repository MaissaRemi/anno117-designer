import raw from "./terrain.generated.json";
import { decodeMask } from "./islands";

/** Slot de ressource (extrait des .a7minfo, positions en tuiles). */
export interface TerrainSlot {
  guid: number;
  type: string; // "mountain" | "river" | "marsh" | "blocker"
  x: number;
  y: number;
}

interface TerrainEntry {
  slots: TerrainSlot[];
  rivers: string | null; // RLE 1 bit/tuile (même encodage que le masque terre)
  heights?: string | null; // base64(zlib(int8 w*h)) : q = hauteur/heightScale, mer < 0
  heightScale?: number | null;
}

const terrain = raw as unknown as Record<string, TerrainEntry>;

export function terrainOf(islandId: string): TerrainEntry | undefined {
  return terrain[islandId];
}

/** Cases rivière (boolean[w*h]) d'une île, ou undefined si aucune. */
export function riversOf(islandId: string, w: number, h: number): boolean[] | undefined {
  const t = terrain[islandId];
  if (!t || !t.rivers) return undefined;
  return decodeMask(t.rivers, w, h);
}

/** Slots posables (montagne/rivière/marais — les blockers sont ignorés). */
export function slotsOf(islandId: string): TerrainSlot[] {
  const t = terrain[islandId];
  if (!t) return [];
  return t.slots.filter((s) => s.type !== "blocker");
}

/**
 * Hauteurs quantifiées d'une île (Int8Array w*h, q = hauteur/heightScale, mer < 0),
 * ou null si absentes. Décodage async (zlib via DecompressionStream).
 */
export async function heightsOf(islandId: string): Promise<Int8Array | null> {
  const t = terrain[islandId];
  if (!t?.heights || typeof DecompressionStream === "undefined") return null;
  const compressed = Uint8Array.from(atob(t.heights), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("deflate"); // zlib (RFC 1950)
  const stream = new Blob([compressed]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Int8Array(buf);
}
