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
    building_upkeep = {} # defId -> entretien argent/min
    public_effects = {}  # defId -> functional effect guids (pour services)

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

        if tpl not in BUILDING_TEMPLATES:
            el.clear(); continue

        defId = f"g{guid}"
        icon = os.path.basename(t(el, "./Values/Standard/IconFilename") or "")
        if icon:
            icon_to_def.setdefault(icon, defId)

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
            cyc = fb.findtext("CycleTime")
            bprod[defId] = {
                "cycleTime": int(cyc) if cyc else None,
                "inputs": ins, "outputs": outs, "maint": maint,
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
                residences[tier] = {"defId": defId, "goods": goods, "services": services,
                                    "thresholds": thresholds}

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

    # ordre des tiers via PopulationGroup7 ? on trie par GUID stable, region déduite du nom
    def region_of(name):
        n = (name or "").lower()
        return "Roman" if "roman" in n else ("Celtic" if "celtic" in n else "?")

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
                    "weight": (nd or {}).get("weight", 1), "category": (nd or {}).get("category", "Public"),
                })
                for k, v in attrs.items():
                    per_house[k] += v
                capacity += attrs.get("Population", 0)
            for sneed in res["services"]:
                nd = needs.get(sneed)
                sdef = SERVICE_BUILDING_OVERRIDES.get(sneed) or (icon_to_def.get(nd["icon"]) if nd else None)
                attrs = nd["attrs"] if nd else {}
                services.append({
                    "need": sneed, "building": sdef,
                    "pop": attrs.get("Population", 0), "money": attrs.get("Money", 0),
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
            "capacityDefault": cap,
            "perHouse": dict(per_house),
            "goods": goods,
            "services": services,
            # seuils d'upgrade par catégorie (score SupplyWeight des besoins remplis
            # requis pour MONTER au tier suivant)
            "upgradeThresholds": (res or {}).get("thresholds", {}),
        })

    # région des bâtiments : réutilise le catalogue déjà généré (AssociatedRegions décodé)
    building_region = {}
    cat_path = os.path.join(HERE, "src", "data", "catalog.generated.json")
    if os.path.exists(cat_path):
        for b in json.load(open(cat_path, encoding="utf-8")):
            if b.get("region"):
                building_region[b["id"]] = b["region"]

    out = {
        "tiers": tiers,
        "producers": producers,
        "buildingProd": bprod,
        "buildingWorkforce": building_workforce,
        "buildingUpkeep": building_upkeep,
        "goodNames": products,
        "goodPrices": good_prices,
        "buildingRegion": building_region,
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
