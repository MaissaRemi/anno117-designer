"""
Rend en PNG les plans écrits par le balayage de qualité (src/optimizer/planQuality.sweep.test.ts).

Une couleur par usage du sol : c'est ce qui rend lisible, en un coup d'oeil, ce qu'aucun
chiffre ne montre — un quadrillage de routes sur toute l'île, des services partout et
quelques maisons dans un coin.

Lance :
    python tools/render_plan.py plan-celtic_island_large_07.json            # -> .png à côté
    python tools/render_plan.py avant.json apres.json -o comparaison.png    # côte à côte
"""
import argparse
import json
import os

from PIL import Image, ImageDraw

MER = (24, 40, 64)
TERRE = (214, 205, 170)
COULEURS = {
    "residence": (70, 160, 70),
    "service": (220, 120, 40),
    "production": (150, 90, 170),
    "infrastructure": (200, 60, 60),
}
ROUTE = (90, 90, 90)
CHAMP = (230, 210, 80)
CONDUITE = (90, 200, 230)


def rendre(chemin: str, echelle: int) -> Image.Image:
    p = json.load(open(chemin, encoding="utf-8"))
    w, h = p["w"], p["h"]
    img = Image.new("RGB", (w * echelle, h * echelle), MER)
    d = ImageDraw.Draw(img)

    def case(x: int, y: int, c: tuple) -> None:
        d.rectangle([x * echelle, y * echelle, (x + 1) * echelle - 1, (y + 1) * echelle - 1], fill=c)

    for i, u in enumerate(p["usable"]):
        if u == "1":
            case(i % w, i // w, TERRE)
    for x, y in p["fields"]:
        case(x, y, CHAMP)
    for x, y in p["roads"]:
        case(x, y, ROUTE)
    for x, y in p["aqueducts"]:
        case(x, y, CONDUITE)
    for b in p["buildings"]:
        d.rectangle(
            [b["x"] * echelle, b["y"] * echelle, (b["x"] + b["w"]) * echelle - 1, (b["y"] + b["h"]) * echelle - 1],
            fill=COULEURS.get(b["role"], (255, 255, 255)),
            outline=(30, 30, 30) if echelle >= 3 else None,
        )
    q = p.get("quality", {}).get("pct")
    if q:
        legende = (f"{p['id']} | maisons {q['residence']}% services {q['service']}% "
                   f"routes {q['roads']}% vide {q['free']}%")
        d.text((4, 4), legende, fill=(255, 255, 255))
    return img


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("plans", nargs="+", help="fichiers JSON écrits par le balayage")
    a.add_argument("-o", "--out", help="PNG de sortie (côte à côte si plusieurs plans)")
    a.add_argument("-s", "--scale", type=int, default=2, help="pixels par case (défaut 2)")
    args = a.parse_args()

    images = [rendre(c, args.scale) for c in args.plans]
    if len(images) == 1 and not args.out:
        sortie = os.path.splitext(args.plans[0])[0] + ".png"
        images[0].save(sortie)
        print(sortie)
        return
    marge = 16
    largeur = sum(i.width for i in images) + marge * (len(images) - 1)
    toile = Image.new("RGB", (largeur, max(i.height for i in images)), (255, 255, 255))
    x = 0
    for i in images:
        toile.paste(i, (x, 0))
        x += i.width + marge
    sortie = args.out or os.path.splitext(args.plans[0])[0] + "-comparaison.png"
    toile.save(sortie)
    print(sortie)


if __name__ == "__main__":
    main()
