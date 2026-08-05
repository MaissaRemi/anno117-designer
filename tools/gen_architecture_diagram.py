"""Genere le schema d'architecture du README a partir des imports reels.

Lit  : src/**/*.ts, src/**/*.tsx (tests exclus)
Ecrit: le bloc mermaid entre les marqueurs ARCHITECTURE:START / ARCHITECTURE:END
       de README.md

Le graphe est agrege au niveau des dossiers de src/ : un noeud par couche, une
arete des que la couche A importe la couche B. Le detail fichier par fichier
serait illisible ; ce qui compte dans un README, c'est le sens des dependances.

Usage : python tools/gen_architecture_diagram.py
"""
from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "src")
README = os.path.join(HERE, "README.md")

START = "<!-- ARCHITECTURE:START -->"
END = "<!-- ARCHITECTURE:END -->"

# Libelles des couches. L'ordre fixe l'ordre de declaration dans le diagramme,
# donc la mise en page produite par mermaid.
LAYERS = [
    ("model", "model", "types, factories, serialisation"),
    ("engine", "engine", "pure rules"),
    ("economy", "economy", "fixed-point solver"),
    ("optimizer", "optimizer", "greedy + annealing"),
    ("data", "data", "generated game data"),
    ("state", "state", "Zustand store"),
    ("render", "render", "Canvas 2D"),
    ("persist", "persist", "save / import / export"),
    ("ui", "ui", "React components"),
    ("app", "app", "entry point"),
]
LABELS = {key: (title, sub) for key, title, sub in LAYERS}

IMPORT_RE = re.compile(r"""(?:from|import)\s+["']([./][^"']+)["']""")


def layer_of(path: str) -> str | None:
    """Couche d'un fichier, d'apres son premier segment sous src/."""
    rel = os.path.relpath(path, SRC).replace("\\", "/")
    head, _, tail = rel.partition("/")
    if not tail:  # fichier a la racine de src/ (App.tsx, main.tsx)
        return "app" if rel.endswith((".ts", ".tsx")) else None
    return head if head in LABELS else None


def source_files() -> list[str]:
    out = []
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            if ".test." in name or name.endswith(".d.ts"):
                continue
            out.append(os.path.join(root, name))
    return sorted(out)


def resolve(importer: str, spec: str) -> str | None:
    """Resout un import relatif vers la couche cible."""
    target = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    if not target.startswith(SRC):
        return None
    return layer_of(target)


def main() -> int:
    files = source_files()
    if not files:
        print("aucun fichier source trouve", file=sys.stderr)
        return 1

    counts: dict[str, int] = {}
    edges: dict[tuple[str, str], int] = {}

    for path in files:
        src_layer = layer_of(path)
        if src_layer is None:
            continue
        counts[src_layer] = counts.get(src_layer, 0) + 1

        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        for spec in IMPORT_RE.findall(text):
            dst_layer = resolve(path, spec)
            if dst_layer is None or dst_layer == src_layer:
                continue
            edges[(src_layer, dst_layer)] = edges.get((src_layer, dst_layer), 0) + 1

    present = [key for key, _t, _s in LAYERS if key in counts]

    # Pas de <b> ni <i> : selon la configuration mermaid, GitHub rend les
    # etiquettes en texte SVG et afficherait les balises telles quelles.
    # Seul <br/> est traite dans les deux modes.
    lines = [
        "```mermaid",
        "flowchart TD",
        '  RDA["Anno 117 archives<br/>.rda"]',
        '  PY["tools/ — Python pipeline<br/>rda_extract + build_*"]',
        "",
        '  subgraph app_["src/"]',
        "    direction TB",
    ]
    for key in present:
        title, sub = LABELS[key]
        n = counts[key]
        files_word = "file" if n == 1 else "files"
        lines.append(f'    {key}["{title}/<br/>{sub}<br/>{n} {files_word}"]')
    lines += ["  end", "", "  RDA --> PY --> data"]

    for (a, b), n in sorted(edges.items(), key=lambda kv: (-kv[1], kv[0])):
        label = f'|"{n}"| ' if n >= 8 else ""
        lines.append(f"  {a} --> {label}{b}")

    lines += [
        "",
        "  classDef ext fill:#2b2b33,stroke:#55555f,color:#d8d6df;",
        "  class RDA,PY ext;",
        "```",
    ]
    block = "\n".join(lines)

    with open(README, encoding="utf-8") as fh:
        readme = fh.read()

    if START not in readme or END not in readme:
        print(f"marqueurs {START} / {END} absents de README.md", file=sys.stderr)
        return 1

    head, _, rest = readme.partition(START)
    _, _, tail = rest.partition(END)
    new = f"{head}{START}\n\n{block}\n\n{END}{tail}"

    with open(README, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(new)

    total_edges = len(edges)
    print(f"README.md <- {len(present)} couches, {total_edges} dependances, {len(files)} fichiers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
