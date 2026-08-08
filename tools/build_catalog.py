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
from game_defaults import CYCLE_TIME_DEFAULT

GAME = os.environ.get("ANNO_GAME_DIR", r"F:\Anno 117 - Pax Romana\maindata")
assert os.path.isdir(GAME), f"Repertoire jeu introuvable : {GAME!r}. Definir ANNO_GAME_DIR."
HERE = os.path.dirname(os.path.dirname(__file__))
ASSETS = os.path.join(HERE, ".gamedata", "assets_base.xml")
TEXTS = os.path.join(HERE, ".gamedata", "texts_french.xml")
TEMPLATES = os.path.join(HERE, ".gamedata", "templates.xml")
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
    # citerne d'aqueduc = service public (besoin 68747/68748 des tiers 3-4) ; la
    # source reste utile au catalogue (slot montagne, posée à la main)
    "AqueductDistributor": "public",
    "AqueductProducer": "public",
    "MiniInstitutionBuilding": "public",
    "CityInstitutionBuilding": "public",
    "CityInstitutionBuilding_Marsh": "public",
    "Monument": "public",
    # Colisée FINAL (3621, street 250, eau 50u Mandatory) — les assets Monument
    # ci-dessus ne sont que les PHASES de chantier (fondations/murs/arène)
    "MonumentEventBuilding": "public",
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


def load_template_effects():
    """Défauts hérités par template : nom -> {range, street} (EffectSource du template)."""
    eff = {}
    if not os.path.exists(TEMPLATES):
        print("  (templates.xml absent : pas d'héritage de rayon)", file=sys.stderr)
        return eff
    for _, el in ET.iterparse(TEMPLATES, events=("end",)):
        if el.tag != "Template":
            continue
        name = el.findtext("Name")
        es = None
        for node in el.iter():
            if node.tag == "EffectSource":
                es = node
                break
        if name and es is not None:
            rd = (es.findtext("RadiusDistance") or "").strip()
            sd = (es.findtext("StreetDistance") or "").strip()
            if rd:
                eff[name] = {"range": int(rd), "street": int(sd) if sd else int(rd)}
        el.clear()
    print(f"  defauts rayon par template : {len(eff)}", file=sys.stderr)
    return eff


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


