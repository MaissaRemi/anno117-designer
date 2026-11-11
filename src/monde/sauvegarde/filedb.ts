/**
 * FILEDB v3 — le format des données d'une sauvegarde (`data.a7s`, et chaque province dedans).
 * Portage de `tools/filedb.py`.
 *
 * Un flux de jetons de 8 octets `[taille int32][id uint32]` :
 * - id 0 : fermeture du tag courant ;
 * - id < 0x8000 : ouverture d'un tag ;
 * - id ≥ 0x8000 : attribut, suivi de `taille` octets de données complétés à un multiple de 8.
 * En fin de fichier : `[adresse dico tags][adresse dico attributs][8][-3]`. Un dictionnaire :
 * `[nombre][nombre × id uint16][nombre noms ASCII terminés par \0]`. Un id absent des
 * dictionnaires s'écrit `#<hexa>` (les éléments de liste sont des `#1`).
 *
 * LECTURE SÉLECTIVE : une sauvegarde pèse ~80 Mo une fois décompressée, presque tout en objets
 * de jeu inutiles ici. `garder` dit, pour chaque tag ouvert (chemin depuis la racine, racine
 * exclue), s'il faut le lire ; un tag refusé est sauté jeton par jeton, sans rien allouer.
 * Les données d'attribut sont des VUES sur le tampon d'origine, jamais des copies.
 */

export interface NoeudFileDb {
  nom: string;
  enfants: NoeudFileDb[];
  attributs: Map<string, Uint8Array[]>;
}

export type FiltreFileDb = (chemin: readonly string[]) => boolean;

function lireDico(d: Uint8Array, v: DataView, o: number, dans: Map<number, string>) {
  const n = v.getUint32(o, true);
  let pos = o + 4 + 2 * n;
  for (let i = 0; i < n; i++) {
    let fin = pos;
    while (fin < d.length && d[fin] !== 0) fin++;
    let nom = "";
    for (let k = pos; k < fin; k++) nom += String.fromCharCode(d[k]);
    dans.set(v.getUint16(o + 4 + 2 * i, true), nom);
    pos = fin + 1;
  }
}

export function lireFileDb(d: Uint8Array, garder?: FiltreFileDb): NoeudFileDb {
  if (d.length < 16) throw new Error("FileDB trop court");
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const finTags = v.getUint32(d.length - 16, true);
  const finAttrs = v.getUint32(d.length - 12, true);
  if (v.getInt32(d.length - 4, true) !== -3) throw new Error("FileDB v3 attendu");
  const noms = new Map<number, string>();
  lireDico(d, v, finTags, noms);
  lireDico(d, v, finAttrs, noms);
  const nomDe = (id: number) => noms.get(id) ?? `#${id.toString(16)}`;

  const racine: NoeudFileDb = { nom: "<root>", enfants: [], attributs: new Map() };
  const pile: NoeudFileDb[] = [racine];
  const chemin: string[] = [];
  let saut = 0; // profondeur dans un tag refusé
  let pos = 0;
  while (pos + 8 <= finTags) {
    const taille = v.getInt32(pos, true);
    const id = v.getUint32(pos + 4, true);
    pos += 8;
    if (id === 0) {
      if (saut) saut--;
      else if (pile.length > 1) { pile.pop(); chemin.pop(); }
      continue;
    }
    if (id >= 0x8000) {
      // fichier abîmé : une taille négative faisait reculer la lecture, sans fin
      if (taille < 0 || pos + taille > finTags) throw new Error("FileDB corrompu : taille d'attribut invalide");
      if (!saut) {
        const nom = nomDe(id);
        const a = pile[pile.length - 1].attributs;
        const l = a.get(nom);
        const val = d.subarray(pos, pos + taille);
        if (l) l.push(val);
        else a.set(nom, [val]);
      }
      pos += (taille + 7) & ~7;
      continue;
    }
    if (saut) { saut++; continue; }
    const nom = nomDe(id);
    chemin.push(nom);
    if (garder && !garder(chemin)) { chemin.pop(); saut = 1; continue; }
    const n: NoeudFileDb = { nom, enfants: [], attributs: new Map() };
    pile[pile.length - 1].enfants.push(n);
    pile.push(n);
  }
  return racine;
}

/**
 * Un filtre qui garde les chemins donnés et tout ce qui est dessous. `*` vaut n'importe quel
 * nom. Les ancêtres d'un chemin gardé sont lus (sans leurs autres enfants).
 */
export function filtreChemins(...motifs: string[][]): FiltreFileDb {
  return (chemin) => motifs.some((m) => {
    const n = Math.min(m.length, chemin.length);
    for (let i = 0; i < n; i++) if (m[i] !== "*" && m[i] !== chemin[i]) return false;
    return true;
  });
}

// ─── ACCÈS ────────────────────────────────────────────────────────────────────────────

export const enfant = (n: NoeudFileDb | undefined, nom: string): NoeudFileDb | undefined => n?.enfants.find((e) => e.nom === nom);
export const enfants = (n: NoeudFileDb | undefined, nom: string): NoeudFileDb[] => n?.enfants.filter((e) => e.nom === nom) ?? [];
export const chemin = (n: NoeudFileDb | undefined, ...noms: string[]): NoeudFileDb | undefined =>
  noms.reduce<NoeudFileDb | undefined>((x, nom) => enfant(x, nom), n);
export const attribut = (n: NoeudFileDb | undefined, nom: string): Uint8Array | undefined => n?.attributs.get(nom)?.[0];
export const attributs = (n: NoeudFileDb | undefined, nom: string): Uint8Array[] => n?.attributs.get(nom) ?? [];

/** Un entier little-endian signé, de la taille de la donnée (1, 2, 4 ou 8 octets). */
export function entier(d: Uint8Array | undefined): number | undefined {
  if (!d || !d.length) return undefined;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  switch (d.length) {
    case 1: return v.getInt8(0);
    case 2: return v.getInt16(0, true);
    case 4: return v.getInt32(0, true);
    case 8: return Number(v.getBigInt64(0, true));
    default: return undefined;
  }
}

/** Un entier 64 bits signé, en texte (il ne tient pas dans un nombre JavaScript). */
export function entier64Texte(d: Uint8Array | undefined): string | undefined {
  if (!d || d.length < 8) return undefined;
  return new DataView(d.buffer, d.byteOffset, 8).getBigInt64(0, true).toString();
}

/** Une suite d'entiers 32 bits little-endian. */
export function entiers32(d: Uint8Array | undefined): number[] {
  if (!d) return [];
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: number[] = [];
  for (let o = 0; o + 4 <= d.length; o += 4) out.push(v.getInt32(o, true));
  return out;
}

export const texteUtf16 = (d: Uint8Array | undefined): string | undefined => (d ? new TextDecoder("utf-16le").decode(d) : undefined);
