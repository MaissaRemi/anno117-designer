"""Campagne de recherche mécaniques (phase A) : dumps JSON multi-requêtes sur
assets_base.xml. Sorties dans .gamedata/research/*.json (gitignoré).

Lance : python tools/_dump_research.py
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AB = os.path.join(HERE, ".gamedata", "assets_base.xml")
OUT = os.path.join(HERE, ".gamedata", "research")
os.makedirs(OUT, exist_ok=True)


def txt(el, path):
    v = el.findtext(path)
    return v.strip() if v else None


def num(el, path):
    v = txt(el, path)
    if v is None:
        return None
    try:
        return float(v) if "." in v else int(v)
    except ValueError:
        return v


def dump(name, rows):
    p = os.path.join(OUT, name + ".json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    print(f"{name}: {len(rows)} entrées -> {p}")


# accumulateurs
services = []          # PublicServiceBuilding / MiniInstitutionBuilding / CityInstitutionBuilding : portées
water = []             # tout asset avec AqueductConsumer / Distributor / Producer
transporters = []      # MaxTransporterRange par asset
residences = []        # Residence : UpgradeThreshold, NeedsList, footprint?
warehouses = []        # Warehouse / TradeBuilding : storage, transporters, queue
free_area = []         # FreeAreaProductivity
incidents = []         # HeatValue / BurstDistance / IncidentInfectable + contre-mesures
marsh = []             # MarshBuilding & tags marais
monuments = []         # Template Monument (Colisée)
prestige = []          # RatingNeighborTiles / PlacementScore / RatingDistance
steepness = []         # SteepnessMaxHeightDiff
costs_streets = []     # assets Street (coûts, propriétés)
romanization = []      # RomanizationType / Value
fertility = []         # Fertility / FertilitySet / NeededFertility par asset prod
prodchains = []        # ProductionChain
income = []            # résidences/poplevel : revenus
techs_buffs = []       # Tech + buffs modifiant range/besoins (scan grossier)
land_tax = []          # LandTax*
bridges = []           # Bridge*
quays = []             # Quay

SERVICE_TPLS = {"PublicServiceBuilding", "MiniInstitutionBuilding", "CityInstitutionBuilding"}

for _, el in ET.iterparse(AB, events=("end",)):
    if el.tag != "Asset":
        continue
    tpl = el.findtext("Template") or ""
    v = el.find("Values")
    if v is None:
        el.clear()
        continue
    guid = txt(v, "./Standard/GUID")
    name = txt(v, "./Standard/Name")
    base = {"guid": guid, "name": name, "template": tpl}

    raw = ET.tostring(el, encoding="unicode")

    def has(tag, _raw=raw):
        return f"<{tag}" in _raw

    # --- services : portées ---
    if tpl in SERVICE_TPLS:
        es = v.find(".//EffectSource")
        services.append({
            **base,
            "radius": num(v, ".//EffectSource/RadiusDistance"),
            "street": num(v, ".//EffectSource/StreetDistance"),
            "regions": txt(v, ".//Building/AssociatedRegions"),
            "effectScope": txt(v, ".//EffectScope") or (txt(es, ".//EffectScope") if es is not None else None),
            "maintenance": [
                {"product": txt(m, "Product"), "amount": num(m, "Amount")}
                for m in v.findall(".//Maintenance//Item")
            ],
        })

    # --- eau ---
    if has("AqueductConsumer") or has("AqueductDistributor") or has("AqueductProducer") or has("WaterVolumeSupply") or has("WaterConsumption") or tpl.startswith("Aqueduct") or has("AqueductUpgrade"):
        water.append({
            **base,
            "waterVolumeSupply": num(v, ".//WaterVolumeSupply"),
            "waterConsumption": num(v, ".//WaterConsumption"),
            "aqueductConsumptionType": txt(v, ".//AqueductConsumptionType"),
            "aqueductConsumedWaterSupply": num(v, ".//AqueductConsumedWaterSupply"),
            "consumerXml": ET.tostring(v.find(".//AqueductConsumer"), encoding="unicode")[:600] if v.find(".//AqueductConsumer") is not None else None,
            "distributorXml": ET.tostring(v.find(".//AqueductDistributor"), encoding="unicode")[:600] if v.find(".//AqueductDistributor") is not None else None,
            "producerXml": ET.tostring(v.find(".//AqueductProducer"), encoding="unicode")[:600] if v.find(".//AqueductProducer") is not None else None,
        })

    # --- transporteurs ---
    mtr = num(v, ".//MaxTransporterRange")
    if mtr is not None:
        transporters.append({**base, "maxTransporterRange": mtr})

    # --- résidences ---
    if has("Residence7") or tpl == "ResidenceBuilding":
        res7 = v.find(".//Residence7")
        residences.append({
            **base,
            "populationLevel": txt(v, ".//Residence7/PopulationLevel"),
            "upgradeThresholdXml": ET.tostring(res7.find("UpgradeThreshold"), encoding="unicode")[:1500] if res7 is not None and res7.find("UpgradeThreshold") is not None else None,
            "upgradeCostXml": ET.tostring(v.find(".//Upgradable"), encoding="unicode")[:800] if v.find(".//Upgradable") is not None else None,
            "incomeXml": ET.tostring(v.find(".//IncomeCategory"), encoding="unicode")[:300] if v.find(".//IncomeCategory") is not None else None,
        })

    # --- entrepôts ---
    if tpl in ("Warehouse", "HarborWarehouse", "TradeBuilding", "HarborDepot") or has("WarehouseStorage"):
        warehouses.append({
            **base,
            "storageXml": ET.tostring(v.find(".//WarehouseStorage"), encoding="unicode")[:600] if v.find(".//WarehouseStorage") is not None else None,
            "queueXml": ET.tostring(v.find(".//QueueConfiguration"), encoding="unicode")[:400] if v.find(".//QueueConfiguration") is not None else None,
            "logisticXml": ET.tostring(v.find(".//LogisticNode"), encoding="unicode")[:400] if v.find(".//LogisticNode") is not None else None,
            "maxTransporterRange": mtr,
        })

    # --- aire libre ---
    if has("FreeAreaProductivity"):
        free_area.append({
            **base,
            "freeAreaXml": ET.tostring(v.find(".//FreeAreaProductivity"), encoding="unicode")[:800] if v.find(".//FreeAreaProductivity") is not None else None,
        })

    # --- incidents ---
    if has("HeatValue") or has("BurstDistance") or has("IncidentCounterMeasure") or has("FireFighter"):
        incidents.append({
            **base,
            "heatValue": num(v, ".//HeatValue"),
            "burstDistance": num(v, ".//BurstDistance"),
            "burstCount": num(v, ".//BurstCount"),
            "counterXml": ET.tostring(v.find(".//IncidentCounterMeasure"), encoding="unicode")[:600] if v.find(".//IncidentCounterMeasure") is not None else None,
        })

    # --- marais ---
    if tpl == "MarshBuilding" or has("AllowMarshPlacement") or has("NotOnStaticMarsh") or has("CanBePlacedOnNonMarsh"):
        marsh.append({
            **base,
            "allowMarsh": txt(v, ".//AllowMarshPlacement"),
            "notOnStaticMarsh": txt(v, ".//NotOnStaticMarsh"),
            "canBePlacedOnNonMarsh": txt(v, ".//CanBePlacedOnNonMarsh"),
            "outputs": [txt(o, "Product") for o in v.findall(".//FactoryOutputs/Item")],
        })

    # --- monuments ---
    if tpl == "Monument" or has("ConstructionStateText"):
        monuments.append({
            **base,
            "radius": num(v, ".//EffectSource/RadiusDistance"),
            "street": num(v, ".//EffectSource/StreetDistance"),
            "unique": txt(v, ".//BuildingUnique") if has("BuildingUnique") else None,
            "aqueductXml": ET.tostring(v.find(".//AqueductConsumer"), encoding="unicode")[:400] if v.find(".//AqueductConsumer") is not None else None,
            "transporterRangePct": num(v, ".//TransporterRangeEffectivePercentage"),
        })

    # --- prestige / placement score ---
    if has("RatingNeighborTiles") or has("PlacementScore") or has("RatingDistance"):
        prestige.append({
            **base,
            "ratingNeighborTiles": num(v, ".//RatingNeighborTiles"),
            "ratingDistance": num(v, ".//RatingDistance"),
            "placementScoreXml": ET.tostring(v.find(".//PlacementScore"), encoding="unicode")[:500] if v.find(".//PlacementScore") is not None else None,
        })

    # --- pente ---
    if has("SteepnessMaxHeightDiff"):
        steepness.append({**base, "steepnessMaxHeightDiff": num(v, ".//SteepnessMaxHeightDiff")})

    # --- routes / ponts / quais ---
    if tpl == "Street":
        costs_streets.append({
            **base,
            "costXml": ET.tostring(v.find(".//Cost"), encoding="unicode")[:600] if v.find(".//Cost") is not None else None,
            "fullXml": (ET.tostring(v, encoding="unicode")[:2500]),
        })
    if "Bridge" in tpl or has("BridgeLengthMax"):
        bridges.append({
            **base,
            "bridgeLengthMax": num(v, ".//BridgeLengthMax"),
            "archHeight": num(v, ".//BridgeArchHeight"),
        })
    if "Quay" in tpl or (name and "quay" in (name or "").lower()):
        quays.append({**base})

    # --- romanisation ---
    if has("RomanizationType") or has("RomanizationValue"):
        romanization.append({
            **base,
            "romanizationType": txt(v, ".//RomanizationType"),
            "romanizationValue": num(v, ".//RomanizationValue"),
        })

    # --- fertilités ---
    if tpl in ("Fertility", "FertilitySet") or has("NeededFertility") or has("AddedFertility") or has("FertilityPercent"):
        fertility.append({
            **base,
            "neededFertility": txt(v, ".//NeededFertility"),
            "addedFertility": txt(v, ".//AddedFertility"),
            "fertilityPercent": num(v, ".//FertilityPercent"),
            "setXml": ET.tostring(v, encoding="unicode")[:1200] if tpl in ("Fertility", "FertilitySet") else None,
        })

    # --- chaînes de prod ---
    if tpl == "ProductionChain":
        prodchains.append({**base, "xml": ET.tostring(v, encoding="unicode")[:2000]})

    # --- taxes ---
    if has("LandTax"):
        land_tax.append({**base, "xml": ET.tostring(v, encoding="unicode")[:1000]})

    # --- techs touchant portée/eau/besoins (scan grossier) ---
    if tpl == "Tech":
        if any(k in raw for k in ("StreetDistance", "Range", "Aqueduct", "Need", "Irrigation")):
            techs_buffs.append({**base, "hint": [k for k in ("StreetDistance", "Range", "Aqueduct", "Need", "Irrigation") if k in raw]})

    el.clear()

dump("services_ranges", services)
dump("water_assets", water)
dump("transporter_ranges", transporters)
dump("residences", residences)
dump("warehouses", warehouses)
dump("free_area_productivity", free_area)
dump("incidents", incidents)
dump("marsh", marsh)
dump("monuments", monuments)
dump("prestige", prestige)
dump("steepness", steepness)
dump("streets", costs_streets)
dump("bridges", bridges)
dump("quays", quays)
dump("romanization", romanization)
dump("fertility", fertility)
dump("production_chains", prodchains)
dump("land_tax", land_tax)
dump("techs_interesting", techs_buffs)
print("OK", file=sys.stderr)
