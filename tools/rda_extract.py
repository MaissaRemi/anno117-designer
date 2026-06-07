"""
Extracteur d'archives RDA "Resource File V2.2" (Anno 1800 / Anno 117).

Format (little-endian) :
- Header 792 o : magic "Resource File V2.2" (18 o), padding, puis @784 offset(8 o) du 1er block.
- Block header 32 o : flags(4) nbFichiers(4) dirCompressee(8) dirDecompressee(8) nextBlock(8).
  flags : 1=compresse(zlib), 2=chiffre, 4=resident memoire, 8=supprime.
  Le repertoire (nbFichiers * 560 o) est situe AVANT le block header :
  a l'offset (blockOffset - dirCompressee).
- File header 560 o : path utf-16le(520) dataOffset(8) tailleCompressee(8)
  tailleDecompressee(8) timestamp(8) inconnu(8).

Usage :
  python rda_extract.py list   <archive.rda>            [filtre]
  python rda_extract.py get    <archive.rda> <chemin_interne> <sortie>
  python rda_extract.py dump   <archive.rda> <prefixe_interne> <dossier_sortie>
"""
import struct
import sys
import zlib
import os

HEADER_SIZE = 792
FIRST_BLOCK_PTR = 784
BLOCK_HEADER_SIZE = 32
FILE_HEADER_SIZE = 560

FLAG_COMPRESSED = 1
FLAG_ENCRYPTED = 2
FLAG_DELETED = 8


class RDAFile:
    __slots__ = ("path", "offset", "csize", "usize", "compressed", "encrypted")

    def __init__(self, path, offset, csize, usize, compressed, encrypted):
        self.path = path
        self.offset = offset
        self.csize = csize
        self.usize = usize
        self.compressed = compressed
        self.encrypted = encrypted


def read_index(fh):
    fh.seek(0, os.SEEK_END)
    filesize = fh.tell()
    fh.seek(0)
    magic = fh.read(18)
    if magic != b"Resource File V2.2":
        raise ValueError(f"magic inattendu: {magic!r}")
    fh.seek(FIRST_BLOCK_PTR)
    block_off = struct.unpack("<Q", fh.read(8))[0]

    files = []
    visited = set()
    while block_off != 0 and block_off < filesize:
        if block_off in visited:
            break
        visited.add(block_off)
        fh.seek(block_off)
        flags, n, dir_c, dir_u, next_off = struct.unpack("<IIQQQ", fh.read(BLOCK_HEADER_SIZE))
        compressed = bool(flags & FLAG_COMPRESSED)
        encrypted = bool(flags & FLAG_ENCRYPTED)
        deleted = bool(flags & FLAG_DELETED)

        dir_start = block_off - dir_c
        fh.seek(dir_start)
        raw = fh.read(dir_c)
        if encrypted:
            raw = decrypt(raw)
        if compressed:
            raw = zlib.decompress(raw)
        if len(raw) != dir_u:
            # tolerant : on continue avec ce qu'on a
            pass

        if not deleted:
            for i in range(n):
                rec = raw[i * FILE_HEADER_SIZE:(i + 1) * FILE_HEADER_SIZE]
                if len(rec) < FILE_HEADER_SIZE:
                    break
                path = rec[:520].decode("utf-16-le", "ignore").split("\x00", 1)[0]
                offset, csize, usize, _ts, _unk = struct.unpack("<QQQQQ", rec[520:560])
                files.append(RDAFile(path, offset, csize, usize, compressed, encrypted))
        block_off = next_off
    return files


def extract_data(fh, f: RDAFile) -> bytes:
    fh.seek(f.offset)
    raw = fh.read(f.csize)
    if f.encrypted:
        raw = decrypt(raw)
    if f.compressed:
        raw = zlib.decompress(raw)
    return raw


def decrypt(data: bytes) -> bytes:
    # Chiffre Anno (XOR 16 bits, cle fixe 0xA2C2). Applique seulement si flag chiffre.
    key = 0xA2C2
    out = bytearray(data)
    n = len(out) & ~1
    for i in range(0, n, 2):
        word = out[i] | (out[i + 1] << 8)
        word ^= key
        out[i] = word & 0xFF
        out[i + 1] = (word >> 8) & 0xFF
        key = (key * 0x7FED + 0x6073) & 0xFFFF
    return bytes(out)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return
    cmd, archive = sys.argv[1], sys.argv[2]
    with open(archive, "rb") as fh:
        files = read_index(fh)
        if cmd == "list":
            filt = sys.argv[3].lower() if len(sys.argv) > 3 else ""
            count = 0
            for f in files:
                if filt in f.path.lower():
                    print(f"{f.usize:>12}  {f.path}")
                    count += 1
            print(f"--- {count} fichier(s) (sur {len(files)} total) ---", file=sys.stderr)
        elif cmd == "get":
            target, out = sys.argv[3], sys.argv[4]
            for f in files:
                if f.path.replace("\\", "/").lower() == target.replace("\\", "/").lower():
                    data = extract_data(fh, f)
                    with open(out, "wb") as o:
                        o.write(data)
                    print(f"OK {len(data)} o -> {out}", file=sys.stderr)
                    return
            print("introuvable", file=sys.stderr)
        elif cmd == "dump":
            prefix, outdir = sys.argv[3].replace("\\", "/").lower(), sys.argv[4]
            for f in files:
                p = f.path.replace("\\", "/")
                if p.lower().startswith(prefix):
                    dest = os.path.join(outdir, p)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with open(dest, "wb") as o:
                        o.write(extract_data(fh, f))
                    print(f"OK {p}", file=sys.stderr)


if __name__ == "__main__":
    main()
