"""
INDEX DES FONCTIONS — genere .claude/functions-index.md depuis le code.

Pour chaque fichier de src/ (hors tests) : la premiere phrase de son en-tete, puis chacun de ses
symboles exportes (fonction, constante, type, interface, classe) avec sa ligne, la premiere phrase
de son commentaire de documentation, et le nombre de fichiers de src/ qui le citent (indicateur
de centralite : un symbole cite partout est un contrat partage).

Usage : python tools/gen_functions_index.py      (a relancer apres un chantier)
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, ".claude", "functions-index.md")
EXCLU = re.compile(r"\.(test|sweep)\.|golden|vite-env\.d\.ts$")
EXPORT = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?(function|const|let|interface|type|class|enum)\s+([A-Za-z_$][\w$]*)", re.M)


def premiere_phrase(texte, n=150):
    t = re.sub(r"\s+", " ", texte).strip()
    # un en-tete en bandeau (« ═══ TITRE ═══ ») : le titre seul
    morceaux = [m.strip() for m in re.split(r"[═─]{3,}", t) if m.strip()]
    if len(morceaux) > 1 or (morceaux and morceaux[0] != t):
        t = morceaux[0]
        return t if len(t) <= n else t[: n - 1].rstrip() + "…"
    m = re.match(r"(.+?[.!?])(\s|$)", t)
    t = m.group(1) if m else t
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def nettoyer_doc(bloc):
    lignes = [re.sub(r"^\s*\*\s?", "", l) for l in bloc.split("\n")]
    return " ".join(l for l in lignes if l.strip())


def doc_avant(texte, pos, entete_fin):
    """Commentaire /** */ qui precede immediatement `pos` (blancs permis), sauf l'en-tete du
    fichier (qui finit en `entete_fin`) : il decrit le module, pas ce symbole."""
    avant = texte[:pos].rstrip()
    if not avant.endswith("*/") or len(avant) == entete_fin:
        return ""
    debut = avant.rfind("/**")
    return nettoyer_doc(avant[debut + 3: -2]) if debut >= 0 else ""


def main():
    fichiers = []
    for racine, _dirs, noms in os.walk(SRC):
        for nom in noms:
            if nom.endswith((".ts", ".tsx")) and not EXCLU.search(nom):
                fichiers.append(os.path.join(racine, nom))
    fichiers.sort()
    textes = {f: open(f, encoding="utf-8").read() for f in fichiers}
    tous = {f: open(f, encoding="utf-8").read() for f in
            [os.path.join(r, n) for r, _d, ns in os.walk(SRC) for n in ns if n.endswith((".ts", ".tsx"))]}

    def cites(sym, chez):
        mot = re.compile(r"\b" + re.escape(sym) + r"\b")
        return sum(1 for f, t in tous.items() if f != chez and mot.search(t))

    out = ["# Index des fonctions et des types",
           "",
           "Généré par `python tools/gen_functions_index.py` : ne pas éditer à la main, relancer le",
           "script. Pour chaque fichier de `src/` (hors tests) : son rôle (première phrase de l'en-tête),",
           "puis ses exports avec leur ligne et, entre crochets, le nombre de fichiers de `src/` (tests",
           "compris) qui les citent — un nombre élevé signale un contrat partagé. Vue d'ensemble :",
           "`.claude/architecture.md`.",
           ""]
    module_courant = None
    for f in fichiers:
        rel = os.path.relpath(f, HERE).replace("\\", "/")
        module = os.path.dirname(rel)
        if module != module_courant:
            out += ["", f"## {module}", ""]
            module_courant = module
        t = textes[f]
        # L'EN-TETE DU MODULE : le premier bloc /** */, s'il ouvre le fichier, porte un bandeau
        # (« ═══ TITRE ═══ ») ou est long ; il vient parfois apres les imports.
        m = re.search(r"/\*\*(.*?)\*/", t, re.S)
        if m and not (m.start() < 400 or re.search(r"[═─]{3,}", m.group(1)) or len(m.group(1)) > 400):
            m = None
        role = premiere_phrase(nettoyer_doc(m.group(1))) if m else ""
        out.append(f"### `{rel}`" + (f" — {role}" if role else ""))
        for e in EXPORT.finditer(t):
            genre, sym = e.group(1), e.group(2)
            ligne = t.count("\n", 0, e.start()) + 1
            doc = premiere_phrase(doc_avant(t, e.start(), m.end() if m else -1), 120)
            n = cites(sym, f)
            out.append(f"- `{sym}` ({genre}, L{ligne}) [{n}]" + (f" : {doc}" if doc else ""))
    open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(out).rstrip() + "\n")
    print(f"{OUT} : {len(fichiers)} fichiers")


if __name__ == "__main__":
    main()
