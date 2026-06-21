"""
Extrait les îles d'Anno 117 : taille réelle (a7minfo) + forme (mapimage.png).

Pour chaque île du pool de jeu :
- taille en cases : a7minfo, 2 uint32 à l'offset 8 (largeur, hauteur).
- masque terre : mapimage.png (rendu top-down carré), seuillage terre/mer,
  redimensionné à la taille réelle de l'île.

Sortie : src/data/islands.generated.json  (masque encodé en RLE).
Lance : python tools/build_islands.py
"""
import json
import os
import re
import struct
import sys
import io

sys.path.insert(0, os.path.dirname(__file__))
import rda_extract as rda
from PIL import Image
import numpy as np

GAME = os.environ.get("ANNO_GAME_DIR", r"F:\Anno 117 - Pax Romana\maindata")
assert os.path.isdir(GAME), f"Repertoire jeu introuvable : {GAME!r}. Definir ANNO_GAME_DIR."
HERE = os.path.dirname(os.path.dirname(__file__))
OUT = os.path.join(HERE, "src", "data", "islands.generated.json")

ARCHIVES = [
    ("provinces_roman.rda", "Roman"),
    ("provinces_celtic.rda", "Celtic"),
    ("dlc01_provinces.rda", "DLC"),
]

LAND_LUM = 120  # somme RGB au-dessus = terre


def size_from_a7minfo(data: bytes) -> tuple[int, int]:
    w, h = struct.unpack("<II", data[8:16])
    return w, h


def mask_from_mapimage(data: bytes, w: int, h: int) -> list[int]:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    arr = np.asarray(im).astype(np.int32)
    land = (arr.sum(axis=2) > LAND_LUM).astype(np.uint8) * 255
    small = Image.fromarray(land).resize((w, h), Image.BOX)
    bits = (np.asarray(small) > 127).astype(np.uint8).flatten()
    return bits.tolist()


def rle_encode(bits: list[int]) -> str:
    """RLE alterné, commence par le nombre de 0."""
    runs = []
    cur = 0
    cnt = 0
    for b in bits:
        if b == cur:
            cnt += 1
        else:
            runs.append(cnt)
            cur = b
            cnt = 1
    runs.append(cnt)
    return ",".join(map(str, runs))


def nice_name(island_id: str, region: str) -> str:
    m = re.search(r"island_([a-z]+)_(\d+)", island_id)
    sizes = {
        "small": "Petite",
        "medium": "Moyenne",
        "large": "Grande",
        "extralarge": "Très grande",
    }
    if m and m.group(1) in sizes:
        return f"{sizes[m.group(1)]} {int(m.group(2)):02d} ({region})"
    return f"{island_id} ({region})"


def main():
    islands = []
    for arc, region in ARCHIVES:
        path = os.path.join(GAME, arc)
        if not os.path.exists(path):
            continue
        print(f"=== {arc} ===", file=sys.stderr)
        fh = open(path, "rb")
        files = rda.read_index(fh)
        index = {f.path.replace("\\", "/"): f for f in files}
        # îles du pool uniquement (jouables)
        infos = [p for p in index if p.endswith(".a7minfo") and "/islands/pool/" in p]
        for info_path in sorted(infos):
            island_id = os.path.basename(info_path)[:-len(".a7minfo")]
            try:
                info = rda.extract_data(fh, index[info_path])
                w, h = size_from_a7minfo(info)
            except Exception as e:
                print(f"  skip {island_id}: a7minfo {e}", file=sys.stderr)
                continue
            base = info_path.rsplit("/", 1)[0]
            map_path = f"{base}/_gamedata/{island_id}/mapimage.png"
            if map_path not in index:
                print(f"  skip {island_id}: pas de mapimage", file=sys.stderr)
                continue
            try:
                img = rda.extract_data(fh, index[map_path])
                bits = mask_from_mapimage(img, w, h)
            except Exception as e:
                print(f"  skip {island_id}: mapimage {e}", file=sys.stderr)
                continue
            land = int(sum(bits))
            islands.append({
                "id": island_id,
                "name": nice_name(island_id, region),
                "region": region,
                "size": {"w": w, "h": h},
                "land": land,
                "mask": rle_encode(bits),
            })
            print(f"  {island_id}: {w}x{h} land={land}", file=sys.stderr)

    islands.sort(key=lambda i: (i["region"], i["size"]["w"] * i["size"]["h"], i["id"]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(islands, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"OK -> {OUT} ({len(islands)} îles)", file=sys.stderr)


if __name__ == "__main__":
    main()
