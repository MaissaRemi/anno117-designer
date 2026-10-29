import raw from "./terrain.generated.json";
import { decodeMask, islandById } from "./islands";

/**
 * ═══ DEUX REPÈRES, UN SEUL AFFICHAGE ═══════════════════════════════════════════════════
 *
 * Le masque de terre vient de l'IMAGE de l'île (`mapimage.png`) : ligne 0 en HAUT, comme le
 * joueur voit l'île. Les emplacements, les rivières et les hauteurs viennent des DONNÉES du
 * jeu (`.a7minfo`, `gamedata.data`), dont l'axe z du monde monte vers le NORD — l'inverse.
 *
 * Ils étaient superposés tels quels : tout ce qui vient des données était en miroir vertical
 * par rapport à l'île affichée. Mesuré sur quatre îles, la terre des hauteurs et celle de
 * l'image ne coïncident qu'à 40-50 % telles quelles, à 93-95 % une fois l'axe retourné. Les
 * emplacements de montagne tombaient en mer ou en prairie, d'où des sources d'aqueduc « au
 * milieu de nulle part », et les rivières rendaient inconstructibles des bandes de prairie.
 *
 * Tout passe donc dans le repère de l'IMAGE, ici et nulle part ailleurs.
 */
const hauteurDe = (islandId: string): number | undefined => islandById(islandId)?.size.h;

/** Copie une grille w×h ligne à ligne, la ligne y allant en h − 1 − y. */
function retourner<T extends boolean[] | Int8Array>(src: T, dst: T, w: number, h: number): T {
  for (let y = 0; y < h; y++) {
    const vers = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) dst[vers + x] = src[y * w + x];
  }
  return dst;
}

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
  /** Cases trop raides pour bâtir (montagnes, falaises), RLE ; cf. tools/build_pentes.py. */
  pentes?: string | null;
  hasHeights?: boolean; // hauteurs dispo (dans terrain.heights.generated, chargé à la demande)
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
  return retourner(decodeMask(t.rivers, w, h), new Array<boolean>(w * h), w, h);
}

/**
 * Cases trop raides pour bâtir (boolean[w*h], repère de l'image), ou undefined.
 *
 * Le masque de terre vient d'une image où la roche est de la terre comme une autre : sans ce
 * masque, les moteurs posaient routes et maisons sur les montagnes.
 */
export function pentesOf(islandId: string, w: number, h: number): boolean[] | undefined {
  const t = terrain[islandId];
  if (!t || !t.pentes) return undefined;
  return retourner(decodeMask(t.pentes, w, h), new Array<boolean>(w * h), w, h);
}

/** Vrai si l'île a des hauteurs extraites (le décodage peut malgré tout échouer côté navigateur). */
export function hasHeights(islandId: string): boolean {
  return terrain[islandId]?.hasHeights === true;
}

/** Slots posables (montagne/rivière/marais — les blockers sont ignorés), repère de l'image. */
export function slotsOf(islandId: string): TerrainSlot[] {
  const t = terrain[islandId];
  const h = hauteurDe(islandId);
  if (!t || h === undefined) return [];
  // positions continues en tuiles : le retournement est h − y, pas h − 1 − y
  return t.slots.filter((s) => s.type !== "blocker").map((s) => ({ ...s, y: h - s.y }));
}

/**
 * Hauteurs quantifiées d'une île (Int8Array w*h, q = hauteur/heightScale, mer < 0),
 * ou null si absentes. Le gros fichier de hauteurs (~4.7 Mo) est chargé À LA DEMANDE
 * (import dynamique → chunk séparé, hors bundle principal). Décodage zlib async.
 */
let heightsData: Record<string, string> | null = null;
export async function heightsOf(islandId: string): Promise<Int8Array | null> {
  const t = terrain[islandId];
  if (!t?.hasHeights || typeof DecompressionStream === "undefined") return null;
  if (!heightsData) heightsData = (await import("./terrain.heights.generated.json")).default as Record<string, string>;
  const b64 = heightsData[islandId];
  if (!b64) return null;
  const compressed = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("deflate"); // zlib (RFC 1950)
  const stream = new Blob([compressed]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  const brut = new Int8Array(buf);
  const taille = islandById(islandId)?.size;
  if (!taille || brut.length !== taille.w * taille.h) return brut;
  return retourner(brut, new Int8Array(brut.length), taille.w, taille.h);
}
