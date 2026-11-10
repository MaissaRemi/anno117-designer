# Architecture — Anno 117 Designer (10/11/2026)

Carte du code pour qui arrive sur le projet. État et suite : `docs/REPRISE.md` ; décisions :
`.claude/decisions.md` ; repère des fonctions : `.claude/functions-index.md` ; règles du jeu :
`.claude/GAME_MECHANICS.md`. Graphe de connaissances (s'il a été construit) :
`graphify-out/GRAPH_REPORT.md`, interrogeable par `graphify query "…"`.

## 1. Vue d'ensemble

```
 fichiers du jeu (.rda, maindata)                sauvegarde du joueur (.a8s)
          │ tools/*.py (Python)                            │ src/monde/sauvegarde (navigateur)
          ▼                                                ▼
 src/data/*.generated.json (versionnés)        ConfigurationMonde (IndexedDB)
          │ import JSON direct                             │
          ▼                                                ▼
 src/data  ──▶  src/state/store (catalogue modifiable)  ──▶  src/ui (React)
          │                                    │ requête + catalogue (postMessage)
          ▼                                    ▼
 src/economy (solveur, paliers)     Web Workers : islandPlanWorker, planifierWorker
 src/engine  (règles pures)                    │
          ▲                                    ▼
          └──── src/optimizer (Remplir l'île) · src/commande (Ma commande, île de production)
                                               │
                                     src/monde/calcul (un monde : orchestre les workers)
                                               │
                                 résultat ──▶ éditeur (src/render, Canvas 2D)
```

Pile : React 18 + TypeScript + Vite, état Zustand, Vitest. Aucun serveur : tout tourne dans le
navigateur ; les moteurs lourds dans des Web Workers.

## 2. Les modules de `src/`

| Module | Rôle | Fichiers clés |
|---|---|---|
| `model/` | Types partagés et fabriques. `BuildingDef` (un type de bâtiment du jeu), `GridShape` (une île ou une grille libre), `Layout`, `PlacedBuilding`, `RoadTile` | `types.ts`, `factories.ts`, `entrepot.ts`, `serialize.ts` |
| `data/` | Données extraites du jeu et leur décodage : catalogue, économie, 55 îles (masque RLE), terrain (zones, relief, rivières, emplacements avec `ObjectId`, hauteurs) | `seed.ts`, `islands.ts`, `islandGrid.ts`, `terrain.ts`, `*.generated.json` |
| `engine/` | Règles PURES, sans React, partagées par l'éditeur et tous les moteurs : géométrie et rotations, terrain d'un bâtiment (côtiers : quai / eau / reste), raccordement routier, portées selon la route, réseau routier en graphe (cases droites et losanges diagonaux) | `rules.ts` (`makeLookup`, `terrainConvient`, `roadConnected`), `geometry.ts`, `roads.ts`, `reseauRoutier.ts` |
| `economy/` | Économie du jeu : paliers et besoins, évaluateur de palier par masque de services, solveur à point fixe population → besoins → production → main-d'œuvre, attributs et viabilité, dieux tutélaires, unicité, couverture | `economy.ts`, `needsModel.ts`, `solve.ts`, `attributes.ts`, `dieux.ts`, `workforce.ts` |
| `optimizer/` | « Remplir l'île » (`planIslandImport`) : recette de services, trame de rues, maisons, eau (aqueducs), emplacements, comptoir, réparation, plans au choix, trame diagonale. Aussi les invariants des plans et l'adaptateur demi-tuile | `islandPlan.ts`, `planLattice.ts`, `waterPlan.ts`, `slotPlan.ts`, `kontor.ts`, `halfTileAdapter.ts`, `invariants.ts`, `plansAuChoix.ts`, `cadreDiagonal.ts` |
| `commande/` | « Ma commande » et « Île de production » (`planifierCommande`) : nomenclature (devis), quartiers en îlots, production posée autour (via `prodlayout`), argent | `nomenclature.ts`, `ilots.ts`, `production.ts`, `planifier.ts`, `disposition.ts` |
| `prodlayout/` | Placeur de lots de production (blueprints) : panier, chaînes en ratios exacts, boîte, sortie de route. Appelé par `commande/production.ts` | `index.ts` (`planFromBasket`), `pack.ts`, `search.ts`, `chain.ts`, `basket.ts` |
| `monde/` | Planification d'une partie : configuration et réglages, calcul (îles principales, répartition, pose, flux, achats), stockage IndexedDB, import de sauvegarde | `configuration.ts`, `calcul.ts`, `repartition.ts`, `stockage.ts`, `fertilites.ts`, `sauvegarde/{rda,filedb,partie}.ts` |
| `state/` | Store Zustand : catalogue, grille, plan, outils, annulation | `store.ts` |
| `persist/` | Sauvegarde locale (localStorage, migrations), JSON, PNG, profil de ressources | `local.ts`, `json.ts`, `party.ts` |
| `render/` | Dessin Canvas 2D de la scène et export d'image | `draw.ts`, `exportImage.ts` |
| `ui/` | Interface : Éditeur, Planifier (trois modes), Monde (configurations, assistant, résultat) | `shell/AppShell.tsx`, `PlanifierView.tsx`, `MondeView.tsx`, `monde/*` |

Schéma des dépendances entre modules, généré depuis les imports : README, section Architecture
(`python tools/gen_architecture_diagram.py` le régénère).

## 3. Flux de données à connaître

### Le catalogue, de bout en bout (ce que le graphe ne voit pas)
`tools/build_catalog.py` (+ `extraire_quais.py`) → `src/data/catalog.generated.json` → `seed.ts`
(`seedCatalog`) → store (`useStore`, modifiable dans l'éditeur du catalogue) → passé EN PARAMÈTRE
à chaque requête de moteur (`IslandPlanRequest.catalog`, `CommandeRequete.catalog`,
`OptionsCalcul.catalog`) → `makeLookup(catalog)` → `DefLookup` dans tous les moteurs.
Exception : `monde/fertilites.ts` importe le JSON directement (il ne lit que l'emplacement requis).
**Dans le graphe Graphify** : les imports de JSON y sont (nœud `src_data_catalog_generated`, à
désigner par cet identifiant : il n'a pas de libellé « catalog.generated.json »), mais un
catalogue PASSÉ EN PARAMÈTRE aux moteurs ne crée aucun lien d'analyse statique. Ce document pose
ces liens (`shares_data_with` : catalogue → `seedCatalog` → `useStore` → `makeLookup`).

### Les autres données générées
- `economy.generated.json` → `economy/economy.ts` (`economy`, `tierByGuid`, `worldOf`…).
- `islands.generated.json` → `data/islands.ts` (masque RLE, `islandById`, `regionOfIsland`).
- `terrain.generated.json` (+ `terrain.heights.generated.json`, chargé à la demande) →
  `data/terrain.ts` → `data/islandGrid.ts` (`buildIslandGrid`).

### Grilles : demi-cases à l'écran, cases entières dans les moteurs
L'éditeur travaille en demi-cases (`cellsPerTile = 2`). Les moteurs tournent en cases entières :
`downscaleGrid` à l'entrée, `scaleResultToHalfTile` à la sortie (`optimizer/halfTileAdapter.ts`).

### Web Workers
`optimizer/runIslandPlan.ts` → `islandPlanWorker.ts` → `planIslandImport` ;
`commande/runPlanifier.ts` → `planifierWorker.ts` → `planifierCommande`. Chacun rend
`{ promise, cancel }`. Le calcul d'un monde (`monde/calcul.ts`) reçoit ces deux exécuteurs
(`Executeurs`) et les lance en parallèle ; les tests lui passent des moteurs factices
(`monde/orchestration.test.ts`).

### Le calcul d'un monde (`calculerMonde`)
1. Grille de chaque île, sans les emplacements inactifs de la partie (`sansEmplacementsInactifs`).
2. Îles principales en parallèle (`planIslandImport`, objectif argent / habitants / maisons).
3. Demande totale moins les mines, répartie sur les îles de production par devis
   (`repartition.ts` : `devisIle`, `repartir`, budgets terre / côte / emplacements), en
   rebouclant sur les besoins des ouvriers.
4. Pose réelle de chaque île de production (`planifierCommande` avec `objectif`), rattrapage.
5. Flux entre îles, déficits avec raison, bilan (argent compris), suggestions d'achat
   (`suggererAchats`). Réglages de la partie : consommation et entretien (facteurs).
6. Recalcul incrémental : chaque île porte l'empreinte de ses entrées (`empreinte`).

### L'import d'une sauvegarde
`.a8s` → `rda.ts` (`lireIndexRda`, `extraireRda`, `fichierDeSauvegarde` : flux zlib + 12 octets de
fin) → `filedb.ts` (`lireFileDb` avec filtre de chemins) → `partie.ts` (`lirePartie` :
`GameSessions` → une session par province → `MapTemplate` et `AreaInfo` ; `gamesetup.a7s` →
réglages) → `configurationDepuisPartie`. Format détaillé : `GAME_MECHANICS.md` §17.

## 4. Tests

Vitest, fichiers `*.test.ts` à côté du code (~540 tests). Catégories :
- unitaires rapides (règles, solveur, fabriques, lecteurs de sauvegarde) ;
- **golden** de la trame droite (`optimizer/trameDroite.golden.test.ts`, `GOLDEN=1` pour les 15
  cas, `-u` pour recapturer un changement VOULU) ;
- **balayages lourds** (`*.sweep.test.ts`, `calcul.test.ts`), écartés par `pnpm test:fast` ;
- tests sur VRAIES données : îles du catalogue, sauvegarde de Rémi (sautés si absente).
Invariants de tout plan (pas de chevauchement, rien hors de l'île, tout relié au comptoir) :
`optimizer/invariants.ts` (`checkPlan`), utilisé par les tests.

## 5. Outils Python (`tools/`)

| Outil | Produit |
|---|---|
| `rda_extract.py` | lecteur d'archives RDA 2.2 (`list`, `get`, `dump`), base de tout |
| `filedb.py` | lecteur FileDB v3 (îles `.a7minfo`, `.a7m`, sauvegardes) |
| `build_catalog.py` | `catalog.generated.json` (emprises `BuildBlocker`, portées, côtiers) |
| `build_economy.py` | `economy.generated.json` (paliers, besoins, chaînes, main-d'œuvre, dieux) |
| `build_islands.py`, `build_terrain.py` | îles et terrain |
| `extraire_quais.py`, `extraire_ids_emplacements.py` | quais des côtiers, `ObjectId` des emplacements |
| `extract_icons.py` | icônes (non versionnées) |
| `gen_architecture_diagram.py` | schéma du README depuis les imports |
| `gen_functions_index.py` | `.claude/functions-index.md` |

## 6. Code en sommeil ou vestigial (vérifié le 10/11/2026)

- `optimizer/maillageTriangles.ts` : socle de la trame mêlée (en pause), utilisé seulement par
  ses tests et ceux de `engine/reseauRoutier`.
- `persist/blueprints.ts` : bibliothèque de blueprints de l'ancien onglet Production (retiré le
  30/10) ; plus importée que par son test. Candidat au retrait.
- `optimizer/types.ts` (`OptimizeResult`) : nom hérité de l'ancien optimiseur à recuit, toujours
  le format de sortie posé dans l'éditeur.
- `prodlayout/chain.ts` définit `Lookup`, même signature que `engine/rules.ts` `DefLookup`.
