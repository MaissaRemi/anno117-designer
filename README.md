# Anno 117 — Designer

Outil web pour concevoir et (à terme) optimiser la disposition de bâtiments d'Anno 117 sur une grille.

## Lancer

```bash
npm install
npm run dev      # serveur de dev (http://localhost:5173)
npm run build    # build production (dist/)
npm test         # tests unitaires du moteur de règles
```

## Données du jeu (extraction)

Le catalogue par défaut (`src/data/catalog.generated.json`, 338 bâtiments) est **extrait des fichiers
d'Anno 117** : noms FR, routes, rayons, champs (free area), production, icônes. Régénération :

```bash
python tools/rda_extract.py get "<...>/maindata/config.rda" data/base/config/export/assets.xml .gamedata/assets_base.xml
python tools/rda_extract.py get "<...>/maindata/config.rda" data/base/config/gui/texts_french.xml .gamedata/texts_french.xml
python tools/build_catalog.py     # -> src/data/catalog.generated.json
python tools/extract_icons.py     # -> public/icons/*.png
```

- `tools/rda_extract.py` : extracteur d'archives RDA "Resource File V2.2".
- `tools/build_catalog.py` : assets.xml + textes FR + tailles (.ifo BoundingBox) → catalog.json.
- `tools/extract_icons.py` : icônes DDS 4k → PNG 64px.
- **Exact** : routes, rayons, champs, production, noms FR. **Approx ±1** : tailles (BoundingBox `.ifo`),
  corrigeables via l'éditeur de catalogue.

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
