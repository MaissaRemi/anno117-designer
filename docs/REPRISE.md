# Reprise du projet — état au 11/11/2026

Point d'entrée d'une nouvelle session. Le travail se fait sur la branche **`dev`** ; `main` l'a
reçue le 11/11/2026 (avance rapide, en local). Rien ne se pousse sans l'accord de Rémi.

Plan du document : les objectifs, comment l'outil fonctionne, ce qui a été fait (en résumé, le
détail est archivé), ce qui reste à faire, les questions à trancher en jeu, les pièges.

## Les objectifs du projet

1. **Planifier une partie entière d'Anno 117** — c'est l'objectif de Rémi. Toutes les îles d'une
   partie, des deux provinces (Latium et Albion) : des îles PRINCIPALES qui ne portent que des
   maisons et tous leurs services (objectif au choix : le plus de gains, d'habitants ou de
   maisons), et des îles de PRODUCTION qui fabriquent, ouvriers compris, tout ce que les
   principales consomment. L'outil répartit la production, chiffre les flux entre îles, dit ce
   qui manque et quelles îles acheter, et donne le plan de chaque île à reconstruire en jeu.
2. **Planifier une île** — trois moyens, dans l'onglet Planifier : « Ma commande » (le joueur
   dit ce qu'il veut, le moteur dresse la nomenclature et dispose l'île), « Remplir l'île » (le
   plus d'habitants d'un palier) et « Île de production » (des biens et leur débit, ou le
   maximum que l'île tient).
3. **Rester fidèle au jeu** — aucune valeur tapée à la main : bâtiments, économie, îles,
   terrain, sauvegardes sont lus dans les fichiers du jeu. Toute règle de jeu se vérifie dans les
   fichiers ou se teste en jeu par Rémi.

## Comment l'outil fonctionne

```
fichiers du jeu (.rda) ──tools/*.py──▶ src/data/*.generated.json (versionnés)
                                              │
sauvegarde .a8s ──src/monde/sauvegarde──▶ configuration d'un monde (IndexedDB)
                                              │
            src/economy (solveur à point fixe : population → besoins → production → main-d'œuvre)
                                              │
  src/commande (nomenclature, quartiers en îlots, production posée) ◀── île de production
  src/optimizer (remplir l'île : trame de rues, services, eau, emplacements, comptoir)
                                              │
            src/monde (calcul d'un monde : îles principales, répartition, pose, flux, achats)
                                              │
            src/ui (React) · src/render (Canvas) · Web Workers pour chaque moteur
```

- **Données** (`src/data`) : catalogue des bâtiments (emprises, portées, côtiers avec quai et
  partie dans l'eau), économie (paliers, besoins, chaînes, main-d'œuvre, dieux), 55 îles (masque,
  terre constructible, eau côtière, relief, rivières, hauteurs, emplacements avec leur
  `ObjectId`). Régénérées par `tools/build_*.py`, `tools/extraire_quais.py`,
  `tools/extraire_ids_emplacements.py`.
- **Règles** (`src/engine`) : fonctions pures sans React — géométrie, terrain, raccordement,
  réseau routier en graphe. Les moteurs et l'éditeur partagent les mêmes règles.
- **Moteurs d'île** : `src/commande` (« Ma commande » et « Île de production », `planifierCommande`)
  et `src/optimizer` (« Remplir l'île », `planIslandImport`). Ils tournent en cases entières
  (`downscaleGrid`), le résultat est reprojeté en demi-cases pour l'éditeur.
- **Monde** (`src/monde`) : `configuration.ts` (modèle, réglages de la partie), `calcul.ts`
  (orchestration, recalcul incrémental par empreinte), `repartition.ts` (devis à moins d'1 ms,
  budgets terre / côte / emplacements, suggestions d'achat), `sauvegarde/` (lecteur RDA, FileDB,
  partie), `stockage.ts` (IndexedDB).
- **Interface** (`src/ui`) : Éditeur, Planifier (trois modes), Monde (configurations,
  assistant, import, calcul, résultat avec flux, déficits, bilan et achats).

## Remettre le projet en route

```
git clone https://github.com/MaissaRemi/anno117-designer.git
cd anno117-designer
git switch dev
pnpm install
pnpm dev          # application sur http://localhost:5173
pnpm test         # ~555 tests, 4 à 6 min ; pnpm test:fast écarte les balayages lourds
```

Machine actuelle : Windows, projet dans `C:\Users\rem34\Projects\anno117-designer`, jeu dans
`C:\Program Files (x86)\Ubisoft\Ubisoft Game Launcher\games\Anno 117 - Pax Romana\maindata`
(patch 210). Les données extraites (`src/data/*.generated.json`, patch 200) sont versionnées :
l'application et les tests n'ont besoin de rien d'autre. `tools/rda_extract.py` lit les
archives `.rda` du jeu (`list`, `get`, `dump`) pour aller vérifier une règle dans les fichiers ;
`tools/filedb.py` lit le format FileDB (îles, sauvegardes). Sauvegardes de Rémi :
`Documents/Anno 117 - Pax Romana/accounts/<compte>/<profil>/*.a8s`.

Outils installés pour Claude Code (10/11/2026, portée utilisateur) : **Graphify** 0.9.105
(`pip install graphifyy` + `graphify install` ; `/graphify .` construit le graphe de
connaissances du dépôt dans `graphify-out/`) et **Ponytail** 5.3.3 (plugin
`ponytail@ponytail`, place de marché `DietrichGebert/ponytail` : écrire moins de code ; commandes
`/ponytail`, `/ponytail-review`, `/ponytail-audit`…). Actifs à la session suivante.

## Analyser le projet (pour un nouveau modèle)

Dans l'ordre, du plus court au plus détaillé :
1. ce document (objectifs, état, suite) ;
2. `.claude/architecture.md` : modules, flux de données, workers, tests, outils, code en sommeil ;
3. `.claude/decisions.md` (pourquoi) et `.claude/conventions.md` (comment écrire ici) ;
4. `.claude/functions-index.md` : chaque export avec sa ligne et sa centralité (régénérer par
   `python tools/gen_functions_index.py`) ;
5. `.claude/GAME_MECHANICS.md` : règles du jeu prouvées ([FICHIERS], [IN-GAME]) et ouvertes ;
6. le **graphe Graphify** (`graphify-out/`, non versionné, à reconstruire sur une autre
   machine par `/graphify .` dans Claude Code, ~5 min et ~0,8 M de jetons pour les documents) :
   `graphify-out/GRAPH_REPORT.md` (nœuds centraux, communautés, liens surprenants),
   `graphify query "question"`, `graphify explain "Symbole"`, `graphify path "A" "B"`,
   `graphify-out/wiki/` (un article par communauté). Pour que le code se mette à jour seul après
   chaque commit (analyse AST gratuite), lancer une fois `graphify hook install` ;
   `graphify claude install` ajoute au `CLAUDE.md` du projet la consigne de consulter le graphe
   (tous deux à lancer par Rémi : le mode automatique refuse ces réglages persistants). Un
   document modifié demande `/graphify . --update`. `.graphifyignore` écarte l'index généré et les copies de travail.
   Angle mort connu : un catalogue passé en paramètre aux moteurs ne crée pas de lien d'analyse ;
   `.claude/architecture.md` pose ces liens. Les nœuds de données se désignent par leur
   identifiant (`src_data_catalog_generated`), pas par le nom du fichier.

## Conventions du dépôt

- Échanges avec Rémi en français. Le dépôt est **en français** : commentaires, documentation,
  messages de commit (sans accents dans les commits). Garder cette cohérence.
- Ne jamais pousser sans l'accord de Rémi. Les commits sont libres.
- Toute règle de jeu se vérifie dans les fichiers du jeu, ou se demande à Rémi qui la teste en
  jeu — jamais d'extrapolation présentée comme un fait.
- Raisonner à l'échelle de l'île et de l'objectif choisi (habitants, maisons…), pas chipoter
  sur quelques cases perdues localement.
- PowerShell 5.1 : `R` est un alias réservé ; un message de commit avec guillemets passe par
  `git commit -F fichier`.

## Ce qui a été fait

En résumé. Le détail de chaque chantier (mesures, causes, règles de la diagonale vérifiées en
jeu, format de la sauvegarde) est dans `docs/archive/REPRISE-detail-2026-11-11.md`.

- **Moteur d'une île** (26–30/10) : « Ma commande » (nomenclature, îlots, production posée),
  portée selon le type de route, géométrie des îles lue dans le jeu, emplacements de montagne,
  ponts, côtiers à cheval sur l'eau, dieux tutélaires, eau des Patriciens, prix du bilan, plans
  au choix (`optimizer/plansAuChoix.ts`). Trame diagonale expérimentale
  (`optimizer/cadreDiagonal.ts`) : ne gagne nettement que sur small_07.
- **Trame mêlée : EN PAUSE** (gain du même ordre que le bruit entre deux plans droits). Restent
  utilisables : le réseau routier en graphe (`engine/reseauRoutier.ts`), le golden de la trame
  droite (`pnpm vitest run src/optimizer/trameDroite.golden.test.ts`, `GOLDEN=1` pour les 15
  cas, `-u` pour recapturer un changement VOULU), les liaisons diagonales (option
  `liaisonsDiagonales`, désactivée). La portée est une LONGUEUR de trajet : une case de route
  diagonale coûte environ 1,4 pas.
- **Raccordement au comptoir** (`optimizer/kontor.ts`, `planLattice.ts`) : une maison rasée
  coûte plus qu'un détour, la réparation repasse sur ses échecs et raccorde aussi le bâtiment,
  les poches murées restent vides. Latium : 31 → 1 service sans accès au comptoir.
- **Île de production** (30/10) : mode de Planifier ; objectif dans la commande, productivité
  (dieu + saisie, ADDITIONNÉES), « sur l'île, sinon importé » avec la raison. L'onglet
  Production hors île et l'optimiseur à recuit sont retirés.
- **Monde, étapes 1 à 4** (30/10–04/11) : onglet Monde, configurations dans IndexedDB,
  assistant, calcul (îles principales, répartition sous trois budgets terre / côte /
  emplacements, pose, rattrapage, flux, déficits, bilan), suggestions d'achat, recalcul
  incrémental par empreinte, argent des îles de production, pose côtière en trois zones (quai,
  eau, reste de l'emprise). Limites connues : estimation de terre optimiste pour les fermes et
  les bâtiments à aire libre ; les ouvriers de haut palier consomment des biens de luxe.
- **Import d'une sauvegarde `.a8s`** (04–05/11, `monde/sauvegarde/`) : îles, fertilités,
  propriétaires, rotation, position ; emplacements inactifs retirés du calcul ; réglages de la
  partie (consommation, entretien). LES DONNÉES EXTRAITES SONT AU CRAN FAIBLE : seul le calcul
  du monde applique les réglages. Impôts (`SetupTaxes`) non appliqués.

### Audit et qualité des plans (10–11/11/2026)

Audit complet : `docs/AUDIT-2026-11-10.md` (mesures, causes, plan en cinq étapes). Constat
central : la suite vérifiait qu'un plan est valide, jamais qu'il est bon, et les consignes de
Rémi n'étaient écrites nulle part.

- **Étape 0** : `.claude/exigences.md` (importé par `CLAUDE.md`), mesure `regroupement`
  (`optimizer/planQuality.ts`), panneau `optimizer/qualite.panneau.test.ts` (seuils en cliquet).
- **Étapes 1 et 2, « Ma commande »** (`commande/ilots.ts`) : îlots partiels le long des côtes
  (en dernier recours), un seul réseau de routes, petits services collés à la colonne de route,
  gain minimal d'une copie de plus (`PART_GAIN`), recouvrement une fois la ville faite, et trois
  façons de poser essayées dans l'ordre (`disposerQuartiers`). medium_01, 450 Patriciens,
  pavée : 333 → 450 logés, 61 → 46 services, 61 → 7 % de services en pâté.
- **Étape 1, « Remplir l'île »** (`optimizer/planLattice.ts`) : une grappe de petits services
  par tranche de portée (`TRANCHE` = 1,25, choisi par Rémi) et jamais deux copies d'un même
  service côte à côte. Services en pâté, pavée : 75–83 % → 40–65 %, autant de maisons au palier
  au total de quatre îles (mais 563 → 516 sur medium_01). En terre : 86 → 56 % sur sept îles,
  −3 % d'habitants. Le plan diagonal n'est plus proposé sur small_05 (dominé) ; il l'est sur
  small_07.
- **Étape 3, île de production** (`commande/production.ts`, `prodlayout`) : lots coupés en
  demi-chaînes et traités par niveau de taille, pose dans la forme de la terre libre, aire
  libre des bûcherons et ruchers dans le plan et limitée à l'aire exigée, champs dessinés dans
  l'aperçu. Part de l'objectif posée : medium_01 71 → 83 %, small_06 40 → 100 %, large_03
  64 → 100 %.
- **Étape 4, monde** (`monde/calcul.ts`, `monde/repartition.ts`, `ui/MondeView.tsx`) : bouton
  « Conseiller l'île principale » (`conseillerPrincipales` : chaque île à moi planifiée seule,
  classée selon l'objectif) ; rattrapage sur le monde tel qu'il est posé, trois tours, île
  écartée bien par bien ; version des moteurs dans les empreintes (`VERSION_CALCUL`, à
  augmenter quand un moteur change ce qu'il pose) ; résultat enregistré dans la configuration à
  jour. Monde d'essai, hauteurs comprises : demande de la ville servie 64 → 66 % (il est saturé).
- **Étape 5, entretien** (11/11) : documents historiques dans `docs/archive/`, ce document
  ramené à l'état et à la suite, `persist/blueprints.ts` et le worktree d'agent supprimés, un
  seul type `DefLookup`, `main` aligné sur `dev` en local.
- **Devis d'une île de production** (11/11 ; `monde/repartition.ts`, `monde/calcul.ts`,
  `commande/nomenclature.ts`, `optimizer/slotPlan.ts`) : mesuré bien par bien, ce que la
  répartition promet à une île contre ce que la pose tient (deux îles, hauteurs). L'aire libre
  des bûcherons et ruchers entre dans l'emprise (la terre réelle valait 3 à 9 fois le devis) ;
  la côte se compte en bâtiments que la carte accueille (`capaciteCote`, tenue à 75 %) et non
  plus en pourcentage par province ; côte et emplacements en bâtiments entiers ; le raccord
  d'une mine franchit une rivière (large_03 : 4 → 9 mines posées sur 9). Monde d'essai : demande
  de la ville servie 66 → 73 %, affecté posé 79 → 86 %, déficits 89 → 74 u/min.
- **Produire le maximum** (12/11 ; `commande/maximum.ts`, case de « Île de production ») : les
  débits saisis deviennent des proportions, et le moteur cherche en POSANT (huit poses au plus)
  le plus grand multiple que l'île tient en entier ; un bien borné par les emplacements
  plafonne l'île, et le plan dit pourquoi. medium_01 : 33,7 pains et 22,5 tuniques par minute
  tenus (28 pains sur 40 demandés avant). Une à deux minutes sur une grande île.
- **Reste de l'audit** : main-d'œuvre sur ce qui est posé.

## Ce qui reste à faire, par intérêt (11/11/2026)

Feuille de route détaillée : `.claude/ROADMAP.md`.

**Planification d'un monde** (l'objectif principal)
1. **Devis d'une île de production, ce qui reste faux** (sonde du 11/11) : les quartiers
   d'ouvriers de haut palier (services et eau : 2 à 3 fois la terre du devis quand l'île est
   pleine) ; un ou deux emplacements de montagne pris par les sources d'aqueduc, ou murés par
   ce qui est posé avant les mines ; plusieurs biens côtiers qui se disputent les mêmes places.
   Les fermes, elles, sont justes (terre prise à 0,92 du devis).
2. **Ouvriers des ateliers de luxe** : leurs biens de luxe alourdissent la demande ; le rendre
   visible dans le résultat (part de la demande due aux ouvriers).
3. **Navires** (étape 5 de la conception) : temps de trajet entre îles à partir des positions
   lues dans la sauvegarde, puis nombre de navires par flux.
4. **Plan de développement par étapes** : dans quel ordre construire les îles.
5. **Main-d'œuvre des îles principales au réglage d'entretien** : leurs services restent au cran
   Faible (cascade interne au moteur d'île).
6. **Réglages dans les outils d'une île** : « Remplir l'île » et « Île de production » sont au
   cran Faible ; une partie standard (Moyen) consomme 25 % de plus et demande 22 % de
   main-d'œuvre et d'entretien en plus.
7. **Impôts de la partie** (`SetupTaxes`) : à brancher une fois leur effet établi en jeu.
8. **Reconnaissance par la minimap** : mise de côté par Rémi (voir la section de l'import).
9. **Noms des villes** dans l'import (`CityNameGuid`).

**Moteur d'une île** (gain faible, reportés)
10. Un service sans accès au comptoir compte encore dans la couverture (un seul cas en Latium).
11. Plan diagonal non posable dans l'éditeur ; trame mêlée en pause.

**Entretien du dépôt**
12. `ui/IslandPlanner.tsx` (553 lignes) n'a pas de test de composant : sortir la construction
    de la requête dans un module pur.
13. React 18, Vite 5, Vitest 2 et Zustand 4 ont une à deux versions majeures de retard, sans
    urgence.

## Questions à trancher en jeu (Rémi)

1. **Sens de la rotation** des îles importées : la vignette de Petite 02 (DLC) d'une
   configuration importée est-elle comme sur la minimap, ou en miroir ?
2. **Emplacement de montagne inactif** (sans gisement) : accepte-t-il une source d'aqueduc ?
   Supposé que non.
3. **Impôts** : dans Maximilia Maxima (impôts « Spare »), une maison de Plébéiens au complet
   rapporte-t-elle 17 ?
4. **Bâtiment côtier** : la partie de l'emprise ni quai ni eau accepte-t-elle terre ET eau ?
5. Anciennes : sens de `UpgradeThreshold`, consommation par maison ou par habitant, effet d'un
   manque de main-d'œuvre (`.claude/GAME_MECHANICS.md`, §13).

## Pièges connus

- Après une fusion, le serveur de développement peut garder des modules périmés (page blanche,
  « does not provide an export named … ») : le redémarrer.
- Une sonde de mesure doit passer les hauteurs de l'île (`heightsOf`) comme le worker de
  l'application, sinon ses résultats diffèrent de l'écran. Vécu le 10/11/2026 : un plan de
  « Ma commande » à 450 maisons au test en logeait 0 à l'écran.
- Les moteurs tournent en cases entières (`downscaleGrid`) ; le résultat est reprojeté en
  demi-cases pour l'éditeur (`scaleResultToHalfTile`), alternatives comprises — un plan
  diagonal garde son repère.
