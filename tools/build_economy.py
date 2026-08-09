"""
Extrait les données économiques d'Anno 117 pour le planificateur de population.

Mécanique :
- PopulationLevel (tier) : workforce (bien GUID) fourni, facteur pop->workforce.
- Residence : NeedsList -> besoins. Avec NeedConsumptionRate = bien consommé,
  sans taux = service (bâtiment d'influence requis dans le rayon).
- Need : NeedProduct = le bien réellement consommé ; icône -> bâtiment de service.
- Maintenance d'un bâtiment : un Item dont le Product est un bien-workforce = coût
  en main-d'œuvre de ce tier pour faire tourner le bâtiment.
- FactoryBase : entrées/sorties/temps de cycle (en GUID).

Sortie : src/data/economy.generated.json
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from game_defaults import CYCLE_TIME_DEFAULT

HERE = os.path.dirname(os.path.dirname(__file__))
ASSETS = os.path.join(HERE, ".gamedata", "assets_base.xml")
TEXTS = os.path.join(HERE, ".gamedata", "texts_french.xml")
OUT = os.path.join(HERE, "src", "data", "economy.generated.json")

BUILDING_TEMPLATES = {
    "Production", "Production Field", "Production Area", "Production Marsh",
    "Production Marsh Area", "Production Marsh Pasture", "SlotFactoryBuilding7",
    "PublicServiceBuilding", "MiniInstitutionBuilding", "CityInstitutionBuilding",
    "CityInstitutionBuilding_Marsh", "Monument", "Warehouse", "Warehouse_Marsh",
    "HarborWarehouse", "ResidenceBuilding",
}

CAP_DEFAULT = [10, 20, 30, 40, 50]  # capacité/maison par index de tier (éditable)

# Besoins-service sans match d'icône → bâtiment forcé. La CITERNE d'aqueduc (besoin
# des tiers 3-4) a l'icône générique de la catégorie aqueduc, jamais matchée :
# need 68747 (Latium) -> AqueductDistributor 19753 ; need 68748 (romano-celte) -> 29526.
SERVICE_BUILDING_OVERRIDES = {
    "68747": "g19753",
    "68748": "g29526",
    # Maison de jeu CELTIC (besoin 37176, icône celtic) : le bâtiment 37177 réutilise
    # l'icône ROMAINE → le match d'icône tombait sur la version romaine déjà prise.
    "37176": "g37177",
    # SANCTUAIRE (besoin 2753) : AUCUN OVERRIDE, et c'est le resultat d'une erreur corrigee.
    #
    # `g3615 Sanctuaire` avait ete pris pour un ARCHETYPE non constructible, et le besoin
    # detourne vers un autel de divinite 3x3. C'etait faux sur toute la ligne :
    #  - g3615 porte `<Constructable />` et figure au menu « Roman T2 Plebeians » ;
    #  - le besoin 2753 « Need Roman Public Sanctuary » declare Bonheur +1 / Foi +2, soit
    #    MOT POUR MOT l'effet de zone de g3615 — le match par icone etait juste ;
    #  - AUCUN besoin du jeu n'a pour icone un autel de divinite (recherche exhaustive sur les
    #    30 800 assets) : les autels ne remplissent aucun besoin. C'est aussi ce que dit
    #    GAME_MECHANICS.md §9 bis.2.
    #
    # L'override faisait donc remplir un besoin par un batiment qui n'en remplit aucun, et
    # creditait a chaque maison un Incendie +2 de SERVICE en plus de l'effet de zone de l'autel.
    #
    # Consequence, et elle est heureuse : l'autel n'a jamais eu a consommer le permis pour
    # satisfaire un besoin. Le permis achete un bonus PUR, que `pickPatron` place librement sur
    # l'attribut limitant — c'est le sens de la regle « un seul dieu par ile ».
    # COLISÉE : le match d'icône tombait sur la phase de chantier « fondations »
    # (36908, Monument, aucune portée). Le bâtiment FINAL est 3621 (MonumentEventBuilding,
    # street 250, eau 50u Mandatory) — cf. GAME_MECHANICS.md §9.
    "2783": "g3621",
}


def load_texts():
    txt = open(TEXTS, encoding="utf-8").read()
    d = {}
    for m in re.finditer(r"<LineId>(-?\d+)</LineId>\s*<Text>(.*?)</Text>", txt, re.S):
        d[m.group(1)] = m.group(2).strip()
    return d


def t(el, path):
    v = el.findtext(path)
    return v.strip() if v else None


def load_template_effect_ranges():
    """Rayons par defaut herites : nom de template -> (RadiusDistance, StreetDistance)."""
    out = {}
    path = os.path.join(HERE, ".gamedata", "templates.xml")
    if not os.path.exists(path):
        return out
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != "Template":
            continue
        name = el.findtext("Name")
        es = el.find(".//EffectSource")
        if name and es is not None:
            out[name] = (es.findtext("RadiusDistance"), es.findtext("StreetDistance"))
        el.clear()
    return out


def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def read_delta_items(node):
    """Items de `Distribution/Deltas` : quantite de main-d'oeuvre offerte, par difficulte."""
    if node is None:
        return []
    out = []
    for it in node.findall("Item"):
        amt = it.find("Amount")
        out.append({
            "idx": int(it.findtext("./VectorElement/InheritedIndex") or -1) if it.find("./VectorElement/InheritedIndex") is not None else None,
            "product": it.findtext("Product") or None,
            "plenty": _num(amt.findtext("Plenty")) if amt is not None else None,
            "medium": _num(amt.findtext("Medium")) if amt is not None else None,
            "spare": _num(amt.findtext("Spare")) if amt is not None else None,
        })
    return out


