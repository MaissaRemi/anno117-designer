# Anno 117 Designer — Avancement & Architecture

Outil web pour concevoir/optimiser des dispositions de bâtiments Anno 117, avec données réelles
extraites du jeu. Ce fichier = mémoire du projet (garder l'avancé).

Repo: https://github.com/xXRem08Xx/anno117-designer · Stack: Vite + React + TS + Canvas, état Zustand,
tests Vitest. UI en français.

---

## 1. Comment lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm test         # 28 tests (engine + optimizer + chain + economy)
```

Jeu installé: `F:\Anno 117 - Pax Romana\maindata` (archives RDA). Données extraites dans `.gamedata/`
(gitignored). Catalogues générés commités: `src/data/*.generated.json`.

---

## 2. Extraction des données du jeu (`tools/`)

Format archives = RDA "Resource File V2.2" (même qu'Anno 1800). Extracteur écrit from scratch.

| Outil | Rôle | Sortie |
|---|---|---|
| `rda_extract.py` | Extracteur RDA V2.2 (header 792o, block 32o, file header 560o, zlib). `list/get/dump` | fichiers bruts |
| `build_catalog.py` | assets.xml + texts_french + tailles `.ifo` → catalogue bâtiments | `src/data/catalog.generated.json` (338) |
| `extract_icons.py` | icônes DDS 4k (ui.rda) → PNG 64px | `public/icons/*.png` (222) |
| `build_islands.py` | a7minfo (taille) + mapimage.png (forme terre/mer) | `src/data/islands.generated.json` (55) |
| `build_economy.py` | tiers, besoins, main-d'œuvre, entretien | `src/data/economy.generated.json` |
| `explore.py` | exploration assets.xml (templates/sample/guid/grep) | stdout |

Pipeline regen:
```bash
python tools/rda_extract.py get "<game>/maindata/config.rda" data/base/config/export/assets.xml .gamedata/assets_base.xml
python tools/rda_extract.py get "<game>/maindata/config.rda" data/base/config/gui/texts_french.xml .gamedata/texts_french.xml
python tools/build_catalog.py && python tools/extract_icons.py && python tools/build_economy.py && python tools/build_islands.py
```

### Schéma Anno 117 décodé (clé pour tout le reste)
- **assets.xml** dans `config.rda` (`data/base/config/export/assets.xml`, 32 Mo). `templates.xml` = défauts hérités.
- **Taille bâtiment**: PAS dans assets. = `.ifo` (à côté du `.cfg`, dans `graphics_*.rda`) → `BoundingBox/Extents × 2` (approx ±1).
- **Besoin de route**: présence `<StreetActivation/>`.
- **Rayon**: `EffectSource/RadiusDistance` (+ `StreetDistance`).
- **Champ ferme (free area)**: `ModuleOwner/ModuleLimits/Main/Limit` (ex olive 160). Module = bloc connecté.
- **Production**: `FactoryBase` (FactoryOutputs/Inputs Product+Amount, CycleTime sec). Bien = GUID produit.
- **Nom FR**: `texts_french.xml`, clé = `Values/Text/OasisId` (PAS le GUID).
- **Région**: `Building/AssociatedRegions` (Roman=Latium, Celtic=Albion).
- **Comptoir/entrepôt**: templates Warehouse/HarborWarehouse/TradeBuilding/HarborDepot → flag `roadRoot`.
- **Main-d'œuvre = un bien par tier**: `PopulationLevel/ConnectedWorkforce` (GUID), `PopulationToWorkforceFactor`
  (0.5 T1 → 0.1 T4). Consommée via `Maintenance` des bâtiments (Item Product = bien-workforce).
- **Capacité/maison**: = Σ `Population` des `NeedAttributes` de TOUS les besoins du tier.
  (Liberti 6, Plébéiens 13, Equites 24, Patriciens 35 ; Celtic Tourbiers 4/Forgerons 9/Aldermen 18 ; Mercators 13, Nobles 21.)
- **Besoins** (`Residence7/NeedsList`): avec `NeedConsumptionRate` = **bien** (par MAISON/min, pas par habitant) ;
  sans taux = **service** (bâtiment d'influence). `Need/NeedProduct` = bien réel. Service→bâtiment via match icône.
- **NeedAttributes** (par besoin rempli, ou présence bâtiment): Population, Money, Happiness, Belief,
  Knowledge, Prestige, Health, FireSafety.
- **Entretien argent**: `Maintenance` Item Product `1010017` (crédits), par minute.
- **Îles**: `provinces_*.rda`. Taille = `.a7minfo` offset 8 (2 uint32: 256/320/512/768). Forme = alpha de
  gamemapimage OU terre de mapimage.png (carré), seuillée, redim à taille réelle. `.a7m` = RDA imbriqué
  (gamedata.data FileDB + rd3d.data) — non parsé, pas nécessaire.

---

## 3. Architecture app (`src/`)

```
model/     types (BuildingDef, Layout, Island...) + factories + serialize
engine/    règles pures + tests : geometry, canPlace, roadConnected, rootedRoadSet,
           validateFields, computeRadiusCoverage, validateLayout
state/     store Zustand (layout, sélection, mode, undo/redo, loadIsland, applyOptimization)
render/    draw.ts (Canvas 2D : grille, bâtiments, champs, routes, rayons, hover)
ui/        TopBar, Toolbar, GridCanvas, Catalog, CatalogEditor, SidePanel,
           IslandPicker, OptimizerPanel, PopulationPlanner, ProductionPlanner
optimizer/ types, greedy (décodeur), anneal (recuit), score, chain, worker, runOptimizer
economy/   economy (données+helpers), solve (solveur point-fixe), tests
data/      *.generated.json (catalogue, îles, économie) + seed
persist/   localStorage (clé v2), import/export JSON, export PNG
```

---

## 4. Fonctionnalités (toutes sur `main`)

### Éditeur manuel
Grille forme libre, placement/rotation/verrouillage, routes, champs, rayons, validation visuelle,
undo/redo, raccourcis (R, Suppr, Ctrl+Z/Y, Échap), autosave + JSON + PNG.

### Catalogue réel
338 bâtiments (noms FR, tailles, route, rayon, champ, production, région, icône, roadRoot).
Filtres recherche/catégorie/région. Éditable.

### 🏝 Îles
55 îles réelles (taille + forme exactes) chargeables comme grille. Sélecteur avec miniatures.

### ⚙ Optimiseur (Web Worker, recuit simulé)
- Entrées: **liste de bâtiments** (qty) ou **chaîne de prod** (bâtiment final → amont aux ratios).
- Décodeur glouton: macro-tuiles (bâtiment + bloc champ), routes auto (épine + rangées tous band+1),
  pose flush contre route (accès garanti), **ponts vers comptoir verrouillé + routes existantes**.
- Recuit: perturbe (ordre, décalage bande), re-score. Score pondéré (count×100, compacité, couverture, −routes).
- Garde les bâtiments verrouillés ; routes auto taguées `gen` (remplacées au recalcul, pas empilées).

### 👥 Planificateur population
Cible habitants/tier → cascade point-fixe (besoins → production → main-d'œuvre → +résidents → …).
Options: inclure production, inclure services, **Max économie** (besoins rentables seulement).
Bilan: pop/résidences par tier, bonus cumulés (💰 argent, bonheur, prestige…), **net éco** (taxe − entretien),
liste bâtiments. Bouton "Placer sur l'île" (réutilise l'optimiseur).

### 🏭 Planificateur production
Cible **débit (u/min)** par bien → bâtiments + chaînes. Option **inclure main-d'œuvre/résidents**
(cascade inverse). Net éco + placement.

---

## 5. Calculs clés (formules)

- **Demande bien** = (population/capacité) × taux  [par MAISON, par minute].
- **Bâtiments prod** = demande / (Amount/CycleTime × 60). Explosion récursive des entrées.
- **Main-d'œuvre** consommée = Σ count × amount (Maintenance bien-workforce). Population requise = conso/facteur.
- **Point-fixe**: pop → demande → prod → main-d'œuvre → pop, jusqu'à stable (convergence relative). Repli
  "besoins directs" si instable (`converged:false`).
- **Net argent/min** = Σ résidences × Money/maison(besoins retenus) − Σ bâtiments × entretien.
- **Max économie** (`optimizeNeeds`): garde besoin si `Money − taux×entretien_unité_bien ≥ 0` (ou
  `Money − entretien_service/maisons ≥ 0`). Capacité = Σ Population(retenus) → moins de besoins = cap ↓ =
  plus de maisons mais net ↑. Garde-fou cap ≥ 1.
- **Connexité route**: `rootedRoadSet` = BFS routes depuis routes adjacentes au comptoir (roadRoot). Bâtiment
  valide ssi sa route ∈ réseau racine. Sans comptoir → toute route (hasRoot=false).

### Exemples vérifiés (chiffres réels du code)
- 20 maisons 3×3 / 20×20 → band 3, 20 placées, 115 routes, score 102.28.
- 3 fermes (5×5, champ 80) → band 21, 3 placées, 240 cases champ.
- 50 Liberti → cap 6, 9 maisons, 5 biens+2 services, 21 bâtiments prod, +1 Forgeron (cascade), convergé.
- 1000 Patriciens (tous besoins) → net +311/min (taxe 3017 − entretien 2706, 29 maisons, 84 prod).
- 1000 Patriciens (max éco) → net +4596/min (taxe 5842 − entretien 1246, 48 maisons).
- 5/min Lin sans main-d'œuvre → 8 bâtiments ; avec → 29 bâtiments + 50 Liberti + 1 Forgeron.

---

## 6. Limites connues (à affiner)
- **Tailles bâtiments ±1** (BoundingBox `.ifo`). 17/338 en taille défaut 3×3. Éditables.
- **Revenu = taxe résidences seulement** (vente de biens non modélisée → production pure = net négatif).
- **Max économie** ignore les besoins "obligatoires pour rester au tier" (peut larguer un besoin requis in-game).
- **Placement diagonal** (45° du jeu) non supporté.
- **Terrain** (fertilité, river/mountain/harbour slot, aqueduc) non modélisé.
- **Perf placement** gros plans (1000+ bâtiments) : recuit peut ramer.
- Choix producteur = `producers[0]` (pas de préférence région fine).

## 7. Pistes suivantes
- Revenu de vente des biens (prix × débit) pour net réaliste en mode production.
- Marquer besoins obligatoires vs luxe (NeedCategory/SupplyWeight) pour fiabiliser max-éco.
- Capacité éditable dans l'UI ; rendu icônes sur canvas ; couleur route reliée vs isolée.
- Calibrer/valider tailles vs anno.land ; placement diagonal ; terrain.

---

## 8. Historique branches (toutes mergées dans main)
- `main` initial: éditeur + extraction catalogue + optimiseur (liste/chaîne) + planificateur population.
- `feature/islands`: îles réelles + capacités calculées + bilan bonus.
- `feature/road-network`: connexité route→comptoir.
- `feature/economy-net`: net éco (entretien), planificateur production, max-économie.

Mémoire perso aussi: `C:\Users\rem34\.claude\projects\F--Code-annoDesigner\memory\anno117-designer-projet.md`.