def collect_buildings(texts, template_effects):
    buildings = []
    derived = []        # assets sans Template, resolus apres le parcours
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
        # HERITAGE D'ASSET : un asset sans <Template> mais avec <BaseAssetGUID> herite de son
        # parent et ne redeclare que ses differences. Les trois comptoirs d'Albion
        # (7037/7038/7039) sont exactement dans ce cas. Filtrer sur <Template> les faisait
        # disparaitre du catalogue : `pickKontorDef` posait alors un comptoir ROMAIN sur les
        # iles celtiques, faute d'en trouver un autre.
        if tpl is None and el.findtext("BaseAssetGUID"):
            g = text_of(el, "./Values/Standard/GUID")
            if g:
                derived.append({
                    "guid": g,
                    "base": el.findtext("BaseAssetGUID"),
                    "nameInternal": text_of(el, "./Values/Standard/Name"),
                    "oasis": text_of(el, "./Values/Text/OasisId"),
                    "region": text_of(el, "./Values/Building/AssociatedRegions"),
                    "icon": text_of(el, "./Values/Standard/IconFilename"),
                })
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

        # Placement terrain : eau/côte si TerrainType marin ou AllowWaterPlacement.
        terrain = text_of(el, "./Values/Building/TerrainType")
        # `elem or fallback` est un PIEGE sur ElementTree : la valeur de verite d'un element
        # est celle de sa liste d'enfants. Un <Building> present mais VIDE valait donc False,
        # et la recherche repartait de `values` — un noeud different, aux enfants differents.
        # Le placement eau/cote se decidait ainsi sur le mauvais sous-arbre.
        bnode = values.find("Building")
        allow_water = has_node(bnode if bnode is not None else values, "AllowWaterPlacement")
        is_water = (terrain in ("Water_Including_Coast", "Coast", "Water", "Terrain_And_Water")) or allow_water
        placement = "water" if is_water else "land"

        # Besoin de route : StreetActivation (services) OU LogisticNode (transport des
        # biens vers l'entrepôt — tous les bâtiments de production). Les bâtiments d'eau
        # se relient par le port, pas par une route terrestre.
        needs_road = (has_node(values, "StreetActivation") or has_node(values, "LogisticNode")) and not is_water

        # Rayon : valeur de l'asset, sinon défaut HÉRITÉ du template (EffectSource vide
        # dans l'asset = ex. Taverne, Grammaticus → 22/26 via PublicServiceBuilding).
        radius = None
        rd = text_of(el, "./Values/EffectSource/RadiusDistance")
        sd = text_of(el, "./Values/EffectSource/StreetDistance")
        if not rd and tpl in template_effects:
            rd = str(template_effects[tpl]["range"])
            sd = sd or str(template_effects[tpl]["street"])
        if rd:
            radius = {"range": int(rd), "streetRange": int(sd) if sd else int(rd)}

        # Champ / module (fermes)
        field = None
        limit = text_of(el, "./Values/ModuleOwner/ModuleLimits/Main/Limit")
        if limit:
            field = {"tiles": int(limit)}

        # Aire libre requise (bûcheron/ruches/marais) : productivité ∝ cases libres
        # dans InfluenceRadius (cf. GAME_MECHANICS.md §5) — ne pas enclaver
        free_area = None
        fa = values.find(".//FreeAreaProductivity")
        if fa is not None and fa.findtext("NeededArea"):
            free_area = {
                "radius": int(fa.findtext("InfluenceRadius") or 8),
                "area": int(fa.findtext("NeededArea")),
            }

        # Production
        production = None
        fb = values.find("FactoryBase")
        if fb is not None:
            outs, ins = [], []
            for it in fb.findall("./FactoryOutputs/Item"):
                outs.append({"product": it.findtext("Product"), "amount": float(it.findtext("Amount") or 1)})
            for it in fb.findall("./FactoryInputs/Item"):
                ins.append({"product": it.findtext("Product"), "amount": float(it.findtext("Amount") or 1)})
            cycle = fb.findtext("CycleTime") or str(CYCLE_TIME_DEFAULT)
            if outs or ins:
                production = {
                    "cycleTime": int(cycle) if cycle else None,
                    "outputs": outs,
                    "inputs": ins,
                }

        # Portée transporteur (distance-rue prod <-> entrepôt, défaut moteur 30)
        mtr = text_of(el, "./Values/FactoryBase/MaxTransporterRange")

        # Type d'EMPLACEMENT requis : `Factory7/RawResourceType` vaut Mountain ou River.
        # C'est la seule donnée qui relie un batiment a un slot du terrain (mines et
        # carrieres sur Mountain, argile / esturgeons / moulins sur River). Un batiment
        # sans cette valeur se pose librement, meme si son template est SlotFactoryBuilding7.
        raw_res = text_of(el, "./Values/Factory7/RawResourceType")
        slot_type = raw_res.lower() if raw_res else None

        # BuildingUnique AVEC enfant Uniques = contrainte d'unicité (Colisée…) ; le tag
        # vide (entrepôts…) n'en est pas une.
        #
        # Le TYPE compte autant que le drapeau : plusieurs bâtiments partagent un même
        # `UniqueType`, et c'est le TOTAL par type qui est plafonné, pas chaque bâtiment.
        # Les 16 autels de dieux (8 divinités x 2 régions) portent tous UniqueType=Shrine
        # avec UniqueScope=Area : le quota est commun A TOUTE L'ÎLE, tous dieux confondus.
        bu = values.find("BuildingUnique")
        unique = bu is not None and len(bu) > 0
        uniq_types = [x.text for x in el.findall("./Values/BuildingUnique/Uniques/Item/UniqueType") if x.text]
        unique_type = uniq_types[0] if uniq_types else None

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
            "placement": placement,
            "radius": radius,
            "field": field,
            "freeArea": free_area,
            "unique": unique,
            "uniqueType": unique_type,
            "production": production,
            "transporterRange": int(mtr) if mtr else None,
            "slotType": slot_type,
        })
        el.clear()
    # Resolution de l'heritage : on clone l'entree du parent et on n'ecrase que ce que
    # l'asset derive redeclare. Le parent peut lui-meme etre derive, d'ou la boucle.
    by_guid = {b["guid"]: b for b in buildings}
    for _ in range(4):
        added = 0
        for d in derived:
            if d["guid"] in by_guid:
                continue
            parent = by_guid.get(d["base"])
            if not parent:
                continue
            row = dict(parent)
            row["guid"] = d["guid"]
            for k in ("nameInternal", "oasis", "region", "icon"):
                if d.get(k):
                    row[k] = d[k]
            row["nameFr"] = texts.get(row["oasis"]) if row.get("oasis") else None
            buildings.append(row)
            by_guid[row["guid"]] = row
            added += 1
        if not added:
            break
    print(f"  {len(buildings)} batiments ({len(by_guid) - len(buildings) + sum(1 for d in derived if d['guid'] in by_guid)} herites), "
          f"{len(product_oasis)} produits", file=sys.stderr)
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
    # BuildBlocker = VRAIE grille de pose (polygone de coins en tuiles) → span min..max.
    # (BoundingBox/Extents = demi-taille de l'AABB du MESH visuel, toit/debord inclus →
    #  sur-dimensionne ~74% des batiments de +1 tuile/axe. cf. audit 2026.)
    bb = root.find("./BuildBlocker")
    if bb is not None:
        xs = [float(p.findtext("xf") or 0) for p in bb.findall("./Position")]
        zs = [float(p.findtext("zf") or 0) for p in bb.findall("./Position")]
        if xs and zs:
            w = max(1, round(max(xs) - min(xs)))
            h = max(1, round(max(zs) - min(zs)))
            return {"w": w, "h": h}
    # repli : Extents (demi-taille du mesh, ×2) si pas de BuildBlocker
    ext = root.find("./BoundingBox/Extents")
    if ext is None:
        return None
    xf = float(ext.findtext("xf") or 0)
    zf = float(ext.findtext("zf") or 0)
    return {"w": max(1, round(xf * 2)), "h": max(1, round(zf * 2))}


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
    guessed = []
    for b in buildings:
        # REPLI DE TAILLE. `resolve_sizes` abandonne en silence dans quatre cas — pas de `cfg`,
        # `.ifo` introuvable dans les archives, extraction en echec, parsing nul — et le
        # batiment gardait alors 3x3 sans que rien ne le distingue d'un vrai 3x3. Le
        # planificateur le posait donc avec une EMPRISE FAUSSE, invisible a la relecture comme
        # a l'execution. On marque desormais l'entree, et on crie la liste des batiments
        # POSABLES concernes — un ornement mal dimensionne ne gene personne, un service si.
        size = b.get("size")
        if not size:
            size = {"w": 3, "h": 3}
            guessed.append(b)
        name = b.get("nameFr") or b.get("nameInternal") or f"GUID {b['guid']}"
        entry = {
            "id": f"g{b['guid']}",
            **({"sizeGuessed": True} if not b.get("size") else {}),
            "guid": int(b["guid"]),
            "name": name,
            "nameInternal": b.get("nameInternal"),
            "template": b.get("template"),
            "category": b["category"],
            "region": b.get("region"),
            "size": size,
            "rotatable": True,
            "needsRoad": bool(b.get("needsRoad")),
            "color": CATEGORY_COLOR.get(b["category"], "#8d6e63"),
        }
        if b.get("placement") == "water":
            entry["placement"] = "water"  # se pose sur l'eau/la côte (port, pêcherie…)
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
        if b.get("freeArea"):
            entry["freeArea"] = b["freeArea"]
        if b.get("unique"):
            entry["unique"] = True
            # Le TYPE d'unicite : plusieurs batiments le partagent, et c'est le TOTAL par
            # type qui est plafonne sur l'ile (UniqueScope=Area).
            if b.get("uniqueType"):
                entry["uniqueType"] = b["uniqueType"]
        if b.get("slotType"):
            entry["slotType"] = b["slotType"]  # "mountain" | "river" : emplacement requis
        if b.get("production"):
            p = b["production"]
            entry["production"] = {
                "cycleTime": p["cycleTime"],
                "outputs": [{"good": product_name.get(o["product"], o["product"]), "amount": o["amount"]} for o in p["outputs"]],
                "inputs": [{"good": product_name.get(i["product"], i["product"]), "amount": i["amount"]} for i in p["inputs"]],
            }
            # portée transporteur : valeur BRUTE seulement — le défaut moteur (30)
            # vit à UN seul étage, côté runtime (prodPlan DEFAULT_RANGE)
            if b.get("transporterRange"):
                entry["transporterRange"] = b["transporterRange"]
        cat.append(entry)
    # tri : par categorie puis nom
    cat.sort(key=lambda e: (e["category"], e["name"]))
    if guessed:
        ornament = {"OrnamentalBuilding", "SimpleOrnamentalBuilding", "CultureBuilding"}
        placeable = [g for g in guessed if (g.get("template") or "") not in ornament]
        print(f"  ⚠ tailles NON resolues : {len(guessed)} batiment(s), dont {len(placeable)} posable(s)",
              file=sys.stderr)
        for g in placeable[:15]:
            print(f"      {g.get('nameFr') or g.get('nameInternal')} (g{g['guid']}, {g.get('template')})",
                  file=sys.stderr)
    return cat


def main():
    texts = load_texts()
    template_effects = load_template_effects()
    buildings, product_oasis = collect_buildings(texts, template_effects)
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
