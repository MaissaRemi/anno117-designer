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
python tools/rda_extract.py get "<game>/maindata/config.rda" data/base/config/export/templates.xml .gamedata/templates.xml
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
  Pas de vérité-terrain externe (anno.land) → non auto-validable. **Reste à faire.**
- **Max économie** ignore les besoins "obligatoires pour rester au tier" (peut larguer un besoin requis in-game).
- **Placement diagonal** (45° du jeu) non supporté.
- **Terrain** (fertilité, river/mountain/harbour slot, aqueduc) non modélisé.
- **Perf placement** gros plans (1000+ bâtiments) : recuit peut ramer.

### ✅ Corrigés (passe critique)
- **Packing par étagères hauteur variable** (`greedy.ts`) : remplace la bande globale figée
  sur le plus grand bâtiment. Chaque étagère = hauteur du 1er posé (ordre trié décroissant) →
  fin du gâchis quand on mélange petites maisons + grandes fermes. Test `packing.test.ts`.
- **Valeur marchande des biens** (`solve.ts` `marketValue` = Σ débit × BasePrice) exposée à part
  du net (taxe seule). Données `goodPrices` (113 biens, BasePrice). UI planificateurs.
- **Producteur par région** : `pickProducer(good, region)` réel (préfère région du tier consommateur,
  puis bâtiment commun, sinon 1er). Données `buildingRegion` (232). Threadé dans `solve`/upkeep.
- **Couverture par distance-rue** (`computeRadiusCoverage`) : BFS le long des routes jusqu'à
  `streetRange` pour les services (mécanique réelle), repli euclidien sans route. Test rules.
- **Faisabilité** : avertissement UI quand `placed < requested` (grille trop petite).
- **Convergence** : warning cascade instable affiché aussi dans le planificateur production.
- Nettoyage : `bandOffset`/dead code recuit, `DEFAULT_HOUSES_PER_SERVICE` nommé.
- Tests 28 → 34 (golden : marketValue, région, street-coverage, anti-gâchis packing).

### ✅ Passe densité optimiseur (2e itération)
- **Décodeur conscient des routes** : si AUCUN bâtiment à placer n'exige de route
  (`needsRoad && !roadRoot`), on ne génère ni épine ni rangées → 0 route gaspillée.
  Ex fermes : 146 routes → **0** (densité +). Ponts comptoir/existants aussi sous garde.
- **Rangées de route rognées** à l'étendue réelle de chaque étagère (plus de route
  pleine largeur sur étagère partielle). Mixte maisons+grands : fill 57 % → **69 %**.
- **Recuit voisinage élargi** : inversion de segment + déplacement d'élément + échange
  (avant : échange + offset seulement) → meilleur regroupement par hauteur d'étagère.
- **Bornes mesurées** : maisons 3×3 uniformes → 63 placées = optimum du peigne mono-
  orientation (rangée route /4 lignes, épine coûte 1 colonne). Décodeur atteint sa borne
  de topologie exactement ; vrai optimal 2D = NP-difficile (strip packing), non garanti.
  Gain résiduel possible : variante packing en colonnes (≈ +10 % si H favorable) — futur.
- **Tests rôle** (`quality.test.ts`, 6) : sortie VALIDE via `validateLayout` (0 chevauchement,
  route reliée à la racine comptoir, champs OK), 0 route si non requise, atteinte borne peigne
  (≥90 %), borne d'aire jamais dépassée, 100 % placés si espace, recuit garde le meilleur.
  Total tests **34 → 40**.

