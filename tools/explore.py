"""Exploration rapide de assets.xml : compte les Templates, dump un asset exemple."""
import sys
import xml.etree.ElementTree as ET
from collections import Counter

path = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else "templates"
arg = sys.argv[3] if len(sys.argv) > 3 else ""

if mode == "templates":
    counter = Counter()
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag == "Asset":
            tpl = el.findtext("Template")
            if tpl:
                counter[tpl] += 1
            el.clear()
    for tpl, n in counter.most_common():
        print(f"{n:>5}  {tpl}")

elif mode == "sample":
    # dump le 1er Asset dont le Template == arg
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag == "Asset" and el.findtext("Template") == arg:
            print(ET.tostring(el, encoding="unicode"))
            break
        if el.tag == "Asset":
            el.clear()

elif mode == "guid":
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag == "Asset":
            if el.findtext("./Values/Standard/GUID") == arg:
                print(ET.tostring(el, encoding="unicode"))
                break
            el.clear()

elif mode == "grep":
    # dump le 1er Asset dont le Name contient arg
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag == "Asset":
            name = el.findtext("./Values/Standard/Name") or ""
            if arg.lower() in name.lower():
                print(ET.tostring(el, encoding="unicode"))
                break
            el.clear()
