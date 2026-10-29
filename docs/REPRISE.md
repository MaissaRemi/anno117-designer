# Reprise du projet — état au 29/10/2026

Point d'entrée pour reprendre le travail sur une autre machine (passage de Fedora à Windows).
Tout le travail est sur la branche **`dev`** ; `main` n'a pas été mis à jour depuis.

## Remettre le projet en route

```
git clone https://github.com/xXRem08Xx/anno117-designer.git
cd anno117-designer
git switch dev
pnpm install
pnpm dev          # application sur http://localhost:5173 (ou le port affiché)
pnpm test         # ~465 tests, une minute ; pnpm test:fast écarte les balayages lourds
```

Les données du jeu extraites (`src/data/*.generated.json`) sont versionnées : l'application
et les tests n'ont besoin de rien d'autre. Le dossier `.gamedata/` (fichiers bruts du jeu,
ignoré par git) ne sert qu'à **régénérer** ces données : `tools/rda_extract.py` puis les
`tools/build_*.py`, avec `ANNO_GAME_DIR` pointant sur le `maindata` du jeu (valeur par défaut
des outils : `F:\Anno 117 - Pax Romana\maindata`). Les données versionnées sont celles du
patch 200.

## Ce qui a été fait (26–29/10/2026)

Détail et mesures : `docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`, puis
`docs/superpowers/plans/2026-10-29-portees-motifs-eau.md` (le plus récent).

- Refonte du moteur d'île : onglet « Ma commande » (nomenclature, îlots, production posée).
- Portée des services selon le type de route (pavée et marbre ×1,5), copies en trop retirées,
  corridors d'eau, objectif « maximum de maisons » au palier choisi, un seul écran Planifier.
- Données du patch 200 ; géométrie des îles lue dans le jeu (terre constructible, eau côtière,
  relief), repère vertical corrigé, emplacements de montagne prédéfinis, ponts sur les rivières.
- Bâtiments côtiers à cheval sur la terre et l'eau, comme le jeu les définit.
- Dieux tutélaires branchés : dévotion = Foi de l'île, productivité qui réduit le nombre
  d'ateliers, habitants de Cérès ; choix du dieu et de la dévotion dans l'interface.
- Eau fiable pour les Patriciens (Amphithéâtre jamais sec), rapport de couverture juste.
- Prix du bilan : un bilan sain vaut quelques habitants (6 % par point de déficit par maison).

## Ce qui reste, par ordre de priorité

1. **Diagonales dans les moteurs** — étude et paliers :
   `docs/superpowers/specs/2026-10-29-diagonales-moteur.md`. Palier 1 proposé : routes de
   liaison en diagonale (les 23 îles romaines rasent des maisons pour relier le comptoir).
   En attente de trois vérifications en jeu, listées à la fin de l'étude.
2. **Onglet Production** à refaire comme un mode « île de production » de Planifier, sur la
   vraie géométrie, avec les bonus des dieux (diagnostic dans le plan du 29/10).
3. Le prix du bilan n'est pas réglable dans l'interface (paramètre `prixDuBilan`).
4. Vérifications en jeu encore ouvertes : règle exacte des aqueducs (unité des hauteurs, débord
   de 5 cases sur le relief), effets dominants des dieux, tests de bilan de `GAME_MECHANICS.md`.

## Pièges connus

- Après une fusion, le serveur de développement peut garder des modules périmés (page
  blanche, « does not provide an export named … ») : le redémarrer.
- Une sonde de mesure doit passer les hauteurs de l'île (`heightsOf`) comme le fait le
  worker de l'application, sinon ses résultats diffèrent de ce que l'on voit à l'écran.