### ✅ Correction données route + placement eau (3e passe)
- **Bug `needsRoad`** : extraction = `StreetActivation` seul → ratait toutes les productions
  (qui n'ont pas ce flag mais ont `LogisticNode` = transport des biens vers entrepôt).
  Corrigé : `needsRoad = (StreetActivation OU LogisticNode) ET pas eau`. **Avant/après :
  269 → 115** bâtiments « sans route » (154 productions corrigées). `build_catalog.py`.
- **Placement terre/eau** : nouveau champ `placement` ("land"/"water") extrait de
  `Building/TerrainType` (`Water_Including_Coast`/`Coast`) + `AllowWaterPlacement`. **15
  bâtiments côtiers** : chantiers navals, pêcheries (huîtres, maquereaux, coques…), marais
  salants, raffineries de sable, jetées marchandes.
- **Modèle eau** : `GridShape.water?` (cases mer). Îles : `water = !terre` (la mer remplit
  le carré autour de l'île). `isBuildable(grid,x,y,placement)` → terre vs eau. `canPlace`
  + `validateLayout` (nouveau flag `terrain`) refusent une pêcherie sur terre / une maison
  sur l'eau. Rendu canvas : cases mer en bleu (`#1c3a52`).
- **Optimiseur** : ignore les bâtiments côtiers (packing terrestre) → note UI « poser à la
  main sur la mer » (OptimizerPanel). Audit affiche tag 🌊 côtier.
- **Audit** outil (`RoadAudit`, bouton 🛣 Audit) : liste les 115 sans route, bouton par ligne
  « A besoin d'une route » → `updateDef(needsRoad=true)`. localStorage **v2 → v3** (recharge
  le catalogue corrigé). Tests : audit avant/après (route apparaît), placement terre/eau.
  Total tests **40 → 45**.

### ✅ Couverture services publics (analyse + solveur)
- **Analyse par service** (`economy/coverage.ts` `analyzeCoverage`) : pour chaque type de
  service requis par les tiers présents, % de résidences DANS le rayon (distance-rue), liste
  des cases-maison non couvertes. Corrige le défaut « union de tous les services » : mesure
  désormais **par type** (Marché 27 %, Sanctuaire 0 %…). Services sans rayon dans les données
  (Taverne, Grammaticus) marqués « non analysable ».
- **Solveur placement** (`optimizer/coverPlace.ts` `placeServicesForCoverage`) : glouton
  max-cover (set cover). Positions candidates = terre libre touchant une route ; leurs zones
  de couverture sont **précalculées une fois** (ne dépendent que des routes+grille) → set-cover
  rapide. Vise 100 % par service ; signale les trous si manque de place. Couverture distance-rue
  si routes, sinon euclidienne.
- **UI** `CoveragePanel` (bouton 📡 Couverture) : tableau % par service (code couleur), bouton
  👁 surligne en ROUGE les maisons hors rayon (store `coverageHighlight` → `draw.ts`), bouton
  « Placer les services manquants ». Store : `addBuildings`, `setCoverageHighlight`.
- Limite : le solveur a besoin d'espace libre (si la grille est déjà saturée par prod+maisons,
  « pas de place » → laisser de la marge). NP-difficile : glouton, pas optimum prouvé du *nombre*
  de bâtiments, mais atteint 100 % de *couverture* si l'espace suffit.
- Tests : analyse (3) + solveur 100 % (3). Total **45 → 51**.
- **Rayons hérités des templates** : Taverne/Grammaticus/Théâtre bardique avaient un
  `<EffectSource>` VIDE dans l'asset → rayon hérité du template `PublicServiceBuilding`
  (22/26), Mini (18/22), City (22/26). `build_catalog.py` charge `templates.xml`
  (`load_template_effects`) et applique le défaut quand l'asset n'a pas de RadiusDistance.
  Public sans rayon **32 → 24** (reste = comptoirs/monuments, sans influence). localStorage v3→**v4**.

### ✅ Planificateur d'île — mode IMPORT (le but premier, partie 1)
But du logiciel : donner une île + « max d'habitants tier-cible » → meilleure config (max maisons,
tous besoins+services, dans la forme exacte de l'île). Mode **import** = prod sur une autre île.
- `optimizer/islandPlan.ts` `planIslandImport(grid, tierGuid, opts)` : recherche dichotomique du
  **max de maisons** du tier-cible qui RENTRENT (objectif = max habitants). **Co-place maisons +
  services** dans une seule liste passée à `anneal` (le shelf packer donne l'accès route à tous) ;
  `analyzeCoverage` mesure la couverture (best-effort) ; `solve(includeProduction:false)` donne le
  **manifeste d'import** (biens consommables u/min). Sortie : habitants, maisons, net éco, bonus,
  importGoods, couverture min, trous.
- Worker `islandPlanWorker.ts` + `runIslandPlan.ts` (UI non bloquée). UI `IslandPlanner.tsx`
  (bouton 🏛 Plan d'île) : tier-cible, mode import (local=phase 2 grisé), seuil, résultat + « Placer
  sur l'île » (via `applyOptimization`). Tests `islandPlan.test.ts` (5). Total **51 → 56**.
- **Vérifié live** : île 192² Petite 06 → Patriciens **7 420 hab / 212 maisons**, net +10 656/min,
  manifeste 27 biens (Vin 2.36/min…), bonus cumulés. ✅ pour habitants+manifeste+éco.
- **Limite connue (le vrai prochain chantier)** : la **couverture services à l'échelle** est faible
  car le shelf packer ÉTALE les maisons sur toute l'île → les services à petit rayon (Taverne 28,
  Marché 28) n'atteignent pas toutes les maisons (les grands rayons Forum/Bains/Théâtre couvrent
  bien). Best-effort + trous rapportés (choix utilisateur). **Fix = packing compact par "district"**
  (grouper les maisons en quartiers dimensionnés au rayon d'un service → 1 de chaque service couvre
  tout). C'est la pièce qui réalise vraiment « toutes les maisons reçoivent tous les services ».

