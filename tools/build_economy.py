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
    needs = {}           # guid -> {product, icon}
    residences = {}      # tierGuid -> {defId, goods:[{need,product,rate}], services:[need]}
    producers = defaultdict(list)  # productGuid -> [defId]
    bprod = {}           # defId -> {cycleTime, inputs, outputs, maintenanceProducts:[{product,amount}], icon, public}
    icon_to_def = {}     # icon basename -> defId (bâtiments publics surtout)
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
            el.clear(); continue

        if tpl == "Need":
            needs[guid] = {
                "product": t(el, "./Values/Need/NeedProduct"),
                "icon": os.path.basename(t(el, "./Values/Standard/IconFilename") or ""),
            }
            el.clear(); continue

        if tpl not in BUILDING_TEMPLATES:
            el.clear(); continue

        defId = f"g{guid}"
        icon = os.path.basename(t(el, "./Values/Standard/IconFilename") or "")
        if icon:
            icon_to_def.setdefault(icon, defId)

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
            if tier:
                residences[tier] = {"defId": defId, "goods": goods, "services": services}

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
        if res:
            for gd in res["goods"]:
                nd = needs.get(gd["need"])
                prod = nd["product"] if nd else None
                goods.append({"good": prod, "rate": gd["rate"], "needName": products.get(prod)})
            for sneed in res["services"]:
                nd = needs.get(sneed)
                sdef = icon_to_def.get(nd["icon"]) if nd else None
                services.append({"need": sneed, "building": sdef})
        idx = region_index[reg]
        region_index[reg] += 1
        tiers.append({
            "guid": g,
            "name": pl["name"],
            "region": reg,
            "workforce": pl["workforce"],
            "factor": pl["factor"],
            "residenceId": res["defId"] if res else None,
            "capacityDefault": CAP_DEFAULT[min(idx, len(CAP_DEFAULT) - 1)],
            "goods": goods,
            "services": services,
        })

    out = {
        "tiers": tiers,
        "producers": producers,
        "buildingProd": bprod,
        "buildingWorkforce": building_workforce,
        "goodNames": products,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    # résumé
    print(f"tiers: {len(tiers)}", file=sys.stderr)
    for ti in tiers:
        print(f"  {ti['region']:6} {ti['name']:30} res={ti['residenceId']} "
              f"goods={len(ti['goods'])} services={len(ti['services'])} wf={ti['workforce']} f={ti['factor']}",
              file=sys.stderr)
    print(f"producers:{len(producers)} buildingProd:{len(bprod)} workforceBuildings:{len(building_workforce)}",
          file=sys.stderr)
    print(f"OK -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
