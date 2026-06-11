"""
Extrait le TERRAIN des îles d'Anno 117 : slots (montagne/rivière/marais), rivières
et HAUTEURS (pente des aqueducs, constructibilité).

Sources par île (provinces_*.rda) :
- <île>.a7minfo (FileDB v3) : ObjectMetaInfo/RandomSlotObjects = groupes de slots
  (attribut #8000 répété = GUID d'asset Slot par groupe, ex 2882 Slot Roman Mountain,
  2969 Slot Roman River, 5281 Slot Celtic Mountain…), positions en tuiles (x, h, z).
- <île>.a7m (RDA imbriqué) -> gamedata.data (FileDB v3) :
  GameSessionManager/WorldManager/RiverGrid = bitmask 320x320 (1 bit/tuile) des
  rivières (argile, ponts), idem Water/FordGrid.
  GameSessionManager/TerrainManager/HeightMap = (2W+1)x(2H+1) int16 (grille
  demi-tuile, mer < 0) -> échantillonnée au CENTRE de chaque tuile, quantifiée
  q = round(h/16) clampé int8, zlib + base64.

Sortie : src/data/terrain.generated.json
  { islandId: { slots, rivers, heights (b64 zlib int8 w*h), heightScale: 16 } }
Lance : python tools/build_terrain.py
"""
import base64
import io
import json
import os
import struct
import sys
import zlib

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


def gamedata_from_a7m(data: bytes):
    """gamedata.data parsé (a7m = RDA imbriqué), ou None."""
    fh = io.BytesIO(data)
    files = rda.read_index(fh)
    gd = next((f for f in files if f.path.endswith("gamedata.data")), None)
    if not gd:
        return None
    return parse(rda.extract_data(fh, gd))


def rivers_from_gamedata(root, w: int, h: int):
    rg = root.path("GameSessionManager", "WorldManager", "RiverGrid")
    if not rg or not rg.attr("bits"):
        return None
    return grid_bits(rg, w, h)


def heights_from_gamedata(root, w: int, h: int):
    """HeightMap (2W+1)x(2H+1) int16 -> q=round(h/16) int8 par tuile (centre),
    zlib+base64. Mer < 0, terre > 0 (validé sur medium_01 vs slots montagne)."""
    hm = root.path("GameSessionManager", "TerrainManager", "HeightMap")
    if not hm or not hm.attr("HeightMap"):
        return None
    hw = struct.unpack("<I", hm.attr("Width"))[0]
    hh = struct.unpack("<I", hm.attr("Height"))[0]
    raw = hm.attr("HeightMap")
    if hw < 2 * w or hh < 2 * h or len(raw) != hw * hh * 2:
        print(f"    ! heightmap {hw}x{hh} inattendue pour île {w}x{h}", file=sys.stderr)
        return None
    vals = struct.unpack(f"<{hw * hh}h", raw)
    out = bytearray(w * h)
    for y in range(h):
        row = (2 * y + 1) * hw
        for x in range(w):
            q = round(vals[row + 2 * x + 1] / 16)
            q = -128 if q < -128 else (127 if q > 127 else q)
            out[y * w + x] = q & 0xFF
    return base64.b64encode(zlib.compress(bytes(out), 9)).decode("ascii")


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
            heights = None
            a7m_path = info_path[: -len(".a7minfo")] + ".a7m"
            if a7m_path in index:
                try:
                    gd = gamedata_from_a7m(rda.extract_data(fh, index[a7m_path]))
                    if gd is not None:
                        rivers = rivers_from_gamedata(gd, w, hgt)
                        heights = heights_from_gamedata(gd, w, hgt)
                except Exception as e:
                    print(f"  ! {island_id}: a7m {e}", file=sys.stderr)
            riverCount = sum(rivers) if rivers else 0
            terrain[island_id] = {
                "slots": slots,
                "rivers": rle_encode(rivers) if rivers and riverCount else None,
                "heights": heights,
                "heightScale": 16 if heights else None,
            }
            byType = {}
            for s in slots:
                byType[s["type"]] = byType.get(s["type"], 0) + 1
            hkb = len(heights) // 1024 if heights else 0
            print(f"  {island_id}: slots={byType} rivières={riverCount} cases heights={hkb}KB", file=sys.stderr)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(terrain, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"OK -> {OUT} ({len(terrain)} îles)", file=sys.stderr)


if __name__ == "__main__":
    main()
