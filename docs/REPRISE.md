# Reprise du projet — état au 10/11/2026

Point d'entrée d'une nouvelle session. Tout le travail est sur la branche **`dev`** (poussée
sur GitHub, à jour au commit `557af5b` et suivants) ; `main` n'a pas été mis à jour depuis.

Plan du document : les objectifs, comment l'outil fonctionne, ce qui a été fait (par chantier,
avec les mesures), ce qui reste à faire, les questions à trancher en jeu, les pièges.

## Les objectifs du projet

1. **Planifier une partie entière d'Anno 117** — c'est l'objectif de Rémi. Toutes les îles d'une
   partie, des deux provinces (Latium et Albion) : des îles PRINCIPALES qui ne portent que des
   maisons et tous leurs services (objectif au choix : le plus de gains, d'habitants ou de
   maisons), et des îles de PRODUCTION qui fabriquent, ouvriers compris, tout ce que les
   principales consomment. L'outil répartit la production, chiffre les flux entre îles, dit ce
   qui manque et quelles îles acheter, et donne le plan de chaque île à reconstruire en jeu.
2. **Planifier une île** — trois moyens, dans l'onglet Planifier : « Ma commande » (le joueur
   dit ce qu'il veut, le moteur dresse la nomenclature et dispose l'île), « Remplir l'île » (le
   plus d'habitants d'un palier) et « Île de production » (des biens et leur débit).
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
pnpm test         # ~550 tests, ~1 min 50 ; pnpm test:fast écarte les balayages lourds
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

### Moteur d'une île (26–30/10/2026)

Détail et mesures : `docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`, puis
`docs/superpowers/plans/2026-10-29-portees-motifs-eau.md`, puis
`docs/superpowers/specs/2026-10-29-diagonales-moteur.md` (le plus récent).

- Refonte du moteur d'île : onglet « Ma commande » (nomenclature, îlots, production posée).
- Portée selon le type de route, copies en trop retirées, corridors d'eau, objectif
  « maximum de maisons », un seul écran Planifier.
- Géométrie des îles lue dans le jeu (terre constructible, eau côtière, relief), emplacements
  de montagne prédéfinis, ponts sur les rivières, bâtiments côtiers à cheval sur l'eau.
- Dieux tutélaires branchés (dévotion = Foi de l'île, productivité, habitants de Cérès).
- Eau fiable pour les Patriciens ; prix du bilan (un bilan sain vaut quelques habitants).
- **Plans au choix** : jusqu'à trois plans contrastés (front de Pareto : habitants, maisons
  au palier, bilan, argent), présentés en cartes (`optimizer/plansAuChoix.ts`).
- **Trame diagonale expérimentale** (`optimizer/cadreDiagonal.ts`) : l'île planifiée dans la
  grille tournée de 45°, proposée parmi les plans au choix (option avancée). Une fois la portée
  comptée en longueur et le raccordement au comptoir corrigé, elle ne gagne plus nettement que
  sur small_07 (+26 %).
- **Maillage de triangles** (`optimizer/maillageTriangles.ts`) : 4 triangles par case, socle
  commun aux trames droite et diagonale (étape 1 de la trame mêlée).

### Règles du jeu établies pour la diagonale (vérifiées en jeu par Rémi)

- Route diagonale = losanges de côté √2 centrés sur les coins de la grille : √2 de large en
  travers, 2 cases sur une ligne horizontale.
