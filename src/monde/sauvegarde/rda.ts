/**
 * ARCHIVE RDA « Resource File V2.2 » — le conteneur d'une sauvegarde `.a8s` (et des archives du
 * jeu). Portage de `tools/rda_extract.py`, pour lire une sauvegarde dans le navigateur.
 *
 * Format, little-endian :
 * - en-tête de 792 octets : « Resource File V2.2 », puis à l'octet 784 l'adresse du 1er bloc ;
 * - bloc : drapeaux (4), nombre de fichiers (4), répertoire compressé (8) et décompressé (8),
 *   bloc suivant (8). Drapeaux : 1 compressé (zlib), 2 chiffré, 8 supprimé. Le répertoire est
 *   AVANT l'en-tête du bloc, à `bloc - répertoire compressé` ;
 * - fichier (560 octets) : chemin UTF-16 (520), adresse (8), taille compressée (8), taille
 *   décompressée (8), date (8), inconnu (8).
 *
 * Dans une sauvegarde, les fichiers (`meta.a7s`, `header.a7s`, `gamesetup.a7s`, `data.a7s`) ne
 * sont pas compressés par l'archive : chacun est un flux zlib SUIVI de 12 octets — un flux zlib
 * vide (`78 da 03 00 00 00 00 01`) puis la taille décompressée (uint32). Voir `fichierDeSauvegarde`.
 */

const MAGIC = "Resource File V2.2";
const PREMIER_BLOC = 784;
const EN_TETE_BLOC = 32;
const EN_TETE_FICHIER = 560;

export interface FichierRda {
  chemin: string;
  adresse: number;
  tailleCompressee: number;
  tailleDecompressee: number;
  compresse: boolean;
  chiffre: boolean;
}

/**
 * Décompresse un flux zlib (RFC 1950), dans le navigateur comme sous Node.
 *
 * Les fichiers d'une sauvegarde sont suivis d'octets de remplissage après la fin du flux :
 * `DecompressionStream` les refuse (« trailing junk ») APRÈS avoir rendu tout le contenu, là où
 * zlib les ignore. Une erreur arrivée une fois le flux terminé n'est donc pas une erreur ; avant
 * (rien de lu, ou flux tronqué au milieu d'un bloc), si.
 */
export async function inflerZlib(d: Uint8Array): Promise<Uint8Array> {
  const lecteur = new Blob([d as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      total += value.length;
    }
  } catch (e) {
    if (!(e instanceof TypeError && /junk|trailing/i.test(e.message)) || !total) throw e;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const m of morceaux) { out.set(m, o); o += m.length; }
  return out;
}

/** Le contenu d'un fichier de sauvegarde (`data.a7s`…) : son flux zlib, sans la fin de 12 octets
 *  qui fait échouer `DecompressionStream` dans Chrome, et dont la taille annoncée est contrôlée. */
export async function fichierDeSauvegarde(d: Uint8Array): Promise<Uint8Array> {
  const n = d.length;
  const fin = n >= 12 && d[n - 12] === 0x78 && d[n - 10] === 0x03 && d[n - 9] === 0 && d[n - 8] === 0
    && d[n - 7] === 0 && d[n - 6] === 0 && d[n - 5] === 1;
  if (!fin) return inflerZlib(d);
  const attendue = new DataView(d.buffer, d.byteOffset + n - 4, 4).getUint32(0, true);
  const out = await inflerZlib(d.subarray(0, n - 12));
  if (out.length !== attendue) throw new Error(`Sauvegarde tronquée (${out.length} octets lus sur ${attendue})`);
  return out;
}

/** Chiffrement des archives Anno : XOR sur 16 bits, clé glissante. */
function dechiffrer(d: Uint8Array): Uint8Array {
  const out = d.slice();
  let cle = 0xa2c2;
  for (let i = 0; i + 1 < out.length; i += 2) {
    const mot = (out[i] | (out[i + 1] << 8)) ^ cle;
    out[i] = mot & 0xff;
    out[i + 1] = (mot >> 8) & 0xff;
    cle = (cle * 0x7fed + 0x6073) & 0xffff;
  }
  return out;
}

const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));

/** Le répertoire de l'archive. Lève une erreur si ce n'est pas une archive RDA 2.2. */
export async function lireIndexRda(data: Uint8Array): Promise<FichierRda[]> {
  const magic = new TextDecoder("latin1").decode(data.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error("Ce fichier n'est pas une sauvegarde d'Anno 117 (archive RDA 2.2 attendue)");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fichiers: FichierRda[] = [];
  const vus = new Set<number>();
  const utf16 = new TextDecoder("utf-16le");
  let bloc = u64(v, PREMIER_BLOC);
  while (bloc !== 0 && bloc + EN_TETE_BLOC <= data.length && !vus.has(bloc)) {
    vus.add(bloc);
    const drapeaux = v.getUint32(bloc, true);
    const n = v.getUint32(bloc + 4, true);
    const repC = u64(v, bloc + 8);
    const suivant = u64(v, bloc + 24);
    const compresse = !!(drapeaux & 1), chiffre = !!(drapeaux & 2), supprime = !!(drapeaux & 8);
    let rep = data.subarray(bloc - repC, bloc);
    if (chiffre) rep = dechiffrer(rep);
    if (compresse) rep = await inflerZlib(rep);
    if (!supprime) {
      const r = new DataView(rep.buffer, rep.byteOffset, rep.byteLength);
      for (let i = 0; i < n && (i + 1) * EN_TETE_FICHIER <= rep.length; i++) {
        const o = i * EN_TETE_FICHIER;
        const chemin = utf16.decode(rep.subarray(o, o + 520)).split("\0")[0];
        fichiers.push({
          chemin, adresse: u64(r, o + 520), tailleCompressee: u64(r, o + 528), tailleDecompressee: u64(r, o + 536),
          compresse, chiffre,
        });
      }
    }
    bloc = suivant;
  }
  return fichiers;
}

/** Le contenu d'un fichier de l'archive, déchiffré et décompressé par l'archive si besoin. */
export async function extraireRda(data: Uint8Array, f: FichierRda): Promise<Uint8Array> {
  let d = data.subarray(f.adresse, f.adresse + f.tailleCompressee);
  if (f.chiffre) d = dechiffrer(d);
  if (f.compresse) d = await inflerZlib(d);
  return d;
}
