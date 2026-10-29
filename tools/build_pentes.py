"""
Masque des PENTES de chaque île : les cases trop raides pour bâtir (montagnes, falaises).

Le masque de terre vient de l'image vue du dessus (mapimage.png) : la roche y est de la terre
comme une autre, si bien que les moteurs posaient routes et maisons sur les montagnes. Le jeu,
lui, refuse un bâtiment dont l'emprise est trop pentue (SteepnessMaxHeightDiff). On ne dispose
que des hauteurs QUANTIFIÉES (q = hauteur / 16, cf. build_terrain.py), trop grossières pour ce
seuil ; on mesure donc le relief local : écart max − min des hauteurs dans une fenêtre de
(2·RAYON + 1)² cases. Au-delà de SEUIL, la case est une pente.

Réglage validé à l'œil sur l'image de trois îles (roman_island_medium_01, small_06, large_03) :
le masque couvre les massifs rocheux et les falaises, laisse prairies et plages. Les sommets
plats au cœur des massifs restent hors masque, mais cernés de pentes ils ne sont reliés à rien
et les moteurs ne gardent que la terre reliée au comptoir.

Entrée : src/data/terrain.heights.generated.json (+ tailles dans islands.generated.json).
Sortie : champ « pentes » (RLE, repère des DONNÉES du jeu, comme « rivers ») ajouté à
src/data/terrain.generated.json. Ne lit pas les fichiers du jeu.
Lance : python tools/build_pentes.py
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from build_terrain import rle_encode  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "src", "data")
RAYON = 2
SEUIL = 12


def _glisse(vals: list[int], r: int, f) -> list[int]:
    """f (max ou min) sur une fenêtre de 2r + 1 valeurs, bornée aux extrémités."""
    n = len(vals)
    return [f(vals[max(0, i - r):min(n, i + r + 1)]) for i in range(n)]


def masque_pentes(q: list[int], w: int, h: int) -> list[bool]:
    """q : hauteurs quantifiées (h × w, par lignes). Vrai là où le relief local dépasse SEUIL.

    Max et min d'une fenêtre carrée sont séparables : d'abord par lignes, puis par colonnes."""
    def filtre(f):
        lignes = [_glisse(q[y * w:(y + 1) * w], RAYON, f) for y in range(h)]
        out = [0] * (w * h)
        for x in range(w):
            col = _glisse([lignes[y][x] for y in range(h)], RAYON, f)
            for y in range(h):
                out[y * w + x] = col[y]
        return out
    mx, mn = filtre(max), filtre(min)
    return [mx[i] - mn[i] >= SEUIL and q[i] > 0 for i in range(w * h)]


def main():
    terrain_path = os.path.join(DATA, "terrain.generated.json")
    terrain = json.load(open(terrain_path, encoding="utf-8"))
    hauteurs = json.load(open(os.path.join(DATA, "terrain.heights.generated.json"), encoding="utf-8"))
    tailles = {i["id"]: i["size"] for i in json.load(open(os.path.join(DATA, "islands.generated.json"), encoding="utf-8"))}
    for ile, entree in terrain.items():
        b64 = hauteurs.get(ile)
        taille = tailles.get(ile)
        if not b64 or not taille:
            entree.pop("pentes", None)
            continue
        brut = zlib.decompress(base64.b64decode(b64))
        w, h = taille["w"], taille["h"]
        if len(brut) != w * h:
            print(f"  ! {ile} : hauteurs {len(brut)} != {w}x{h}, ignorée", file=sys.stderr)
            entree.pop("pentes", None)
            continue
        q = [b - 256 if b > 127 else b for b in brut]  # int8
        m = masque_pentes(q, w, h)
        entree["pentes"] = rle_encode([1 if v else 0 for v in m])
        print(f"  {ile} : {sum(m)} cases en pente", file=sys.stderr)
    with open(terrain_path, "w", encoding="utf-8") as f:
        json.dump(terrain, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