- Maison 3 × 3 droite = 2 × 2 cases de route diagonale une fois posée en biais.
- **La portée est une longueur de trajet** : une case de route diagonale, longue de √2,
  coûte environ 1,4 pas (captures de Rémi : depuis un même embranchement, la zone servie
  s'arrête à la même distance réelle sur la branche droite et sur la branche diagonale). La
  règle notée d'abord, « une case diagonale = un pas », était FAUSSE ; le gain de la trame
  diagonale (+12 à +24 %) a été mesuré avec elle et est à recalculer.
- **Jonction droite / diagonale par recouvrement** : la route droite entre dans la route en
  biais, sa dernière case est la case entière de la bande diagonale sur sa ligne ; la case
  d'avant est à moitié recouverte par le pavage diagonal. Pas de contact par une simple pointe.
- Raccordement par un coin : valable (maison droite / route diagonale, service diagonal /
  route droite). La portée part de chaque point de contact.
- Les demi-cases au bord d'une route diagonale sont constructibles par un bâtiment diagonal.
- La route du jeu est un graphe de tronçons (`MeshGraph`), pas une peinture de cases.

### Où en est la trame mêlée : EN PAUSE

Décidé après mesure (section « étape 3 : étude préalable » de l'étude des diagonales) : le
gain espéré d'une île droite ici et en biais là est du même ordre que le bruit entre deux plans
droits, et l'orientation des côtes ne prédit rien. Les étapes 3 à 6 (carte d'orientation,
squelette mêlé, placement global, comparaison) ne sont pas commencées.

Ce qui en reste, utilisable :
- le **réseau routier en graphe** (`engine/reseauRoutier.ts`), cases droites et losanges, sous
  l'analyseur, `streetGrid`, `planLattice`, le comptoir, la réparation, l'élagage et l'eau.
  Conception et bilan : `docs/superpowers/specs/2026-10-29-reseau-routier-graphe.md` ;
- le **golden de la trame droite** (`pnpm vitest run src/optimizer/trameDroite.golden.test.ts`,
  `GOLDEN=1` pour les 15 cas, `-u` pour recapturer un changement VOULU) ;
- les **liaisons diagonales** vers le comptoir, derrière l'option `liaisonsDiagonales`
  (désactivée : elles n'apportent rien de mesurable, et l'éditeur ne sait pas dessiner un
  losange — `RoadTile.losange`).

Q3 tranchée par Rémi (30/10/2026) : **un aqueduc peut croiser une route en biais**. La règle
prudente de `waterPlan` (aucune conduite sous un losange) reste en place, faute de savoir sur
combien de cases la conduite doit aller tout droit pour franchir ; sans effet tant qu'aucun
losange n'est posé. Q2 tranchée aussi : deux losanges qui ne se touchent que par une pointe ne
sont PAS reliés ; on les relie par une route de l'autre orientation (une route droite
horizontale entre les deux bas d'un V). Le graphe le faisait déjà.

### Raccordement au comptoir : corrigé

**Albion**, mesuré à part (22 îles, pavée, Foi, 80 %, hauteurs), avant les corrections
(commit 62e8e0b) → après, chaque branche séparément, aucune île en recul :
- branche celte (Aldermen) : 339 540 → 339 973 habitants, 114 → 73 maisons rasées, 0 service
  sans accès avant comme après ;
- branche romanisée (Nobles) : 354 443 → 356 489 habitants, 171 → 68 maisons rasées, 18 → 0
  services sans accès (tous sur small_04 : 1 011 → 2 612 habitants).

Recensement sur les 27 îles romaines du **Latium** (Patriciens, pavée, Foi, 80 %), avant →
après :
1 078 230 → 1 082 207 habitants, 263 → 113 maisons rasées, 31 → 1 service sans accès au
comptoir. Trois corrections dans `optimizer/kontor.ts`, une dans `optimizer/planLattice.ts` :
- **une maison rasée coûte plus qu'un détour** (`PRIX_CASE_RASEE` = 3) dans le raccordement du
  comptoir et la réparation des îlots ;
- **la réparation repasse sur ses échecs** tant qu'un îlot s'est raccroché : un îlot du fond ne
  se raccroche souvent qu'à travers un autre, traité après lui. small_05 : 3 780 → 6 450
  habitants, 16 → 1 service coupé ; son plan droit dépasse désormais le diagonal (5 313), dont
  le « +41 % » venait surtout de ce défaut ;
- **la réparation raccorde aussi le BÂTIMENT**, depuis tout son pourtour, quand son îlot de
  route est irrécupérable : la route d'une source d'aqueduc, creusée côté montagne, ne
  revenait pas vers la ville alors que le réseau était à 2 ou 3 cases de l'autre côté
  (large_02, medium_02, small_05, extralarge_04). Services sans accès : 8 → 4. La population
  affichée ne bouge pas — le moteur comptait déjà ces services actifs —, mais en jeu une
  source coupée assèche tout son réseau d'eau ;
- **les poches murées restent vides** (`planLattice`) : un grand bâtiment posé contre le relief
  peut murer une bande de terre ; une route qu'aucun chemin à travers la terre (sans traverser
  de bâtiment) ne relie au comptoir réservé est déclarée murée, ses services sortent du plan et
  aucune maison ne s'y pose. medium_05 : 3 → 0 services sans accès, −69 habitants AFFICHÉS
  (l'ancien chiffre comptait trois services inactifs) ; plan diagonal de medium_01 : 37 → 2.
  Effet de bord assumé : la recette retenue peut changer. Seul cas vu en Albion, par le test
  `bilanIndicatif` : celtic_island_large_07, branche ROMANISÉE (Nobles), sans hauteurs, passe
  de 14 400 à 12 301 habitants affichés ; la recette qui l'emportait devait son bilan à huit
  services (versions d'Albion) d'un quartier muré, inactifs en jeu — piste la plus probable,
  non isolée ; avec les réglages du recensement (hauteurs, pavée, Foi), cette île ne recule pas.
  Les poches laissées vides peuvent déclencher l'invariant `terre-vide`.

### Île de production : faite (30/10/2026)

Conception validée par Rémi, réponses consignées en fin de
`docs/superpowers/specs/2026-10-30-ile-de-production-design.md`. Planifier a un quatrième
mode, **« Île de production »** (`ui/ProductionPlanner.tsx`) : des biens et leur débit,
plusieurs à la fois, posés par le moteur de « Ma commande ».

- **Objectif dans la commande** (`Commande.objectif`, `commande/nomenclature.ts`) : toutes les
  chaînes en un seul `solve` (une chaîne partagée est cumulée avant l'arrondi), main-d'œuvre
  logée, débit posé par bien (`planifierCommande`, `ObjectifPose`).
- **Productivité** : dieu + saisie du joueur (recherche, objets ; une valeur globale et une par
  atelier), ADDITIONNÉES — confirmé en jeu par Rémi. La saisie vaut aussi pour les biens
  des maisons.
- **Sur l'île, sinon importé**, avec la raison au rapport : aucun producteur dans ce monde,
  fertilité ou gisement non déclaré (`Commande.fertilites`), emplacements de montagne ou de
  rivière trop peu nombreux (`Commande.emplacements`, comptés sur la carte ; répartis au
  prorata, l'excédent importé). Le marais ne borne rien. Mécanisme : `SolveOptions.plafonds`.
- **Retirés** : l'onglet Production hors île (`ProdLayoutView`, `planProductionLayout`,
  `buildChain`, `prodlayout/lot.ts` et `report.ts`) et le recuit de `optimizer/prodPlan.ts`. La
  répartition sur plusieurs îles pose ses îles de production avec le nouveau moteur, TOUS leurs
  biens au lieu du seul principal. L'ancien optimiseur à recuit qu'il utilisait
  (`optimizer/greedy.ts`, `anneal.ts`, `score.ts`, 558 lignes, et leurs tests) est retiré aussi :
  plus rien ne l'appelait. Seul reste son format de sortie, `OptimizeResult`.
- **Deux défauts corrigés au passage**, trouvés par le test sur six vraies îles
  (`commande/ileDeProduction.test.ts`, trois du Latium, trois d'Albion dont une par branche) :
  la production de la commande posait l'ENTREPÔT ROMAIN en Albion (`prodlayout` ignorait le
  template `Warehouse_Marsh` ; prédicat partagé dans `model/entrepot.ts`) — cela touchait aussi
  « Ma commande » en Albion ; et un lot trop grand pour la terre libre d'une petite île n'était
  pas recoupé.

### Planification d'un monde : étapes 1 à 4 faites (30/10 – 04/11/2026)

Le projet que Rémi veut vraiment : planifier TOUTES les îles d'une partie, des deux provinces
(les besoins complets des Patriciens passent par l'Albion, ceux des Nobles par le Latium).
Conception validée, réponses de Rémi incluses :
`docs/superpowers/specs/2026-10-30-planification-globale-design.md`.

- **Étape 1, faite** : onglet **« Monde »** dans la colonne de gauche (`ui/MondeView.tsx`).
  Configurations nommées, enregistrées dans IndexedDB (`monde/stockage.ts`, repli en mémoire),
  exportables et importables en JSON. Assistant en grande fenêtre (`ui/monde/AssistantMonde.tsx`) :
  nom, îles reconnues à leur forme (vignettes terre / relief / rivière / eau côtière, filtre par
  province et taille, rotation des vignettes), fertilités par île groupées comme en jeu
  (`monde/fertilites.ts`, tirées des données), propriété (à moi, achetable, adversaire, inconnue).
  Modèle et validation : `monde/configuration.ts`.
- **Étapes 2 et 3, faites** (`monde/calcul.ts`, `monde/repartition.ts`, écran
  `ui/monde/ResultatMondeVue.tsx`). Dans la fiche : objectif des îles principales (gains,
  habitants, maisons — objectif `argent` ajouté à `planIslandImport`), routes, productivité
  saisie ; rôle, palier et dieu de chaque île à moi. « Calculer le monde » :
  1. îles principales en parallèle (Web Workers) : tous les services, mines sur les emplacements
     libres si le gisement est coché ;
  2. demande totale moins les mines, répartie sur les autres îles à moi par estimation (devis à
     moins d'1 ms) avec trois budgets par île — terre (65 %), côte (12 % de la bande d'eau,
     mesuré), emplacements de montagne et de rivière partagés — en rebouclant sur les besoins
     des ouvriers et les matières qu'une île doit faire venir ;
  3. pose réelle des îles de production en parallèle, un rattrapage pour ce qui n'a pas tenu ;
  4. flux entre îles (u/min, sans navires), déficits avec leur raison, bilan.
  Mesuré (test `monde/calcul.test.ts`, une île principale Patriciens sur roman_island_medium_01,
  deux îles de production au Latium, deux en Albion) : ~30 000 habitants, la Bière et les autres
  biens d'Albion partent vers l'île romaine ; 41 s sans parallélisme, ~20 s dans l'application.
  « Plusieurs îles » est retiré (multiIslandPlan, son worker, `MultiIslandPanel`,
  `ResourceSelector`).
- **Argent des îles de production compté (04/11/2026)** : impôts des maisons d'ouvriers (le
  `Money` des besoins remplis au palier de chaque maison, par le même évaluateur que sa capacité :
  biens supposés importés, services qui la couvrent vraiment) moins l'entretien de TOUS les
  bâtiments posés (`ResultatCommande.argent`, `commande/planifier.ts`). Il entre dans le bilan du
  monde et s'affiche dans « Île de production ». Vérifié : 8 maisons de Plébéiens × 17 (somme
  des `Money` de leurs biens dans les données) = 136. Une île de production est souvent en perte
  (amphores sur roman_island_medium_01 : −9/min) : c'est attendu, l'entretien des ateliers dépasse
  les impôts de quelques ouvriers.
- **Limites connues** : l'estimation de terre
  est optimiste pour les fermes et les bâtiments à aire libre (le rattrapage compense en
  partie) ; les ouvriers de haut palier des ateliers de luxe consomment des biens de luxe, ce qui
  est juste mais alourdit la demande.
- **Étape 4, faite** :
  - **suggestions d'achat** (`suggererAchats`, `monde/repartition.ts`) : pour ce qui manque, les
    îles achetables ou inconnues (jamais celles d'un adversaire) qui couvriraient le plus,
    choisies l'une après l'autre (achats complémentaires), jugées sur leur GAIN NET — ce qu'elles
    couvriraient moins ce qu'elles réclameraient en retour (matières qu'elles ne produisent pas,
    biens de leurs ouvriers). « Je l'achète » : l'île passe à moi et le monde est recalculé.
    « Pas possible » : elle passe en adversaire et ne revient plus. Si aucune ne vaut l'achat,
    l'écran le dit ;
  - **recalcul incrémental** : chaque île porte l'empreinte de ses entrées ; une île inchangée est
    reprise du calcul précédent. Acheter une île ne relance pas les îles principales ;
  - **les besoins d'une île de production suivent ce qu'elle a vraiment posé** (biens des
    ouvriers, matières) : les compter pour tout l'objectif creusait le manque.
  Tests rapides de l'orchestration avec des moteurs factices : `monde/orchestration.test.ts`.
- **Pose côtière corrigée (04/11/2026)** : les MARAIS SALANTS ne se posaient sur aucune île
  (donc aucun garum) ni le ramasseur de coques en Albion. Cause, lue dans les `.ifo` du jeu : un
  bâtiment côtier a TROIS zones — le quai (`QuayArea`, à terre), la partie dans l'eau
  (`WaterBlocker`) et le reste de l'emprise, ni l'un ni l'autre. Le moteur exigeait la terre
  partout hors de l'eau, donc une colonne de terre AU LARGE derrière l'eau de ces deux
  bâtiments. Désormais `partieQuai` (rectangles, forme exacte du polygone : le quai des coques
  est en U) doit être à terre, et le reste peut être terre ou eau constructible
  (`terrainConvient`). Extrait par `tools/extraire_quais.py` (20 bâtiments sur 22 ; le phare et
  la statue de Zeus n'ont pas de quai), et par `tools/build_catalog.py` aux prochaines
  extractions. Comptoirs et quais pleins inchangés (quai et eau couvrent toute l'emprise).
  Mesuré sur 80 demandés : marais salants 0 → 17 (roman_island_large_03), escargotières 15 → 20,
  salicorne 7 → 17, coques 0 → 3 sur celtic_island_large_02 (positions possibles ×10 à ×20 sur
  les autres îles d'Albion). L'Albion reste en dessous : ses côtiers sont longs le long du rivage
  (6 à 7 cases), une côte découpée en accueille peu — la bande d'eau, elle, est aussi profonde
  qu'au Latium. Budget de côte de la répartition par province : 12 % Latium, 5 % Albion. Test :
  `commande/cotiers.test.ts`. Hypothèse non vérifiée en jeu : le reste de l'emprise accepte
  indifféremment terre et eau constructible.
- Au passage : la fenêtre modale partagée reprenait le focus à chaque rendu (un champ de saisie
  le perdait à chaque frappe) ; corrigé dans `ui/Modal.tsx`.

### Import d'une sauvegarde `.a8s`, emplacements et réglages de la partie (04–05/11/2026)

« Importer… » dans l'onglet Monde accepte une sauvegarde du jeu (`Documents/Anno 117 - Pax
Romana/accounts/<compte>/<profil>/*.a8s`) et en fait une configuration : toutes les îles des deux
provinces, leurs fertilités et gisements, leur propriétaire (à moi, adversaire, achetable), leur
rotation et leur position. Lue dans le navigateur en ~150 ms (`monde/sauvegarde/`) :
- `rda.ts` : l'archive RDA 2.2. Chaque fichier d'une sauvegarde est un flux zlib SUIVI de 12
  octets (un flux vide puis la taille décompressée), que Chrome refuse : `fichierDeSauvegarde`
  les retire et contrôle la taille ;
- `filedb.ts` : le format FileDB v3, lu en ne gardant que les branches utiles (80 Mo de données) ;
- `partie.ts` : `MetaGameManager/GameSessions` (une session par province, elle-même un FileDB),
  `MapTemplate/TemplateElement/Element` (fichier de l'île = id du catalogue, `Rotation90`,
  `Position`, fertilités tirées), `AreaInfo` (zone `(129 + rang de l'élément) × 64 + n° de
  session` : `OwnerProfile`, fertilités actuelles). Propriétaires lus dans assets.xml :
  41, 600069, 600070, 42 = joueurs humains 1 à 4 ; 31099… = rivaux. Partie à plusieurs : l'import
  demande quel joueur on est. Comptoirs tiers et décors ignorés ; les îles de campagne, absentes
  du catalogue, sont signalées.
- Les 13 profils de sauvegarde de Rémi se lisent ; test sur Maximilia Maxima
  (`partie.test.ts`, sauté si la sauvegarde n'est pas sur la machine).
- **À vérifier en jeu** : le SENS de la rotation. Les vignettes sont tournées de `Rotation90 × 90°`
  dans le sens horaire ; si l'île apparaît en miroir de la minimap, c'est l'autre sens.
- **Emplacements inactifs** (05/11/2026) : chaque emplacement du terrain porte son `ObjectId`
  (`tools/extraire_ids_emplacements.py`, 727 emplacements). L'import lit `MineSlotActivation` :
  les « Slot … » de montagne, rivière et marais sont des objets de carte ALÉATOIRES, activés selon
  le réglage de matières premières ; les « Fixed Slot … » le sont toujours (`ActivateAll`). Un
  emplacement inactif est retiré de l'île dans le calcul du monde (`sansEmplacementsInactifs`) —
  ni mine ni source. Grande 05 d'Albion dans Maximilia : 2 emplacements de montagne tirés sur 6
  activés, ses deux gisements. **À confirmer en jeu** : qu'un emplacement inactif n'accepte pas
  non plus de source d'aqueduc.
- **Réglages de la partie** (05/11/2026), lus dans `gamesetup.a7s` et réglables dans la fiche :
  - consommation (`DifficultySettings/NeedConsumption/ConsumptionFactor`) : Faible ×1, Moyen
    ×1,25, Élevé ×1,5 sur les biens des maisons ;
  - entretien (`MaintenancePercentage` 100 / 122 / 140) : argent d'entretien ET main-d'œuvre de
    chaque bâtiment (`Commande.facteurEntretien`) ;
  - crans dans `datasets.xml` : Low 0, Medium 1, High 2. Défaut d'une configuration : Moyen.
  - Les DONNÉES EXTRAITES SONT AU CRAN FAIBLE : dans une partie standard (Moyen), les outils d'une
    île (« Remplir l'île », « Île de production ») sous-estiment de 25 % la consommation et de
    22 % la main-d'œuvre et l'entretien. Seul le calcul du monde applique les réglages.
  - Limite : la main-d'œuvre des services des îles PRINCIPALES reste au cran Faible (cascade
    interne au moteur d'île).
  - Impôts NON appliqués : `SetupTaxes` porte un `LandTaxFactor` (Spare ×1, Medium ×1,5, Plenty
    ×2) dont l'effet sur l'argent des maisons n'est pas établi. Maximilia est en « Spare » : si
    une maison de Plébéiens y rapporte 17 (somme des `Money` de ses besoins), nos valeurs sont
    celles du cran Spare.
- Pas encore lus : les noms des villes.
- **Mis de côté par Rémi (04/11/2026)** : reconnaître les îles sur une CAPTURE DE LA MINIMAP,
  quand on ne peut pas importer la sauvegarde. Faisable sans apprentissage : terre / eau par la
  couleur, une silhouette par île, comparée aux masques du catalogue dans les 4 rotations, à
  échelle commune ; l'utilisateur valide puis coche les fertilités. Inconnues : icônes posées sur
  la minimap, brouillard, couleurs des propriétaires, minimap droite ou en losange. Pour mesurer
  la fiabilité avant de bâtir l'écran : des captures de la minimap de Maximilia Maxima, dont la
  sauvegarde donne la vérité (îles, rotations, positions) — et le sens de la rotation au passage.

### Audit et qualité des plans (10/11/2026)

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
- **Restent de l'audit** : main-d'œuvre sur ce qui est posé, île de production (étape 3), monde
  (étape 4, dont le conseil de l'île principale), entretien (étape 5).

## Ce qui reste à faire, par intérêt (10/11/2026)

Feuille de route détaillée : `.claude/ROADMAP.md`.

**Planification d'un monde** (l'objectif principal)
1. **Estimation de terre des fermes et des bâtiments à aire libre** : la répartition promet
   parfois à une île plus qu'elle ne peut porter (terre comptée à 65 %) ; le rattrapage ne
   compense qu'en partie. Mesurer l'écart devis / pose par type de chaîne, corriger le devis.
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
12. Ancien dossier de travail `.claude/worktrees/confident-jemison-990e57` à nettoyer.
13. `main` n'a pas reçu `dev` depuis octobre.

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

## Historique des priorités (octobre 2026)

1. ~~Ne pas créer de poches~~ : fait (`planLattice`, « UN GRAND BÂTIMENT NE MURE PAS UNE PARTIE
   DE L'ÎLE ») — une grande emprise qui couperait du comptoir plus de 25 maisons de terre est
   posée ailleurs. Latium : +1 926 habitants (extralarge_02), aucune île en recul ; seuils 3, 6
   et 12 essayés, chacun faisait reculer une ou deux îles. Plan diagonal de medium_01 :
   14 384 → 22 990 habitants.
2. ~~Deux écarts « cases en coin »~~ : corrigés, sans effet mesuré en Latium.
3. ~~Plan diagonal d'extralarge_04 à 0 habitant~~ : il loge désormais 2 218 maisons.
4. **Un service sans accès compte encore dans la couverture et le bilan** : reporté (voir 10
   ci-dessus). Les parcelles ne gardent qu'un masque de services par TYPE ; retirer une copie
   coupée demande de recalculer la portée par copie, puis palier, capacité et attributs.
5. ~~Île de production~~ : faite.
6. ~~Prix du bilan non réglable~~ : curseur dans les options avancées de « Remplir l'île ».
7. **Plan diagonal non posable dans l'éditeur** : reporté (voir 11 ci-dessus).

## Pièges connus

- Après une fusion, le serveur de développement peut garder des modules périmés (page blanche,
  « does not provide an export named … ») : le redémarrer.
- Une sonde de mesure doit passer les hauteurs de l'île (`heightsOf`) comme le worker de
  l'application, sinon ses résultats diffèrent de l'écran. Vécu le 10/11/2026 : un plan de
  « Ma commande » à 450 maisons au test en logeait 0 à l'écran.
- Les moteurs tournent en cases entières (`downscaleGrid`) ; le résultat est reprojeté en
  demi-cases pour l'éditeur (`scaleResultToHalfTile`), alternatives comprises — un plan
  diagonal garde son repère.