def read_maint_items(node):
    """Items de `Maintenance/Maintenances` : ce que le batiment PRELEVE."""
    if node is None:
        return []
    return [{
        "idx": int(it.findtext("./VectorElement/InheritedIndex") or -1) if it.find("./VectorElement/InheritedIndex") is not None else None,
        "product": it.findtext("Product") or None,
        "amount": _num(it.findtext("Amount")),
    } for it in node.findall("Item")]


def main():
    texts = load_texts()
    pop_levels = {}      # guid -> {name, region, workforce, factor}
    products = {}        # guid -> frName
    good_prices = {}     # productGuid -> BasePrice (valeur marchande de référence)
    needs = {}           # guid -> {product, icon}
    residences = {}      # tierGuid -> {defId, goods:[{need,product,rate}], services:[need]}
    producers = defaultdict(list)  # productGuid -> [defId]
    bprod = {}           # defId -> {cycleTime, inputs, outputs, maintenanceProducts:[{product,amount}], icon, public}
    icon_to_def = {}     # icon basename -> defId (bâtiments publics surtout)
    icon_to_defs = defaultdict(list)  # icon basename -> [defId], TOUS mondes confondus
    building_upkeep = {} # defId -> entretien argent/min
    public_effects = {}  # defId -> functional effect guids (pour services)
    fertilities = {}     # GUID Fertility/Deposit -> nom FR (saisie île + filtrage chaînes)
    # EFFETS DE ZONE (cf. GAME_MECHANICS.md §2) : un batiment porte des FunctionalEffects
    # -> asset Effect (EffectScope Radius ou StreetDistance) -> BuildingBuff dont
    # BuildingUpgrade/AdditionalAttributes donne les deltas d'attributs appliques aux
    # residences a portee. C'est la mecanique des « +1 Argent », « -2 Sante » autour des
    # ateliers et des mines. Trois tables intermediaires, resolues apres le parcours.
    fx_effects = {}      # GUID Effect -> {scope, buffs:[GUID]}
    fx_buffs = {}        # GUID BuildingBuff -> {attrs:{}, stackable}
    fx_owner = {}        # defId -> {fe:[GUID], template, radius, street}
    # RANG DE CITE (CityStatus) : palier atteint selon la POPULATION TOTALE de l'ile. Chaque
    # rang applique des deltas d'attributs a TOUTES les residences — malus croissants en
    # Bonheur/Sante/Incendie, bonus en Croyance/Connaissance/Prestige. L'echelle vit dans
    # EconomyFeature7/CityStatusFeature ; les effets, dans les assets CityStatus.
    cs_effects = {}      # GUID CityStatus -> {attrs}
    cs_ladder = {}       # region -> [{status, population}]
    wf_grants = {}       # GUID comptoir -> {deltas, maint, population}
    unique_types = {}    # UniqueType -> {scope, allowed?, permit?}
    derived = {}         # GUID sans Template -> surcharges + GUID du parent
    tpl_ranges = load_template_effect_ranges()

    for _, el in ET.iterparse(ASSETS, events=("end",)):
        if el.tag != "Asset":
            continue
        tpl = el.findtext("Template")
        vals = el.find("Values")
        guid = t(el, "./Values/Standard/GUID")
        oasis = t(el, "./Values/Text/OasisId")
        if not guid or vals is None:
            el.clear(); continue

        if tpl == "PopulationLevel":
            pop_levels[guid] = {
                "name": texts.get(oasis) or t(el, "./Values/Standard/Name"),
                "internal": t(el, "./Values/Standard/Name"),
                "workforce": t(el, "./Values/PopulationLevel/ConnectedWorkforce"),
                "factor": float(t(el, "./Values/PopulationLevel/PopulationToWorkforceFactor") or 0.5),
            }
            el.clear(); continue

        if tpl == "CityStatus":
            # TROIS variantes d'effets, une par CULTURE de population : Roman (Latium), Mixed
            # (romanisée d'Albion : Mercators, Nobles) et Regional (celtique native). Ne lire
            # que la romaine appliquait les malus du Latium aux paliers celtiques.
            variants = {}
            for tag, key in (("AttributeEffectsRoman", "Roman"),
                             ("AttributeEffectsMixed", "RomanCeltic"),
                             ("AttributeEffectsRegional", "Celtic")):
                eff = vals.find("./CityStatus/" + tag)
                attrs = {}
                if eff is not None:
                    for c in eff:
                        v = c.findtext("Value")
                        if v:
                            try:
                                attrs[c.tag] = float(v)
                            except ValueError:
                                pass
                variants[key] = attrs
            cs_effects[guid] = variants
            el.clear(); continue

        if tpl == "EconomyFeature":
            feat = vals.find("./EconomyFeature7/CityStatusFeature/Region")
            if feat is not None:
                for reg in feat:
                    steps = []
                    for it in reg.findall("./CityStatusList/Item"):
                        st = it.findtext("CityStatus")
                        pop = it.findtext("./RequiredPopulation/Item/PopulationCount")
                        if st:
                            steps.append({"status": st, "population": int(pop) if pop else 0})
                    if steps:
                        cs_ladder[reg.tag] = steps
            el.clear(); continue

        # HERITAGE D'ASSET. Un asset sans <Template> mais avec <BaseAssetGUID> herite de tout
        # son parent et ne surcharge que ce qu'il redeclare. Les trois comptoirs d'Albion
        # (7037/7038/7039) sont dans ce cas : ils heritent des comptoirs romains et se
        # contentent de remplacer le bien de main-d'oeuvre (2181 Liberti -> 2192 Tourbiers).
        # Filtrer sur <Template> les faisait disparaitre : Albion se retrouvait sans comptoir.
        if tpl is None and el.findtext("BaseAssetGUID"):
            derived[guid] = {
                "base": el.findtext("BaseAssetGUID"),
                "deltas": read_delta_items(vals.find("./Distribution/Deltas")),
                "maint": read_maint_items(vals.find("./Maintenance/Maintenances")),
                "population": t(el, "./Values/AttributeProvider/Population"),
            }
            el.clear(); continue

        if tpl == "UniqueBuildingConfig":
            # REGLES D'UNICITE, toutes reunies dans un seul asset (GUID 81160). Le plafond
            # ne porte pas sur un batiment mais sur un TYPE, et deux mecanismes coexistent :
            #   AllowedAmount  = plafond DUR, immuable (Monument01 et Headquarter : 1)
            #   RequiredPermit = chaque exemplaire consomme un PERMIS, etat de partie que le
            #                    joueur augmente par la recherche (Shrine : produit 93771)
            # VillaMilitiaAuxilia porte les deux : plafond de 2 ET consommation de permis.
            cfgs = vals.find("./UniqueBuildings/UniqueTypeConfigs")
            if cfgs is not None:
                for c in cfgs:
                    row = {"scope": c.findtext("UniqueScope")}
                    a, prm = c.findtext("AllowedAmount"), c.findtext("RequiredPermit")
                    if a:
                        row["allowed"] = int(a)
                    if prm:
                        row["permit"] = prm
                    unique_types[c.tag] = row
            el.clear(); continue

        if tpl == "HarborWarehouse":
            # MAIN-D'OEUVRE OFFERTE PAR LE COMPTOIR. `Distribution/Deltas` ajoute directement
            # au pool de main-d'oeuvre de l'ile — c'est la seule source qui ne vienne pas des
            # maisons, et elle suffit a faire tourner les premiers ateliers sur une ile neuve.
            #
            # L'Item du comptoir romain n'a PAS de <Product> : il herite de la valeur du
            # template, qu'on resout par <AttributeProvider><Population> (1499 = Liberti).
            # Le comptoir celtique 7037 herite de 3402 (BaseAssetGUID) et surcharge, lui,
            # <Product>2192</Product>. Les deux chemins doivent donc etre geres.
            #
            # Le comptoir CONSOMME aussi de la main-d'oeuvre a partir du niveau 2 : on stocke
            # le brut et le cout separement, le net n'est pas monotone en niveau.
            wf_grants[guid] = {
                "base": None,
                "deltas": read_delta_items(vals.find("./Distribution/Deltas")),
                "maint": read_maint_items(vals.find("./Maintenance/Maintenances")),
                "population": t(el, "./Values/AttributeProvider/Population"),
            }
            el.clear(); continue

        if tpl == "Effect":
            e = vals.find("Effect")
            if e is not None:
                fx_effects[guid] = {
                    "scope": t(el, "./Values/Effect/EffectScope"),
                    "buffs": [i.findtext("GUID") for i in e.findall("./Buffs/Item") if i.findtext("GUID")],
                }
            el.clear(); continue

        if tpl == "BuildingBuff":
            attrs = {}
            aa = vals.find("./BuildingUpgrade/AdditionalAttributes")
            if aa is not None:
                for c in aa:
                    v = c.findtext("./AmountOrPercent/Value")
                    if v:
                        try:
                            attrs[c.tag] = float(v)
                        except ValueError:
                            pass
            fx_buffs[guid] = {"attrs": attrs,
                              "stackable": t(el, "./Values/Buff/IsStackable") == "1"}
            el.clear(); continue

        if tpl == "Fertility":
            nm = texts.get(oasis) or t(el, "./Values/Standard/Name") or guid
            # nettoyage : "Fertility Roman Olives" -> "Olives" si pas de texte FR
            nm = re.sub(r"^(Fertility|Deposit)\s+(Roman|Celtic|Limited\s+Roman)?\s*", "", nm).strip() or nm
            fertilities[guid] = nm
            el.clear(); continue

        if tpl == "Product":
            products[guid] = texts.get(oasis) or t(el, "./Values/Standard/Name")
            bp = t(el, "./Values/Product/BasePrice") or t(el, ".//BasePrice")
            if bp:
                try:
                    good_prices[guid] = float(bp)
                except ValueError:
                    pass
            el.clear(); continue

        if tpl == "Need":
            na = el.find("./Values/Need/NeedAttributes")
            attrs = {}
            if na is not None:
                for c in na:
                    try:
                        attrs[c.tag] = float(c.findtext("Value") or 0)
                    except ValueError:
                        pass
            needs[guid] = {
                "product": t(el, "./Values/Need/NeedProduct"),
                "icon": os.path.basename(t(el, "./Values/Standard/IconFilename") or ""),
                "attrs": attrs,
                # mécanique d'UPGRADE (cf. GAME_MECHANICS.md §3) : chaque besoin REMPLI
                # ajoute SupplyWeight au score de sa catégorie ; sans NeedCategoryType
                # explicite = service Public.
                "weight": float(t(el, "./Values/Need/SupplyWeight") or 1),
                "category": t(el, "./Values/Need/NeedCategoryType") or "Public",
            }
            el.clear(); continue

        # EFFETS DE ZONE — releves AVANT le filtre de templates : la citerne d'aqueduc,
        # l'Amphitheatre et les jetees en portent aussi, et leurs templates ne figurent pas
        # dans BUILDING_TEMPLATES (qui ne sert qu'a l'economie de production).
        fe = [i.findtext("FunctionalEffect")
              for i in vals.findall("./Building/FunctionalEffects/Item")]
        fe = [x for x in fe if x]
        if fe:
            rad = t(el, "./Values/EffectSource/RadiusDistance")
            street = t(el, "./Values/EffectSource/StreetDistance")
            if not rad and tpl in tpl_ranges:
                rad, street = tpl_ranges[tpl]  # EffectSource vide = rayon herite du template
            fx_owner[f"g{guid}"] = {"fe": fe, "radius": rad, "street": street}

        if tpl not in BUILDING_TEMPLATES:
            el.clear(); continue

        defId = f"g{guid}"
        icon = os.path.basename(t(el, "./Values/Standard/IconFilename") or "")
        if icon:
            icon_to_def.setdefault(icon, defId)
            icon_to_defs[icon].append(defId)

        # entretien en argent (Product credits 1010017), par minute
        money = 0.0
        for it in vals.findall("./Maintenance/Maintenances/Item"):
            if it.findtext("Product") == "1010017":
                money += float(it.findtext("Amount") or 0)
        if money:
            building_upkeep[defId] = money

        # production
        fb = vals.find("FactoryBase")
        if fb is not None:
            outs = [{"good": it.findtext("Product"), "amount": float(it.findtext("Amount") or 1)}
                    for it in fb.findall("./FactoryOutputs/Item")]
            ins = [{"good": it.findtext("Product"), "amount": float(it.findtext("Amount") or 1)}
                   for it in fb.findall("./FactoryInputs/Item")]
            maint = [{"product": it.findtext("Product"), "amount": float(it.findtext("Amount") or 0)}
                     for it in vals.findall("./Maintenance/Maintenances/Item")]
            cyc = fb.findtext("CycleTime") or str(CYCLE_TIME_DEFAULT)
            # fertilité requise par ce producteur (GUID d'asset Fertility/Deposit,
            # sous Factory7) — le mode production avertit si l'île ne l'a pas
            fert = t(el, "./Values/Factory7/NeededFertility")
            bprod[defId] = {
                "cycleTime": int(cyc) if cyc else None,
                "inputs": ins, "outputs": outs, "maint": maint,
                **({"fertility": fert} if fert else {}),
            }
            for o in outs:
                if o["good"]:
                    producers[o["good"]].append(defId)

        # résidence
        if tpl == "ResidenceBuilding":
            tier = t(el, "./Values/Residence7/PopulationLevel")
            goods, services = [], []
            for it in vals.findall("./Residence7/NeedsList/Item"):
                need = it.findtext("Need")
                rate = it.findtext("NeedConsumptionRate")
                if rate:
                    goods.append({"need": need, "rate": float(rate)})
                else:
                    services.append(need)
            # seuils d'upgrade par catégorie (score SupplyWeight à atteindre)
            thresholds = {}
            th = vals.find("./Residence7/UpgradeThreshold")
            if th is not None:
                for c in th:
                    try:
                        thresholds[c.tag] = float(c.findtext("Value") or 0)
                    except ValueError:
                        pass
            if tier:
                # GRAPHE DE MONTEE. `Upgradable/PossibleUpgrades` declare vers quelle
                # residence celle-ci peut monter. C'est un ARBRE, pas une chaine : en Albion
                # les Tourbiers se hissent SOIT vers les Forgerons (lignee native) SOIT vers
                # les Mercators (romanisee). Sans cette arete, le code deduisait l'ordre de la
                # capacite et prenait le voisin de tableau pour le predecesseur.
                upg = [x for x in (it.findtext("UpgradeGUID")
                                   for it in el.findall("./Values/Upgradable/PossibleUpgrades/Item")) if x]
                residences[tier] = {"defId": defId, "goods": goods, "services": services,
                                    "thresholds": thresholds,
                                    "upgradesTo": [f"g{x}" for x in upg]}

        el.clear()

    # bien-workforce -> tier
    workforce_goods = {pl["workforce"]: g for g, pl in pop_levels.items() if pl["workforce"]}

    # coût main-d'œuvre par bâtiment (Maintenance dont Product = bien-workforce)
    building_workforce = {}
    for defId, p in bprod.items():
        wf = []
        for m in p.get("maint", []):
            if m["product"] in workforce_goods and m["amount"] > 0:
                wf.append({"tier": workforce_goods[m["product"]], "amount": m["amount"]})
        if wf:
            building_workforce[defId] = wf
        p.pop("maint", None)

    # CULTURE d'un palier, déduite du nom interne. L'ORDRE DES TESTS EST DÉCISIF :
    # « Population Level Roman Celtic 02 Merchants » contient « roman » ET « celtic ». Ce sont
    # les Mercators, population ROMANISÉE d'Albion (leurs services sont le Fanum et le Théâtre
    # bardique, bâtiments celtiques), pas un palier du Latium. Tester « roman » d'abord les
    # rangeait en Latium — c'était faux. Trois familles, qui correspondent exactement aux trois
    # variantes AttributeEffectsRoman / Mixed / Regional du rang de cité.
    def region_of(name):
        n = (name or "").lower()
        if "roman celtic" in n:
            return "RomanCeltic"
        if "celtic" in n:
            return "Celtic"
        if "roman" in n:
            return "Roman"
        return "?"

    # REGION DE CHAQUE BATIMENT, lue du catalogue deja genere. Chargee ICI et non plus apres
    # la boucle des paliers : la resolution des services en a besoin (cf. `service_def`).
    building_region = {}
    building_name = {}
    catalog_ids = set()
    cat_path = os.path.join(HERE, "src", "data", "catalog.generated.json")
    if os.path.exists(cat_path):
        for b in json.load(open(cat_path, encoding="utf-8")):
            catalog_ids.add(b["id"])
            building_name[b["id"]] = b.get("name")
            if b.get("region"):
                building_region[b["id"]] = b["region"]

    def world_of(reg):
        """Monde d'une culture : les romano-celtiques vivent en Albion."""
        return "Roman" if reg == "Roman" else "Celtic"

    def twin_in_world(def_id, want):
        """Jumeau du MEME NOM dans le monde voulu.

        Les deux mondes ont un Marche, un Temple, des Bains, un Grammaticus, un Theatre — memes
        noms, batiments distincts, et ICONES DIFFERENTES. Le match par icone ne trouvait donc
        que la version romaine, et la version celtique restait invisible. Le nom, lui, est
        commun : c'est le seul pont fiable entre les deux catalogues.
        """
        name = building_name.get(def_id)
        if not name:
            return None
        for other, r in building_region.items():
            if other != def_id and building_name.get(other) == name and world_of(r) == want:
                return other
        return None

    def service_def(need_guid, nd, reg):
        """Batiment qui remplit un besoin de SERVICE, POUR LE MONDE DU PALIER.

        Les besoins sont resolus par ICONE, et l'icone est commune aux deux mondes : le Marche
        romain et le Marche celtique la partagent, comme le Temple et le Fanum. La table
        `icon_to_def` n'en gardait qu'un — le premier vu, romain dans l'ordre de lecture. Les
        paliers CELTIQUES se retrouvaient donc avec un Marche et un Theatre ROMAINS parmi leurs
        services, non constructibles en jeu sur Albion. Detecte par l'invariant `monde-unique`,
        qui signalait dix batiments d'un autre monde sur celtic_island_small_06.

        On choisit desormais parmi TOUS les candidats celui du monde du palier ; a defaut un
        batiment sans region declaree ; a defaut l'ancien comportement.
        """
        want = world_of(reg)
        cands = icon_to_defs.get(nd["icon"]) if nd else None
        base = SERVICE_BUILDING_OVERRIDES.get(need_guid)
        if not base:
            for d in (cands or []):
                r = building_region.get(d)
                if r and world_of(r) == want:
                    return d
            for d in (cands or []):
                if not building_region.get(d):
                    return d
            base = icon_to_def.get(nd["icon"]) if nd else None
        if not base:
            return None
        # Le batiment retenu — override compris — peut etre du mauvais monde : on le remplace
        # par son jumeau de meme nom quand il en existe un.
        r = building_region.get(base)
        if r and world_of(r) != want:
            return twin_in_world(base, want) or base
        return base

    tiers = []
    # ordre Roman puis Celtic, par apparition
    ordered = sorted(pop_levels.items(), key=lambda kv: kv[0])
    region_index = defaultdict(int)
    for g, pl in ordered:
        reg = region_of(pl["internal"])
        res = residences.get(g)
        goods = []
        services = []
        per_house = defaultdict(float)  # somme des attributs accordés (maison pleine)
        capacity = 0.0
        if res:
            for gd in res["goods"]:
                nd = needs.get(gd["need"])
                prod = nd["product"] if nd else None
                attrs = nd["attrs"] if nd else {}
                goods.append({
                    "good": prod, "rate": gd["rate"], "needName": products.get(prod),
                    "pop": attrs.get("Population", 0), "money": attrs.get("Money", 0),
                    # attributs COMPLETS du besoin (Bonheur, Sante, Incendie, Croyance...) :
                    # indispensables au bilan par maison, ou seuls Population et Argent
                    # etaient jusqu'ici remontes.
                    "attrs": {k: v for k, v in attrs.items() if v},
                    "weight": (nd or {}).get("weight", 1), "category": (nd or {}).get("category", "Public"),
                })
                for k, v in attrs.items():
                    per_house[k] += v
                capacity += attrs.get("Population", 0)
            for sneed in res["services"]:
                nd = needs.get(sneed)
                sdef = service_def(sneed, nd, reg)
                attrs = nd["attrs"] if nd else {}
                services.append({
                    "need": sneed, "building": sdef,
                    "pop": attrs.get("Population", 0), "money": attrs.get("Money", 0),
                    "attrs": {k: v for k, v in attrs.items() if v},
                    "weight": (nd or {}).get("weight", 1), "category": (nd or {}).get("category", "Public"),
                })
                for k, v in attrs.items():
                    per_house[k] += v
                capacity += attrs.get("Population", 0)
        idx = region_index[reg]
        region_index[reg] += 1
        cap = int(round(capacity)) if capacity > 0 else CAP_DEFAULT[min(idx, len(CAP_DEFAULT) - 1)]
        tiers.append({
            "guid": g,
            "name": pl["name"],
            "region": reg,
            "workforce": pl["workforce"],
            "factor": pl["factor"],
            "residenceId": res["defId"] if res else None,
            "upgradesTo": res.get("upgradesTo", []) if res else [],
            "capacityDefault": cap,
            "perHouse": dict(per_house),
            "goods": goods,
            "services": services,
            # seuils d'upgrade par catégorie (score SupplyWeight des besoins remplis
            # requis pour MONTER au tier suivant)
            "upgradeThresholds": (res or {}).get("thresholds", {}),
        })

    # garde-fou : un override de service périmé (besoin OU bâtiment introuvable après un
    # patch du jeu) ferait disparaître un service d'un tier en silence → on le crie.
    for need_guid, def_id in SERVICE_BUILDING_OVERRIDES.items():
        if need_guid not in needs:
            print(f"  ! override perime : besoin {need_guid} introuvable (patch jeu ?)", file=sys.stderr)
        if catalog_ids and def_id not in catalog_ids:
            print(f"  ! override perime : batiment {def_id} absent du catalogue (patch jeu ?)", file=sys.stderr)

    # resolution des effets de zone : batiment -> {scope, range, attrs, stackable}
    building_effects = {}
    for def_id, own in fx_owner.items():
        attrs, stackable, scope = {}, False, None
        for eg in own["fe"]:
            eff = fx_effects.get(eg)
            if not eff:
                continue
            for bg in eff["buffs"]:
                bf = fx_buffs.get(bg)
                if not bf or not bf["attrs"]:
                    continue
                scope = eff["scope"]
                stackable = stackable or bf["stackable"]
                for k, v in bf["attrs"].items():
                    attrs[k] = attrs.get(k, 0) + v
        if not attrs or not scope:
            continue
        # Radius = distance EUCLIDIENNE (RadiusDistance) ; StreetDistance = le long des rues
        is_radius = scope == "Radius"
        rng = own["radius"] if is_radius else own["street"]
        if not rng:
            continue
        building_effects[def_id] = {
            "scope": "radius" if is_radius else "street",
            "range": int(rng),
            "attrs": attrs,
            "stackable": stackable,
        }

    # ═══ CE QUE LA MAISON GAGNE, C'EST CE QUE LE BATIMENT EMET ══════════════════════════
    #
    # Les attributs d'un besoin de service etaient lus sur le BESOIN. Pour tous les services
    # sauf un, c'est equivalent : un besoin, un batiment, memes attributs — un invariant du
    # projet l'exige d'ailleurs, faute de quoi le moteur double-compterait.
    #
    # Le SANCTUAIRE brise l'equivalence, et c'est ce qui a masque le bug d'archetype. Le
    # besoin 2753 declare `Bonheur+1 / Croyance+2` — c'est mot pour mot l'effet de `g3615`,
    # l'archetype 6x10 non constructible. Le match par icone tombait donc dessus, et
    # l'invariant se validait LUI-MEME. Les vrais sanctuaires sont les 3x3 de divinite, et
    # chaque dieu emet autre chose : Cernunnos Sante+1/Croyance+1, Vulcain Incendie+2,
    # Epona Population+1/Bonheur+1. Crediter les attributs du besoin reviendrait a promettre
    # l'effet d'un batiment que le joueur ne peut pas poser.
    #
    # Cette passe realigne donc les attributs du service sur l'effet du batiment retenu, et
    # reporte l'ecart sur `perHouse` et `capacityDefault`. No-op partout ailleurs.
    for tr in tiers:
        for sv in tr["services"]:
            b = sv.get("building")
            fx = building_effects.get(b) if b else None
            if not fx or not fx["attrs"]:
                continue
            old, new = sv["attrs"], {k: v for k, v in fx["attrs"].items() if v}
            if new == old:
                continue
            print("  ~ besoin %s aligne sur %s : %s -> %s" % (sv["need"], b, old, new),
                  file=sys.stderr)
            ph = dict(tr["perHouse"])
            for k, v in old.items():
                ph[k] = ph.get(k, 0) - v
            for k, v in new.items():
                ph[k] = ph.get(k, 0) + v
            tr["perHouse"] = {k: v for k, v in ph.items() if v}
            tr["capacityDefault"] += int(round(new.get("Population", 0) - old.get("Population", 0)))
            sv["attrs"] = new
            sv["pop"] = new.get("Population", 0)
            sv["money"] = new.get("Money", 0)

    # Les assets derives d'un comptoir rejoignent wf_grants, en heritant item par item.
    for g, d in derived.items():
        if d["base"] in wf_grants:
            wf_grants[g] = {**d, "base": d["base"]}

    # MAIN-D'OEUVRE OFFERTE PAR LE COMPTOIR, resolue :
    #   defId -> {bien -> {plenty, medium, spare, cost}}
    # Le bien est explicite quand l'asset le surcharge (comptoirs d'Albion), sinon deduit du
    # palier annonce par AttributeProvider/Population. `cost` est le prelevement du comptoir
    # sur ce meme bien : le NET n'est PAS monotone en niveau (niveau 1 offre 25 sans rien
    # couter, niveau 2 offre 35 mais en consomme 8, niveau 3 offre 50 et en consomme 12).
    def grant_items(g, key, depth=0):
        """Items d'un asset, fusionnes avec ceux de son parent via InheritedIndex."""
        row = wf_grants.get(g)
        if row is None or depth > 8:
            return []
        parent = grant_items(row["base"], key, depth + 1) if row.get("base") else []
        out = [dict(x) for x in parent]
        for it in row[key]:
            i = it.get("idx")
            if i is not None and i < len(out):
                out[i] = {**out[i], **{k: v for k, v in it.items() if v is not None and k != "idx"}}
            else:
                out.append(it)
        return out

    workforce_grants = {}
    for g, row in wf_grants.items():
        pop_guid = row.get("population")
        if not pop_guid and row.get("base"):
            pop_guid = (wf_grants.get(row["base"]) or {}).get("population")
        default_good = (pop_levels.get(pop_guid or "") or {}).get("workforce")
        per_good = {}
        for it in grant_items(g, "deltas"):
            good = it.get("product") or default_good
            if not good:
                continue
            slot = per_good.setdefault(good, {})
            for lvl in ("plenty", "medium", "spare"):
                if it.get(lvl) is not None:
                    slot[lvl] = slot.get(lvl, 0.0) + it[lvl]
        for it in grant_items(g, "maint"):
            good = it.get("product")
            if good in per_good and it.get("amount"):
                per_good[good]["cost"] = per_good[good].get("cost", 0.0) + it["amount"]
        per_good = {k: v for k, v in per_good.items() if any(x in v for x in ("plenty", "medium", "spare"))}
        if per_good:
            workforce_grants[f"g{g}"] = per_good

    # Echelle des rangs de cite, resolue et croissante. `cs_ladder` est indexe par MONDE
    # (les seuils de population), tandis que les effets dependent de la CULTURE du palier :
    # une meme ile en Albion applique la variante Mixed a ses Mercators et Regional a ses
    # Forgerons. On expose donc les trois variantes par marche.
    city_status = {}
    for world, steps in cs_ladder.items():
        rows = [{"population": st["population"],
                 "attrs": cs_effects.get(st["status"], {})}
                for st in steps]
        rows.sort(key=lambda r: r["population"])
        city_status[world] = rows

    out = {
        "tiers": tiers,
        "buildingEffects": building_effects,
        "cityStatus": city_status,
        "producers": producers,
        "buildingProd": bprod,
        "buildingWorkforce": building_workforce,
        "workforceGrants": workforce_grants,
        "uniqueTypes": unique_types,
        "buildingUpkeep": building_upkeep,
        "goodNames": products,
        "goodPrices": good_prices,
        "buildingRegion": building_region,
        "fertilities": fertilities,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    # résumé
    print(f"tiers: {len(tiers)}", file=sys.stderr)
    for ti in tiers:
        print(f"  {ti['region']:6} {ti['name']:30} cap={ti['capacityDefault']:>3} "
              f"goods={len(ti['goods'])} services={len(ti['services'])} f={ti['factor']} "
              f"perHouse={ {k: round(v) for k,v in ti['perHouse'].items()} }",
              file=sys.stderr)
    print(f"producers:{len(producers)} buildingProd:{len(bprod)} workforceBuildings:{len(building_workforce)} "
          f"goodPrices:{len(good_prices)} buildingRegion:{len(building_region)}",
          file=sys.stderr)
    print(f"OK -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
