"""
QUAIS DES BATIMENTS COTIERS — ajoute `partieQuai` au catalogue de l'application.

Le fichier .ifo d'un batiment cotier decrit TROIS zones, en cases, dans le repere de son
emprise (`BuildBlocker`) :
  - `QuayArea`     le quai, a terre — un polygone, pas toujours un rectangle : celui du
                   ramasseur de coques est en U (deux colonnes, plus une rangee en haut et en bas) ;
  - `WaterBlocker` la partie dans l'eau (deja extraite en `partieEau` par build_catalog.py) ;
  - le reste de l'emprise, ni quai ni eau.

Le moteur exigeait de la terre partout hors de l'eau. Or le reste de l'emprise peut se trouver
au LARGE, derriere la partie dans l'eau : les marais salants (eau x 2->7 dans une emprise
-1->8) et le ramasseur de coques (eau x 3->7,2 dans -1->8) reclamaient de la terre en pleine mer
et ne se posaient jamais.

Cible : les entrees du catalogue qui ont deja une `partieEau`. Le cfg vient d'assets.xml (par
GUID, en remontant `BaseAssetGUID` pour les assets derives, comme les comptoirs d'Albion), le
.ifo du patch le plus recent qui le contient. La `partieEau` recalculee doit etre identique a
celle du catalogue : sinon l'outil le signale et n'ecrit rien pour ce batiment.

Usage : python tools/extraire_quais.py <assets.xml extrait de config.rda>
        (ANNO_GAME_DIR = dossier maindata du jeu)
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
import rda_extract as rda  # noqa: E402

GAME = os.environ.get(
    "ANNO_GAME_DIR",
    r"C:\Program Files (x86)\Ubisoft\Ubisoft Game Launcher\games\Anno 117 - Pax Romana\maindata",
)
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(HERE, "src", "data", "catalog.generated.json")
BASES = ["graphics_roman.rda", "graphics_celtic.rda", "graphics_roman_celtic.rda", "graphics_library.rda",
         "graphics_misc.rda", "dlc01_graphics.rda", "dlc02_graphics.rda", "cdlc01_graphics.rda",
         "cdlc02_graphics.rda", "cdlc03_graphics.rda"]


def assets_par_guid(path, voulus):
    """guid -> (cfg, base) pour les GUID voulus et leurs parents."""
    texte = open(path, encoding="utf-8", errors="replace").read()
    out = {}
    a_trouver = set(voulus)
    while a_trouver:
        g = a_trouver.pop()
        m = re.search(r"<GUID>" + g + r"</GUID>", texte)
        if not m:
            continue
        debut = texte.rfind("<Asset>", 0, m.start())
        bloc = texte[debut:texte.find("</Asset>", m.end())]
        cfg = re.search(r"<Filename>([^<]*\.cfg)</Filename>", bloc)
        base = re.search(r"<BaseAssetGUID>(\d+)</BaseAssetGUID>", bloc)
        out[g] = (cfg.group(1) if cfg else None, base.group(1) if base else None)
        if not cfg and base and base.group(1) not in out:
            a_trouver.add(base.group(1))
    return out


def cfg_de(guid, assets):
    while guid in assets:
        cfg, base = assets[guid]
        if cfg:
            return cfg
        guid = base
    return None


class Fichiers:
    """Trouve un fichier interne : patchs les plus recents d'abord, puis archives de base."""

    def __init__(self):
        self.patchs = rda.PatchOverlay(GAME)
        self.bases = []
        for name in BASES:
            p = os.path.join(GAME, name)
            if os.path.exists(p):
                fh = open(p, "rb")
                self.bases.append((fh, {f.path.replace("\\", "/").lower(): f for f in rda.read_index(fh)}))

    def lire(self, chemin):
        k = chemin.replace("\\", "/").lower()
        t = self.patchs.find(k)
        if t:
            return rda.extract_data(*t)
        for fh, m in self.bases:
            if k in m:
                return rda.extract_data(fh, m[k])
        return None