### 🔬 R&D packing par district (algorithme validé, générateur à construire)
Expériences menées pour atteindre « toutes les maisons reçoivent tous les services » :
- **Le shelf packer ÉTALE** les maisons → services à petit rayon couvrent 27-46 %. coverPlace-après
  échoue (services géants coincés loin des routes : `touchRoad=0`).
- **Fait géométrique clé** : pour Patriciens (10 services), l'emprise cumulée des services (1374
  cases) DÉPASSE l'intersection de leurs rayons → **0 maison ne peut être à portée des 10 services
  groupés**. Donc 100 %-tous-services groupés = géométriquement impossible.
- **Solution validée** : séparer **petits/locaux** (rayon ≤40 : Marché 28, Taverne 26, Grammaticus
  26, Sanctuaire 38 → groupés par district) des **gros/île** (rayon >40 : Forum 70, Temple 68, Bains
  66, Bibliothèque 62, Théâtre 50, Maison de jeu 42 → quelques copies couvrant toute l'île). Un
  district = cluster des petits (≈16×18) + maisons dans l'intersection de leurs rayons ≈ **85
  maisons/district** (euclidien, par construction).
- **Coût quantifié** : l'extent du cluster (~18) mange le rayon utile (26) → rayon-maison effectif
  ~17 → la couverture totale T4 est **chère en surface** (services+routes prennent une grosse part).
- Ajout réutilisable : `computeRadiusCoverage(layout, lookup, {euclidean})` + `analyzeCoverage(...,
  {euclidean})` — borne de planification indépendante des rues (le district la garantit).

### ✅ Générateur de districts v2 — piloté par la DEMANDE (`optimizer/districtPlan.ts`)
`planDistricts(grid, tierGuid, lookup, {coverageFloor})`. Réécriture : le lattice aveugle sur bbox
est remplacé par un glouton max-cover qui suit le contour de l'île. Pipeline :
1. **Peigne double-rangée** : route toutes les `2·rh+1` lignes (2 rangées de maisons dos-à-dos) +
   épines verticales espacées (`max(24, 3·pas)`) → −40 % de routes vs v1, 86 % des lignes en maisons.
2. **Carte de demande** = positions où une maison TIENT (terre + accès route), calculée AVANT les
   services. C'est la cible de tous les placements (s'adapte au contour, ignore l'eau).
3. **GROS services (rayon>40) d'abord** (besoin d'espace contigu avant fragmentation) : glouton
   max-cover par type, score via table de sommes (SAT, fenêtre = carré inscrit dans le disque).
4. **PETITS en clusters** : centres choisis par max-cover sur la demande non couverte ; couverture
   suivie **exactement par type** (rayon plein, centres réels) → bien moins de clusters que le
   disque conservateur effR (les maisons entre 2 clusters comptent).
