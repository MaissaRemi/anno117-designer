"""Re-resout les tailles de batiments depuis BuildBlocker (vraie emprise de pose) au lieu
d'Extents (AABB du mesh visuel). Patche catalog.raw.json + src/data/catalog.generated.json
en place (par GUID). Jetable (audit 2026). Requiert ANNO_GAME_DIR."""
import json
import os
import re
import sys

import build_catalog as bc

raw = json.load(open(bc.OUT_RAW, encoding="utf-8"))
idx = bc.ArchiveIndex(bc.GRAPHICS)

changed, details = 0, []
for b in raw:
    cfg = b.get("cfg")
    if not cfg:
        continue
    ifo = re.sub(r"\.cfg$", ".ifo", cfg)
    fh, f = idx.find(ifo)
    if not f:
        continue
    try:
        data = bc.rda.extract_data(fh, f)
    except Exception:
        continue
    size = bc.parse_ifo_size(data)
    if size and size != b.get("size"):
        details.append((b.get("guid"), b.get("nameFr") or b.get("nameInternal"), b.get("size"), size))
        b["size"] = size
        changed += 1

json.dump(raw, open(bc.OUT_RAW, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def gid(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return v

by_guid = {gid(b["guid"]): b["size"] for b in raw if b.get("guid") is not None and "size" in b}
gen = json.load(open(bc.OUT_APP, encoding="utf-8"))
patched = 0
for b in gen:
    g = gid(b.get("guid"))
    if g in by_guid and b.get("size") != by_guid[g]:
        b["size"] = by_guid[g]
        patched += 1
json.dump(gen, open(bc.OUT_APP, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print(f"raw sizes changed: {changed}/{len(raw)}   generated patched: {patched}/{len(gen)}", file=sys.stderr)
for g, n, o, s in details[:40]:
    print(f"  {g} {n}: {o} -> {s}", file=sys.stderr)
