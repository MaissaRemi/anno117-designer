"""
Extrait le TERRAIN des îles d'Anno 117 : slots (montagne/rivière/marais) + rivières.

Sources par île (provinces_*.rda) :
- <île>.a7minfo (FileDB v3) : ObjectMetaInfo/RandomSlotObjects = groupes de slots
  (attribut #8000 répété = GUID d'asset Slot par groupe, ex 2882 Slot Roman Mountain,
  2969 Slot Roman River, 5281 Slot Celtic Mountain…), positions en tuiles (x, h, z).
- <île>.a7m (RDA imbriqué) -> gamedata.data (FileDB v3) :
  GameSessionManager/WorldManager/RiverGrid = bitmask 320x320 (1 bit/tuile) des
  rivières (argile, ponts), idem Water/FordGrid.

Sortie : src/data/terrain.generated.json  { islandId: { slots, rivers } }
Lance : python tools/build_terrain.py
"""
import io
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import rda_extract as rda
from filedb import parse

GAME = r"F:\Anno 117 - Pax Romana\maindata"
HERE = os.path.dirname(os.path.dirname(__file__))
OUT = os.path.join(HERE, "src", "data", "terrain.generated.json")

ARCHIVES = ["provinces_roman.rda", "provinces_celtic.rda", "dlc01_provinces.rda"]

# GUID d'asset Slot -> type app
SLOT_TYPES = {
    2882: "mountain", 5281: "mountain", 37926: "mountain", 38473: "mountain",
    2969: "river", 38471: "river",  # 38471 = FixedSlot Roman River
    5282: "marsh",
    37660: "blocker", 37663: "blocker", 37664: "blocker",
}


def rle_encode(bits) -> str:
    runs, cur, cnt = [], 0, 0
    for b in bits:
        if b == cur:
            cnt += 1
        else:
            runs.append(cnt)
            cur = b
            cnt = 1
    runs.append(cnt)
    return ",".join(map(str, runs))


def slots_from_a7minfo(data: bytes):
    """[{guid, type, x, y}] — positions en tuiles (x, z du monde)."""
    root = parse(data)
    rso = root.path("ObjectMetaInfo", "RandomSlotObjects")
    out = []
    if not rso:
        return out
    group_guids = [struct.unpack("<I", v)[0] for v in rso.attribs.get("#8000", [])]
    for gi, grp in enumerate(rso.children):
        guid = group_guids[gi] if gi < len(group_guids) else 0
        stype = SLOT_TYPES.get(guid, f"g{guid}")
        for o in grp.children:
            p = o.attr("Position")
            if not p:
                continue
            x, _h, z = struct.unpack("<3f", p)
            out.append({"guid": guid, "type": stype, "x": round(x, 1), "y": round(z, 1)})
    return out


def grid_bits(node, w: int, h: int):
    """bitmask FileDB (x,y,bits) -> liste de w*h bits (LSB-first)."""
    raw = node.attr("bits")
    gx = struct.unpack("<I", node.attr("x"))[0]
    gy = struct.unpack("<I", node.attr("y"))[0]
    bits = []
    for i in range(gx * gy):
        bits.append((raw[i >> 3] >> (i & 7)) & 1)
    if (gx, gy) != (w, h):
        print(f"    ! grille {gx}x{gy} != île {w}x{h}", file=sys.stderr)
    return bits


def rivers_from_a7m(data: bytes, w: int, h: int):
    """RiverGrid du gamedata.data (a7m = RDA imbriqué)."""
    fh = io.BytesIO(data)
    files = rda.read_index(fh)
    gd = next((f for f in files if f.path.endswith("gamedata.data")), None)
    if not gd:
        return None
    root = parse(rda.extract_data(fh, gd))
    rg = root.path("GameSessionManager", "WorldManager", "RiverGrid")
    if not rg or not rg.attr("bits"):
        return None
    return grid_bits(rg, w, h)


def main():
    terrain = {}
    for arc in ARCHIVES:
        path = os.path.join(GAME, arc)
        if not os.path.exists(path):
            continue
        print(f"=== {arc} ===", file=sys.stderr)
        fh = open(path, "rb")
        files = rda.read_index(fh)
        index = {f.path.replace("\\", "/"): f for f in files}
        infos = [p for p in index if p.endswith(".a7minfo") and "/islands/pool/" in p]
        for info_path in sorted(infos):
            island_id = os.path.basename(info_path)[: -len(".a7minfo")]
            try:
                info = rda.extract_data(fh, index[info_path])
                root = parse(info)
                w, hgt = struct.unpack("<II", root.attr("MapSize"))
                slots = slots_from_a7minfo(info)
            except Exception as e:
                print(f"  skip {island_id}: a7minfo {e}", file=sys.stderr)
                continue
            rivers = None
            a7m_path = info_path[: -len(".a7minfo")] + ".a7m"
            if a7m_path in index:
                try:
                    rivers = rivers_from_a7m(rda.extract_data(fh, index[a7m_path]), w, hgt)
                except Exception as e:
                    print(f"  ! {island_id}: a7m {e}", file=sys.stderr)
            riverCount = sum(rivers) if rivers else 0
            terrain[island_id] = {
                "slots": slots,
                "rivers": rle_encode(rivers) if rivers and riverCount else None,
            }
            byType = {}
            for s in slots:
                byType[s["type"]] = byType.get(s["type"], 0) + 1
            print(f"  {island_id}: slots={byType} rivières={riverCount} cases", file=sys.stderr)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(terrain, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"OK -> {OUT} ({len(terrain)} îles)", file=sys.stderr)


if __name__ == "__main__":
    main()
