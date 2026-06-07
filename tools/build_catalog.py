"""
Pipeline complet : assets.xml (+ textes FR + .ifo) -> catalog.json pour l'app.

Etapes :
1. Charge texts_french.xml -> dict OasisId(LineId) -> texte FR.
2. Parcourt assets.xml : produits (pour nommer entrees/sorties) + batiments placables.
3. Resout la taille via le .ifo (BoundingBox/Extents x2) extrait des archives graphics.
4. Ecrit src/data/catalog.generated.json (+ .gamedata/catalog.raw.json).

Prerequis : .gamedata/assets_base.xml et .gamedata/texts_french.xml deja extraits.
Lance :  python tools/build_catalog.py
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
import rda_extract as rda

GAME = r"F:\Anno 117 - Pax Romana\maindata"
HERE = os.path.dirname(os.path.dirname(__file__))
ASSETS = os.path.join(HERE, ".gamedata", "assets_base.xml")
TEXTS = os.path.join(HERE, ".gamedata", "texts_french.xml")
OUT_APP = os.path.join(HERE, "src", "data", "catalog.generated.json")
OUT_RAW = os.path.join(HERE, ".gamedata", "catalog.raw.json")

# Archives graphics a indexer (ordre de priorite pour trouver les .ifo).
GRAPHICS = [
    "graphics_roman.rda",
    "graphics_celtic.rda",
    "graphics_roman_celtic.rda",
    "graphics_library.rda",
    "graphics_misc.rda",
    "dlc01_graphics.rda",
    "cdlc01_graphics.rda",
]

# Templates de batiments placables -> categorie app.
TEMPLATE_CATEGORY = {
    "Production": "production",
    "Production Field": "production",
    "Production Area": "production",
    "Production Marsh": "production",
    "Production Marsh Area": "production",
    "Production Marsh Pasture": "production",
    "SlotFactoryBuilding7": "production",
    "ProductionModuleSilo": "production",
    "PublicServiceBuilding": "public",
    "MiniInstitutionBuilding": "public",
    "CityInstitutionBuilding": "public",
    "CityInstitutionBuilding_Marsh": "public",
    "Monument": "public",
    "Warehouse": "public",
    "Warehouse_Marsh": "public",
    "HarborWarehouse": "public",
    "TradeBuilding": "public",
    "RecruitmentBuilding": "militaire",
    "ResidenceBuilding": "residentiel",
    "OrnamentalBuilding": "ornement",
    "SimpleBuilding": "ornement",
}

# Comptoirs / entrepôts : racine du réseau de routes (le réseau doit y être relié).
ROOT_TEMPLATES = {"Warehouse", "Warehouse_Marsh", "HarborWarehouse", "TradeBuilding", "HarborDepot"}

CATEGORY_COLOR = {
    "production": "#c9a227",
    "public": "#7cb342",
    "residentiel": "#6d9dc5",
    "ornement": "#9c8cb5",
    "militaire": "#c0564b",
}


def load_texts():
    print("Chargement textes FR...", file=sys.stderr)
    txt = open(TEXTS, encoding="utf-8").read()
    d = {}
    for m in re.finditer(r"<LineId>(-?\d+)</LineId>\s*<Text>(.*?)</Text>", txt, re.S):
        d[m.group(1)] = m.group(2).strip()
    print(f"  {len(d)} textes", file=sys.stderr)
    return d


def text_of(el, path):
    v = el.findtext(path)
    return v.strip() if v else None


def slug(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def first_cfg(asset):
    return text_of(asset, "./Values/Object/Variations/Item/Filename")


def has_node(values, tag):
    return values.find(f"./{tag}") is not None


def parse_products(root_iter_path):
    """guid -> nom FR (pour entrees/sorties)."""
    products = {}
    for _, el in ET.iterparse(root_iter_path, events=("end",)):
        if el.tag == "Asset":
            if el.findtext("Template") == "Product":
                guid = text_of(el, "./Values/Standard/GUID")
                oasis = text_of(el, "./Values/Text/OasisId")
                products[guid] = oasis  # resolu en texte plus tard
            el.clear()
    return products


def collect_buildings(texts):
    buildings = []
    product_oasis = {}  # guid -> oasisId
    print("Parcours assets.xml...", file=sys.stderr)
    for _, el in ET.iterparse(ASSETS, events=("end",)):
        if el.tag != "Asset":
            continue
        tpl = el.findtext("Template")
        if tpl == "Product":
            guid = text_of(el, "./Values/Standard/GUID")
            product_oasis[guid] = text_of(el, "./Values/Text/OasisId")
            el.clear()
            continue
        if tpl not in TEMPLATE_CATEGORY:
            el.clear()
            continue
        values = el.find("Values")
        if values is None:
            el.clear()
            continue
        guid = text_of(el, "./Values/Standard/GUID")
        name_int = text_of(el, "./Values/Standard/Name")
        oasis = text_of(el, "./Values/Text/OasisId")
        icon = text_of(el, "./Values/Standard/IconFilename")
        region = text_of(el, "./Values/Building/AssociatedRegions")
        cfg = first_cfg(el)

        needs_road = has_node(values, "StreetActivation")

        radius = None
        rd = text_of(el, "./Values/EffectSource/RadiusDistance")
        if rd:
            radius = {
                "range": int(rd),
                "streetRange": int(text_of(el, "./Values/EffectSource/StreetDistance") or rd),
            }

        # Champ / module (fermes)
        field = None
        limit = text_of(el, "./Values/ModuleOwner/ModuleLimits/Main/Limit")
        if limit:
            field = {"tiles": int(limit)}

        # Production
        production = None
        fb = values.find("FactoryBase")
        if fb is not None:
            outs, ins = [], []
            for it in fb.findall("./FactoryOutputs/Item"):
                outs.append({"product": it.findtext("Product"), "amount": float(it.findtext("Amount") or 1)})
            for it in fb.findall("./FactoryInputs/Item"):
                ins.append({"product": it.findtext("Product"), "amount": float(it.findtext("Amount") or 1)})
            cycle = fb.findtext("CycleTime")
            if outs or ins:
                production = {
                    "cycleTime": int(cycle) if cycle else None,
                    "outputs": outs,
                    "inputs": ins,
                }

        buildings.append({
            "guid": guid,
            "template": tpl,
            "category": TEMPLATE_CATEGORY[tpl],
            "nameInternal": name_int,
            "oasis": oasis,
            "nameFr": texts.get(oasis) if oasis else None,
            "region": region,
            "icon": icon,
            "cfg": cfg,
            "needsRoad": needs_road,
            "radius": radius,
            "field": field,
            "production": production,
        })
        el.clear()
    print(f"  {len(buildings)} batiments, {len(product_oasis)} produits", file=sys.stderr)
    return buildings, product_oasis


class ArchiveIndex:
    """Index paresseux multi-archives pour retrouver les .ifo."""

    def __init__(self, archives):
        self.archives = archives
        self.handles = []
        self.maps = []
        self.loaded = 0

    def _load_next(self):
        if self.loaded >= len(self.archives):
            return False
        name = self.archives[self.loaded]
        path = os.path.join(GAME, name)
        self.loaded += 1
        if not os.path.exists(path):
            return True
        print(f"  index {name}...", file=sys.stderr)
        fh = open(path, "rb")
        files = rda.read_index(fh)
        m = {f.path.replace("\\", "/").lower(): f for f in files}
        self.handles.append(fh)
        self.maps.append((fh, m))
        return True

    def find(self, internal_path):
        key = internal_path.replace("\\", "/").lower()
        while True:
            for fh, m in self.maps:
                f = m.get(key)
                if f:
                    return fh, f
            if not self._load_next():
                return None, None


def parse_ifo_size(data):
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        # certains .ifo ont des entites/encodage : tente latin-1
        try:
            root = ET.fromstring(data.decode("latin-1"))
        except Exception:
            return None
    bb = root.find("./BoundingBox")
    if bb is None:
        return None
    ext = bb.find("./Extents")
    if ext is None:
        return None
    xf = float(ext.findtext("xf") or 0)
    zf = float(ext.findtext("zf") or 0)
    w = max(1, round(xf * 2))
    h = max(1, round(zf * 2))
    return {"w": w, "h": h}


def resolve_sizes(buildings):
    idx = ArchiveIndex(GRAPHICS)
    ok = 0
    for b in buildings:
        cfg = b.get("cfg")
        if not cfg:
            continue
        ifo = re.sub(r"\.cfg$", ".ifo", cfg)
        fh, f = idx.find(ifo)
        if not f:
            continue
        try:
            data = rda.extract_data(fh, f)
        except Exception:
            continue
        size = parse_ifo_size(data)
        if size:
            b["size"] = size
            ok += 1
    print(f"  tailles resolues : {ok}/{len(buildings)}", file=sys.stderr)


def to_app_catalog(buildings, product_name):
    cat = []
    for b in buildings:
        size = b.get("size") or {"w": 3, "h": 3}
        name = b.get("nameFr") or b.get("nameInternal") or f"GUID {b['guid']}"
        entry = {
            "id": f"g{b['guid']}",
            "guid": int(b["guid"]),
            "name": name,
            "nameInternal": b.get("nameInternal"),
            "category": b["category"],
            "region": b.get("region"),
            "size": size,
            "rotatable": True,
            "needsRoad": bool(b.get("needsRoad")),
            "color": CATEGORY_COLOR.get(b["category"], "#8d6e63"),
        }
        if b.get("template") in ROOT_TEMPLATES:
            entry["roadRoot"] = True  # comptoir/entrepôt = racine du réseau de routes
        if b.get("icon"):
            entry["icon"] = "icons/" + os.path.basename(b["icon"])
        if b.get("radius"):
            entry["radius"] = {"kind": "service", "range": b["radius"]["range"]}
            entry["streetRange"] = b["radius"]["streetRange"]
        if b.get("field"):
            # type de champ = produit principal de la ferme
            ft = None
            if b.get("production") and b["production"]["outputs"]:
                ft = product_name.get(b["production"]["outputs"][0]["product"])
            entry["field"] = {"tiles": b["field"]["tiles"], "fieldType": slug(ft) or "field"}
        if b.get("production"):
            p = b["production"]
            entry["production"] = {
                "cycleTime": p["cycleTime"],
                "outputs": [{"good": product_name.get(o["product"], o["product"]), "amount": o["amount"]} for o in p["outputs"]],
                "inputs": [{"good": product_name.get(i["product"], i["product"]), "amount": i["amount"]} for i in p["inputs"]],
            }
        cat.append(entry)
    # tri : par categorie puis nom
    cat.sort(key=lambda e: (e["category"], e["name"]))
    return cat


def main():
    texts = load_texts()
    buildings, product_oasis = collect_buildings(texts)
    product_name = {g: (texts.get(o) if o else None) for g, o in product_oasis.items()}
    resolve_sizes(buildings)
    cat = to_app_catalog(buildings, product_name)

    os.makedirs(os.path.dirname(OUT_APP), exist_ok=True)
    json.dump(cat, open(OUT_APP, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(buildings, open(OUT_RAW, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"OK -> {OUT_APP} ({len(cat)} entrees)", file=sys.stderr)

    # petit resume
    from collections import Counter
    c = Counter(e["category"] for e in cat)
    print("Par categorie :", dict(c), file=sys.stderr)
    sized = sum(1 for e in cat if e["size"] != {"w": 3, "h": 3})
    print(f"Avec taille resolue (non defaut) : {sized}", file=sys.stderr)


if __name__ == "__main__":
    main()
