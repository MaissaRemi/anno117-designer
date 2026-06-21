"""Extrait + convertit les icones des batiments (DDS 4k -> PNG 64px) vers public/icons/."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import rda_extract as rda
from PIL import Image
import io

GAME = os.environ.get("ANNO_GAME_DIR", r"F:\Anno 117 - Pax Romana\maindata")
assert os.path.isdir(GAME), f"Repertoire jeu introuvable : {GAME!r}. Definir ANNO_GAME_DIR."
HERE = os.path.dirname(os.path.dirname(__file__))
RAW = os.path.join(HERE, ".gamedata", "catalog.raw.json")
OUTDIR = os.path.join(HERE, "public", "icons")
SIZE = 64


def candidates(fhd_png):
    # data/ui/fhd/.../icon_x.png  ->  data/ui/4k/.../icon_x_0.dds (+ variantes)
    base = fhd_png.replace("/fhd/", "/4k/")
    stem = base[:-4] if base.lower().endswith(".png") else base
    return [stem + "_0.dds", stem + ".dds", base]


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    buildings = json.load(open(RAW, encoding="utf-8"))
    wanted = {}
    for b in buildings:
        ic = b.get("icon")
        if ic:
            wanted[os.path.basename(ic)] = ic  # png basename -> source fhd path
    print(f"{len(wanted)} icones a extraire", file=sys.stderr)

    fh = open(os.path.join(GAME, "ui.rda"), "rb")
    files = rda.read_index(fh)
    index = {f.path.replace("\\", "/").lower(): f for f in files}

    ok = miss = 0
    for png_name, src in wanted.items():
        out = os.path.join(OUTDIR, png_name)
        if os.path.exists(out):
            ok += 1
            continue
        found = None
        for cand in candidates(src):
            f = index.get(cand.lower())
            if f:
                found = f
                break
        if not found:
            miss += 1
            continue
        try:
            data = rda.extract_data(fh, found)
            im = Image.open(io.BytesIO(data)).convert("RGBA")
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
            im.save(out)
            ok += 1
        except Exception as e:
            print(f"  echec {png_name}: {e}", file=sys.stderr)
            miss += 1
    print(f"OK {ok} / manquantes {miss} -> {OUTDIR}", file=sys.stderr)


if __name__ == "__main__":
    main()
