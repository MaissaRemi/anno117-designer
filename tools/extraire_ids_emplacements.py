"""
IDENTIFIANTS DES EMPLACEMENTS — ajoute `id` a chaque slot de terrain.generated.json.

Un emplacement d'ile (montagne, riviere, marais) est un objet de `ObjectMetaInfo/RandomSlotObjects`
du fichier `<ile>.a7minfo`, avec un `ObjectId` sur 64 bits. Une sauvegarde dit, ile par ile, quels
emplacements le generateur de carte a ACTIVES (`MapTemplate/.../MineSlotActivation`, paires
ObjectId / booleen) : les emplacements « Slot ... » sont des objets de carte aleatoires (actives
selon le reglage de matieres premieres), les « Fixed Slot ... » le sont toujours (`ActivateAll`).
Pour qu'un import de sauvegarde retire les emplacements inactifs, l'application doit connaitre
l'ObjectId de chacun.

L'id est ecrit en TEXTE : un entier 64 bits ne tient pas dans un nombre JavaScript.
Appariement par GUID d'asset et position (arrondie au dixieme, comme build_terrain.py).

Usage : python tools/extraire_ids_emplacements.py   (ANNO_GAME_DIR = dossier maindata du jeu)
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import rda_extract as rda  # noqa: E402
from filedb import parse  # noqa: E402

GAME = os.environ.get(
    "ANNO_GAME_DIR",
    r"C:\Program Files (x86)\Ubisoft\Ubisoft Game Launcher\games\Anno 117 - Pax Romana\maindata",
)
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TERRAIN = os.path.join(HERE, "src", "data", "terrain.generated.json")
ARCHIVES = ["provinces_roman.rda", "provinces_celtic.rda", "dlc01_provinces.rda"]


def ids_du_fichier(data):
    """(guid, x, y) -> ObjectId en texte, positions arrondies comme dans terrain.generated.json."""
    root = parse(data)
    rso = root.path("ObjectMetaInfo", "RandomSlotObjects")
    out = {}
    if not rso:
        return out
    guids = [struct.unpack("<I", v)[0] for v in rso.attribs.get("#8000", [])]
    for gi, grp in enumerate(rso.children):
        guid = guids[gi] if gi < len(guids) else 0
        for o in grp.children:
            p, oid = o.attr("Position"), o.attr("ObjectId")
            if not p or not oid:
                continue
            x, _h, z = struct.unpack("<3f", p)
            out[(guid, round(x, 1), round(z, 1))] = str(struct.unpack("<q", oid[:8])[0])
    return out


def main():
    terrain = json.load(open(TERRAIN, encoding="utf-8"))
    patchs = rda.PatchOverlay(GAME)
    poses = manques = 0
    for arc in ARCHIVES:
        chemin = os.path.join(GAME, arc)
        if not os.path.exists(chemin):
            continue
        fh = open(chemin, "rb")
        index = {f.path.replace("\\", "/"): f for f in rda.read_index(fh)}
        for p in sorted(index):
            if not (p.endswith(".a7minfo") and "/islands/pool/" in p):
                continue
            ile = os.path.basename(p)[: -len(".a7minfo")]
            if ile not in terrain:
                continue
            ids = ids_du_fichier(rda.extract_data(*(patchs.find(p) or (fh, index[p]))))
            for s in terrain[ile]["slots"]:
                oid = ids.get((s["guid"], s["x"], s["y"]))
                if oid:
                    s["id"] = oid
                    poses += 1
                else:
                    manques += 1
                    print(f"  {ile} : emplacement {s['guid']} ({s['x']}, {s['y']}) sans ObjectId", file=sys.stderr)
    json.dump(terrain, open(TERRAIN, "w", encoding="utf-8", newline="\n"), ensure_ascii=False)
    print(f"{poses} emplacements identifies, {manques} sans ObjectId", file=sys.stderr)


if __name__ == "__main__":
    main()