5. **Garantie** : tout type à 0 copie → spirale depuis le centroïde de terre (plus jamais de type absent).
6. **Réparation** (budget 12) : zones « presque couvertes » (≤2 types manquants) → copie ciblée du
   type fautif (max-cover sur ses cellules d'échec). Récupère clusters incomplets/masses éloignées.
7. **Maisons** : posées si à portée euclidienne de CHAQUE type. Si `coverageFloor<1` (slider UI),
   **remplissage partiel** : maisons hors-rayon ajoutées tant que chaque type reste ≥ seuil
   (invariant maintenu à chaque ajout). Maisons n'écrasent jamais une route (bug v1 corrigé).
8. **Routes élaguées en squelette** : BFS par composante, on garde ancres (routes adjacentes à un
   bâtiment) + chemins vers la racine → réseau connexe minimal, plus de peigne dans le vide.
   Services raccordés par **stub BFS court** (contourne eau/obstacles) → 0 bâtiment sans route.
- **Rayon de planification = `radius.range` d'abord** (ce que mesure `analyzeCoverage` euclidien),
  `streetRange` en repli — avant, l'écart 26 vs 22 faisait croire à des maisons couvertes qui ne
  l'étaient pas (85 % au lieu de 100 %).
- **Mesures** : rect 192² → **941 maisons, 100 % partout** (v1 : 759 à 97 %). Petite 06 (6763 terre) :
  floor=1 → **32 maisons 10/10 services à 100 %** (v1 : 30 maisons avec 3 types ABSENTS = invalide) ;
  floor=0.8 → **61 maisons** (min 90 %) ; floor=0.5 → **107 maisons** (min 77 %). ~30-90 ms (worker).
- **Vérifié live** : Petite 06 Nobles → 1 449 hab / 69 maisons, couverture min 100 %, net +1 314/min,
  manifeste 18 biens, 0 bâtiment invalide après placement (stubs OK).
- Tests districtPlan 4 → **8** (île-disque irrégulière : rien sur l'eau + tous types + couverture ≥95 ;
  seuil partiel ≥70 ; régression rendement 192² ≥800 ; accès route de chaque maison). Total **60 → 66**.
- Reste : couverture distance-rue réelle (vs euclidienne, conservatrice) ; tie-break des fenêtres SAT
  (préférer centre de masse) ; phase 2 auto-suffisante.

### Phase 2 planifiée (notée)
- Plan d'île **auto-suffisant** : `solve(includeProduction:true, includeWorkforce:true)`, caser
  résidences (tous tiers) + prod + champs + services de tous les tiers ; maximiser H(T4) sous
  « tout rentre + couverture ». Voir `C:\Users\rem34\.claude\plans\j-aimerais-que-tu-comprennes-rippling-crystal.md`.

### ✅ Fidélité au jeu — 4 chantiers (issus de GAME_MECHANICS.md §8)
**1. districtPlan v3 : couverture par DISTANCE-RUE** (la vraie mécanique, EffectScope
StreetDistance). Proxy euclidien (SAT) pour CHOISIR les positions, marquage/filtre EXACT par BFS
multi-source le long des routes (graines = routes ortho-adjacentes, dist ≤ streetRange — même
sémantique que `streetCoverage` de l'analyseur). Leçons structurelles durement apprises :
- Épines verticales DENSES (`STEPH+STEPV ≤ min portée locale`) sinon le détour de rue entre 2
  lignes du peigne dépasse la portée des petits services → chaque service ne sert que SA ligne.
- Cluster de petits services EN RANGÉE FLUSH contre une MÊME ligne de route (graines partagées),
  placement ATOMIQUE (segment où toute la rangée tient, simulé avant pose) — la boîte 2D et les
  replis individuels rendaient l'intersection des portées VIDE.
- ANNEAU de route périmétrique autour de chaque service posé (reconnecte les lignes coupées —
  les gros bâtiments décimaient le réseau local) + stub BFS si l'anneau est isolé.
- Ordre : cluster #1 (cœur résidentiel) → gros vague 1 (un de CHAQUE, décroissant, malus
  d'empiètement ×3 → ils s'installent en bordure) → clusters suivants (ciblent l'intersection
  avec les gros) → réparation GÉNÉRIQUE set-multi-cover (type le plus manquant sur les slots
  LIVE, budget 24) — remplace vague-2 et réparation ≤2-manquants (gains fantômes sur masque
  statique, slots à 5-6 manquants jamais réparés).
- Élagage routes par UNION DES CHEMINS BFS maison→service (chemins ⊂ cases atteintes → distances
  intactes → couverture préservée par construction ; le squelette BFS cassait la couverture).
- Mesures (street = plus dur que l'euclidien fantaisiste d'avant) : rect 192² **1056 maisons à
  100 % partout** ; Petite 06 complet 17, **seuils 41**. analyzeCoverage en mode rue dans l'UI.
**2. Citerne mappée** : besoins 68747 (Equites/Patriciens) & 68748 (Nobles) → bâtiments 19753/29526
(template AqueductDistributor, 4×4, rue 36) au catalogue (342 entrées, +AqueductProducer source
9×4 slot montagne). + Maison de jeu celtique 37176→g37177 (icône romaine réutilisée → match raté).
`SERVICE_BUILDING_OVERRIDES` dans build_economy.py. **0 service sans bâtiment.** localStorage v5.
**3. Seuils d'upgrade par catégorie** : build_economy extrait SupplyWeight + NeedCategoryType par
besoin + UpgradeThreshold par tier. `buildTierProfile(tierGuid, {needSelection})` (solve.ts,
partagé solveur↔planner) : mode "thresholds" = par catégorie, sous-ensemble coût/poids minimal
atteignant le seuil. Toggle UI dans PopulationPlanner + IslandPlanner (« Besoins : complets /
seuils d'upgrade »). En mode seuils le district ne pose QUE les services retenus et la
couverture/les trous ne comptent qu'eux. Tests golden (catégorie ≥ seuil).
**4. Terrain extrait des îles** : `tools/filedb.py` = parseur FileDB v3 ÉCRIT FROM SCRATCH
(rétro-ingénierie : flux [int32 size][int32 id], id≥0x8000=attribut paddé à 8, 0=fermeture ;
fin de fichier [off dict tags][off dict attribs][8][0xFFFFFFFD], dict=[count][uint16 ids][noms]).
`tools/build_terrain.py` → `src/data/terrain.generated.json` (55 îles, 64 Ko) :
- **Slots** depuis `<île>.a7minfo` ObjectMetaInfo/RandomSlotObjects (groupes = GUID d'asset Slot :
  2882/5281/37926/38473 montagne, 2969/38471 rivière, 5282 marais, 3766x blockers ignorés),
  positions float en tuiles (x, h, z).
- **Rivières** depuis `<île>.a7m` (RDA imbriqué) → gamedata.data → WorldManager/RiverGrid
  (bitmask LSB-first 1 bit/tuile). HeightMap dispo (641² uint16, TerrainManager) — pas stockée
  encore (pente d'aqueduc = futur).
- App : `GridShape.rivers/slots`, loadIsland les charge (rivière → non constructible), rendu
  canvas (rivière bleu clair, ▲ montagne, ● rivière, ● marais). **Vérifié live : slots-rivière
  exactement sur la rivière** (orientation x/z↔x/y correcte).
Tests **66 → 68**. tsc OK. Reste pour la suite : enforcement placement sur slot (mines/argilière/
source), budget d'eau par source (100u, Bains 25/Forum 15/ferme 5), pente d'aqueduc (HeightMap).

### 📖 Mécaniques réelles du jeu décodées → `.claude/GAME_MECHANICS.md`
Recherche web + fouille assets.xml (juin 2026). Découvertes majeures : services = **distance par la
RUE** (EffectScope StreetDistance, pas euclidien) ; **seuils d'upgrade par catégorie de besoins**
(SupplyWeight + UpgradeThreshold — base du vrai max-éco) ; **citerne = besoin T3/T4** (need 68747,
bâtiment 19753 jamais mappé = le « service sans bâtiment » des trous UI) ; **Bains/Forum = Wonders à
eau OBLIGATOIRE** (25/15 sur 100 par source d'aqueduc) ; **MaxTransporterRange ~30** (prod doit être
à ≤30 de rue d'un entrepôt). Liste des écarts planner→jeu priorisée dans le fichier (§8). LIRE AVANT
toute refonte du planner.

## 7. Pistes suivantes
- Marquer besoins obligatoires vs luxe (NeedCategory/SupplyWeight) pour fiabiliser max-éco.
- Capacité éditable dans l'UI ; rendu icônes sur canvas ; couleur route reliée vs isolée.
- Calibrer/valider tailles vs anno.land ; placement diagonal ; terrain.
- Net réaliste : modéliser la vente effective (routes de commerce) au-delà du potentiel marchand.

---

## 8. Historique branches (toutes mergées dans main)
- `main` initial: éditeur + extraction catalogue + optimiseur (liste/chaîne) + planificateur population.
- `feature/islands`: îles réelles + capacités calculées + bilan bonus.
- `feature/road-network`: connexité route→comptoir.
- `feature/economy-net`: net éco (entretien), planificateur production, max-économie.

Mémoire perso aussi: `C:\Users\rem34\.claude\projects\F--Code-annoDesigner\memory\anno117-designer-projet.md`.
