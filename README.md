# Anno 117 — Designer

Outil web pour concevoir et (à terme) optimiser la disposition de bâtiments d'Anno 117 sur une grille.

## Lancer

```bash
npm install
npm run dev      # serveur de dev (http://localhost:5173)
npm run build    # build production (dist/)
npm test         # tests unitaires du moteur de règles
```

## Données du jeu (pipeline d'extraction)

L'outil ne code aucune donnée en dur : tout ce qu'il manipule — 338 bâtiments, 55 îles, chaînes de
production, reliefs — est produit par un **pipeline d'extraction** qui lit directement les archives
du jeu. C'est le cœur technique du projet autant que l'éditeur lui-même : `tools/rda_extract.py`
implémente le format d'archive propriétaire *Resource File V2.2* (en-têtes, répertoire, blocs zlib),
et les scripts au-dessus en tirent des JSON exploitables par l'application.

Conséquence directe : quand le jeu est mis à jour, il suffit de relancer le pipeline.

### Les icônes ne sont pas fournies

Les 222 icônes de bâtiments sont des illustrations Ubisoft : elles **ne sont pas versionnées** et
`public/icons/` est ignoré par git. En leur absence, l'interface affiche une pastille de la couleur
du bâtiment — l'application reste pleinement fonctionnelle. Pour les obtenir, lance le pipeline
ci-dessous depuis ta propre installation du jeu.

### Régénération

```bash
export ANNO_GAME_DIR="<...>/Anno 117 - Pax Romana/maindata"   # Windows : set ANNO_GAME_DIR=...

python tools/rda_extract.py get "$ANNO_GAME_DIR/config.rda" data/base/config/export/assets.xml .gamedata/assets_base.xml
python tools/rda_extract.py get "$ANNO_GAME_DIR/config.rda" data/base/config/gui/texts_french.xml .gamedata/texts_french.xml

python tools/build_catalog.py     # -> src/data/catalog.generated.json
python tools/build_economy.py     # -> src/data/economy.generated.json
python tools/build_islands.py     # -> src/data/islands.generated.json
python tools/build_terrain.py     # -> src/data/terrain*.generated.json
python tools/extract_icons.py     # -> public/icons/*.png   (non versionné)
```

| Script | Rôle |
|---|---|
| `rda_extract.py` | Extracteur d'archives RDA « Resource File V2.2 » |
| `build_catalog.py` | `assets.xml` + textes FR + tailles (`.ifo` BoundingBox) → catalogue |
| `build_economy.py` | Besoins, chaînes de production, main-d'œuvre |
| `build_islands.py` | Tailles et masques terre/mer des 55 îles |
| `build_terrain.py` | Relief et hauteurs |
| `extract_icons.py` | Icônes DDS 4k → PNG 64px |

**Exact** : routes, rayons, champs, production, noms FR. **Approx ±1** : tailles (BoundingBox `.ifo`),
corrigeables via l'éditeur de catalogue.

## Planificateur de population (objectif d'habitants)

Bouton **👥 Population** : fixer une population cible par classe (tier) ; le modèle calcule
automatiquement le plan.

