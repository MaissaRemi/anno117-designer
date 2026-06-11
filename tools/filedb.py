"""Parseur FileDB v3 (Anno 117 .a7m gamedata.data, .a7minfo...).

Format (rétro-ingénierie, cf. .claude/GAME_MECHANICS.md + FileDBReader):
- Flux de noeuds : [int32 contentSize][int32 id]
    id == 0          -> fermeture de tag
    id <  0x8000     -> ouverture de tag (contentSize = 0)
    id >= 0x8000     -> attribut : contentSize octets de données, paddés à 8
- Fin de fichier : [offset dict tags][offset dict attribs][8][0xFFFFFFFD]
  Dictionnaire : [int32 count][count x uint16 id][count noms ASCII \0]
"""
from __future__ import annotations
import struct
from dataclasses import dataclass, field


@dataclass
class Node:
    name: str
    children: list["Node"] = field(default_factory=list)
    attribs: dict[str, list[bytes]] = field(default_factory=dict)

    def child(self, name: str) -> "Node | None":
        for c in self.children:
            if c.name == name:
                return c
        return None

    def path(self, *names: str) -> "Node | None":
        cur = self
        for n in names:
            cur = cur.child(n) if cur else None
        return cur

    def attr(self, name: str) -> bytes | None:
        v = self.attribs.get(name)
        return v[0] if v else None

    def iter(self, name: str):
        for c in self.children:
            if c.name == name:
                yield c


def _read_dict(data: bytes, off: int) -> dict[int, str]:
    (cnt,) = struct.unpack_from("<I", data, off)
    ids = struct.unpack_from(f"<{cnt}H", data, off + 4)
    pos = off + 4 + 2 * cnt
    names = []
    for _ in range(cnt):
        end = data.index(b"\0", pos)
        names.append(data[pos:end].decode("ascii", "replace"))
        pos = end + 1
    return dict(zip(ids, names))


def parse(data: bytes) -> Node:
    tag_off, attr_off, _block, magic = struct.unpack_from("<IIIi", data, len(data) - 16)
    if magic != -3:
        raise ValueError(f"magic FileDB v3 attendu (-3), trouvé {magic}")
    names = _read_dict(data, tag_off)
    names.update(_read_dict(data, attr_off))

    root = Node("<root>")
    stack = [root]
    pos = 0
    end = tag_off
    while pos + 8 <= end:
        size, nid = struct.unpack_from("<iI", data, pos)
        pos += 8
        if nid == 0:  # fermeture
            if len(stack) > 1:
                stack.pop()
            continue
        name = names.get(nid, f"#{nid:x}")  # ids complets (attribs portent le bit 0x8000 aussi dans le dict)
        if nid >= 0x8000:  # attribut
            content = data[pos:pos + size]
            pos += (size + 7) & ~7  # padding à 8
            stack[-1].attribs.setdefault(name, []).append(content)
        else:  # tag
            node = Node(name)
            stack[-1].children.append(node)
            stack.append(node)
    return root


def dump(node: Node, depth: int = 0, max_depth: int = 3, max_children: int = 12) -> None:
    pad = "  " * depth
    at = ", ".join(f"{k}[{len(v[0])}o]" for k, v in list(node.attribs.items())[:8])
    print(f"{pad}{node.name} ({len(node.children)} enfants) {at}")
    if depth < max_depth:
        for c in node.children[:max_children]:
            dump(c, depth + 1, max_depth, max_children)
        if len(node.children) > max_children:
            print(f"{pad}  ... +{len(node.children) - max_children}")