def rect(el, x0, z0):
    """Boite englobante d'un polygone, en cases depuis le coin (x0, z0) de l'emprise."""
    xs = [float(p.findtext("xf") or 0) for p in el.findall("./Position")]
    zs = [float(p.findtext("zf") or 0) for p in el.findall("./Position")]
    if not xs:
        return None
    return {"x": round(min(xs) - x0), "y": round(min(zs) - z0),
            "w": max(1, round(max(xs) - min(xs))), "h": max(1, round(max(zs) - min(zs)))}


def cases_du_polygone(el, x0, z0, w, h):
    """Le polygone rasterise : les cases de l'emprise dont le CENTRE est dedans, en rectangles
    (lignes de cases contigues, fusionnees quand deux lignes voisines sont identiques)."""
    pts = [(float(p.findtext("xf") or 0), float(p.findtext("zf") or 0)) for p in el.findall("./Position")]
    if len(pts) < 3:
        return None

    def dedans(px, pz):
        n, ok = len(pts), False
        for k in range(n):
            (ax, az), (bx, bz) = pts[k], pts[(k + 1) % n]
            if (az > pz) != (bz > pz) and px < ax + (pz - az) * (bx - ax) / (bz - az):
                ok = not ok
        return ok

    lignes = []
    for j in range(h):
        runs, i = [], 0
        while i < w:
            if dedans(x0 + i + 0.5, z0 + j + 0.5):
                d = i
                while i < w and dedans(x0 + i + 0.5, z0 + j + 0.5):
                    i += 1
                runs.append((d, i - d))
            else:
                i += 1
        lignes.append(runs)
    rects, ouverts = [], {}
    for j, runs in enumerate(lignes + [[]]):
        suite = {}
        for r in runs:
            if r in ouverts:
                suite[r] = ouverts.pop(r)
            else:
                suite[r] = j
        for (d, lw), j0 in ouverts.items():
            rects.append({"x": d, "y": j0, "w": lw, "h": j - j0})
        ouverts = suite
    return sorted(rects, key=lambda r: (r["y"], r["x"])) or None


def zones(data):
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        root = ET.fromstring(data.decode("latin-1"))
    bb = root.find("./BuildBlocker")
    if bb is None:
        return None
    xs = [float(p.findtext("xf") or 0) for p in bb.findall("./Position")]
    zs = [float(p.findtext("zf") or 0) for p in bb.findall("./Position")]
    x0, z0 = min(xs), min(zs)
    w, h = max(1, round(max(xs) - x0)), max(1, round(max(zs) - z0))
    wb, qa = root.find("./WaterBlocker"), root.find("./QuayArea")
    return {
        "eau": rect(wb, x0, z0) if wb is not None else None,
        "quai": cases_du_polygone(qa, x0, z0, w, h) if qa is not None else None,
    }


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cat = json.load(open(CATALOG, encoding="utf-8"))
    cotiers = [b for b in cat if b.get("partieEau")]
    assets = assets_par_guid(sys.argv[1], {str(b["guid"]) for b in cotiers})
    fichiers = Fichiers()
    ecrits = 0
    for b in cotiers:
        cfg = cfg_de(str(b["guid"]), assets)
        data = fichiers.lire(re.sub(r"\.cfg$", ".ifo", cfg)) if cfg else None
        z = zones(data) if data else None
        if not z or not z["quai"]:
            print(f"  {b['id']} {b['name']} : pas de quai lu", file=sys.stderr)
            continue
        if z["eau"] != b["partieEau"]:
            print(f"  {b['id']} {b['name']} : partieEau differente ({z['eau']} contre {b['partieEau']}), ignore",
                  file=sys.stderr)
            continue
        b["partieQuai"] = z["quai"]
        ecrits += 1
        print(f"  {b['id']} {b['name']} : quai {z['quai']} eau {z['eau']} emprise {b['size']}", file=sys.stderr)
    json.dump(cat, open(CATALOG, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
    open(CATALOG, "a", encoding="utf-8", newline="\n").write("\n")
    print(f"{ecrits}/{len(cotiers)} quais ecrits", file=sys.stderr)


if __name__ == "__main__":
    main()