- **Besoins** : chaque résidence a une `NeedsList` (biens consommés avec taux + services).
- **Cascade main-d'œuvre** : la main-d'œuvre est un « bien » par tier (`ConnectedWorkforce`,
  `PopulationToWorkforceFactor`) consommé par les bâtiments → solveur **point-fixe** (population →
  besoins → production → main-d'œuvre → population supplémentaire → …).
- **Bilan** : population/résidences par tier, bâtiments de production (chaînes complètes) et
  d'influence (services). Bouton **Placer sur l'île** → réutilise l'optimiseur.
- Données : `tools/build_economy.py` → `src/data/economy.generated.json`. Solveur `src/economy/`.
- Calibration : `NeedConsumptionRate` est **par maison** (résidence), pas par habitant → la cascade
  converge (ratio < 1). Repli automatique sur les besoins directs + avertissement si jamais instable.
  Capacité/maison par tier = défaut éditable.

## Îles du jeu (formes réelles)

Bouton **🏝 Île** : charger une des **55 îles** d'Anno 117 comme grille (taille + forme exactes).

- Taille en cases lue dans le `.a7minfo` de chaque île (offset 8 : largeur, hauteur).
- Forme = masque terre/mer extrait du rendu `mapimage.png`, redimensionné à la taille réelle.
- Génération : `python tools/build_islands.py` → `src/data/islands.generated.json` (masque RLE).
- Aperçus miniatures dans le sélecteur ; charger une île remplace la grille courante.

## Fonctionnalités (MVP — éditeur manuel)

- **Catalogue de bâtiments** réel + éditable (dimensions, rotation, route requise, rayon, champ,
  production, région, icône). Filtres recherche / catégorie / région. Ajout via **+ Bâtiment**.
- **Grille de forme libre** : outils *Dessiner* / *Masquer* pour peindre les cases utilisables.
- **Placement** de bâtiments (aperçu valide/invalide), **rotation** (R), **déplacement**,
  **verrouillage** (🔒 = fixe, ignoré par le futur optimiseur).
- **Routes** et **champs** peints à la souris, avec validation des règles :
  - accès routier (case adjacente à une route),
  - champ suffisant, connecté, et touchant le bâtiment.
- **Rayons** de service/boost affichés en overlay.
- **Validation visuelle** : bordure rouge + détail des problèmes dans le panneau de droite.
- **Sauvegarde** : autosave navigateur, import/export **JSON**, export **PNG**.

## Raccourcis

| Touche | Action |
|--------|--------|
| `R` | Pivoter (la pose, ou le bâtiment sélectionné) |
| `Suppr` | Supprimer le bâtiment sélectionné |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Rétablir |
| `Échap` | Désélectionner |
| molette | Zoom · clic droit = déplacer la vue |

## Architecture

```
src/
  model/    types + factories + (dé)sérialisation
  engine/   règles pures + tests (placement, routes, champs, rayons, validation)
  state/    store Zustand (layout, sélection, mode, undo/redo)
  render/   couche de dessin Canvas 2D
  ui/       composants React (TopBar, Toolbar, Catalog, SidePanel, GridCanvas)
  data/     catalogue d'exemple (seed)
  persist/  localStorage, import/export JSON, export PNG
```

## Optimiseur automatique (phase 2 — fait)

Bouton **⚙ Optimiser** : définir une liste de bâtiments (quantités), pondérer les objectifs
(max bâtiments / couverture rayon / compacité / routes min), choisir un budget temps, lancer.

- **Auto-génération des routes** : réseau (bandes horizontales + épine verticale) garantissant
  l'accès route par construction.
- **Champs** : les fermes reçoivent leur free area (bloc connecté sous le bâtiment, nb de cases exact).
- **Bâtiments verrouillés** conservés ; l'algo remplit autour. Routes dessinées par l'utilisateur
  conservées ; routes auto remplacées à chaque re-calcul (flag `gen`).
- **Algo** : décodeur glouton (packing macro-tuiles) + **recuit simulé** (ordre, décalage de bande)
  dans un **Web Worker** (UI non bloquée), score via `engine/`.

Code : `src/optimizer/` (`types`, `greedy`, `anneal`, `score`, `worker`, `runOptimizer`).
Tests : `src/optimizer/optimizer.test.ts`.

## Mentions légales

Projet personnel non officiel, **sans aucun lien avec Ubisoft**. *Anno* est une marque déposée
d'Ubisoft Entertainment.

Les données manipulées par l'outil sont extraites d'une installation du jeu et restent la propriété
d'Ubisoft. Les icônes des bâtiments ne sont pas redistribuées : elles se génèrent depuis tes propres
fichiers via `tools/extract_icons.py`. Une copie légale d'Anno 117 est nécessaire pour exécuter le
pipeline d'extraction.
