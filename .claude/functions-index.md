# Index des fonctions et des types

Généré par `python tools/gen_functions_index.py` : ne pas éditer à la main, relancer le
script. Pour chaque fichier de `src/` (hors tests) : son rôle (première phrase de l'en-tête),
puis ses exports avec leur ligne et, entre crochets, le nombre de fichiers de `src/` (tests
compris) qui les citent — un nombre élevé signale un contrat partagé. Vue d'ensemble :
`.claude/architecture.md`.


## src

### `src/App.tsx`
- `App` (function, L5) [1]
### `src/buildStamp.ts` — EMPREINTE DU BUNDLE RÉELLEMENT CHARGÉ PAR LE NAVIGATEUR.
- `BUILD_ID` (const, L21) [1]

## src/commande

### `src/commande/disposition.ts` — DISPOSER UNE COMMANDE — TYPES ET OUTILS COMMUNS
- `DispositionOpts` (interface, L18) [3]
- `LignePosee` (interface, L31) [3]
- `PlanQuartiers` (interface, L39) [2]
- `distancesDeCroissance` (function, L125) [2] : Distance OCTILE le long de la terre depuis des graines (10 en ligne droite, 14 en diagonale, la diagonale n'étant permi…
### `src/commande/ilots.ts` — LES ÎLOTS : UNE VILLE QUI SE LIT
- `ILOT` (const, L44) [0]
- `besoinEnIlots` (function, L86) [1] : Îlots à fusionner (k colonnes × m rangées) pour loger ce bâtiment, et l'orientation.
- `routeVersReseau` (function, L178) [1] : Plus court chemin de route du périmètre d'une emprise (sans les coins : l'accès est orthogonal) jusqu'au réseau, par de…
- `disposerQuartiers` (function, L266) [2] : Pose les quartiers d'une commande en îlots, sur une île (grille TUILE, celle des moteurs).
### `src/commande/maximum.ts` — PRODUIRE LE MAXIMUM
- `tenue` (const, L28) [6] : Part de l'objectif posée, sur le bien le moins bien tenu.
- `planifierMaximum` (function, L31) [2]
### `src/commande/nomenclature.ts` — LA COMMANDE, ET CE QU'ELLE COÛTE EN BÂTIMENTS
- `SURFACE_PAR_MAISON` (const, L33) [1] : Surface urbaine par maison, routes et services compris.
- `LigneMaisons` (interface, L39) [1]
- `ChoixServices` (type, L44) [1]
- `Commande` (interface, L46) [16]
- `LigneObjectif` (interface, L116) [1] : Un bien de l'objectif : demandé, et ce que l'île en produit (le reste est importé).
- `ImportObjectif` (interface, L125) [1]
- `RoleLigne` (type, L132) [0]
- `LigneNomenclature` (interface, L134) [0]
- `Nomenclature` (interface, L145) [3]
- `copiesPourCouvrir` (function, L170) [2] : Copies d'un service à portée-rue pour couvrir une zone : pavage en diamants L1 de rayon effectif `portée − pas du peign…
- `nomenclature` (function, L182) [21] : La nomenclature d'une commande.
### `src/commande/planifier.ts`
- `MainOeuvre` (interface, L19) [0]
- `mainOeuvrePosee` (function, L27) [1] : La main-d'œuvre du plan POSÉ, par palier : ce que réclament les bâtiments posés, ce qu'offrent les maisons posées et le…
- `ObjectifPose` (interface, L53) [0] : Un bien de l'objectif, et le débit que le plan POSÉ en tire.
- `Argent` (interface, L58) [9]
- `PlanCommande` (interface, L60) [1]
- `compterEmplacements` (function, L82) [0] : Emplacements de terrain de l'île, par type.
- `planifierCommande` (function, L88) [9]
- `ResultatCommande` (interface, L188) [6] : Ce qui traverse la frontière du worker : le plan à poser et le rapport, sans les masques de grille (zone, île) qui pèse…
- `resumer` (function, L211) [3]
### `src/commande/planifierWorker.ts`
- `CommandeRequete` (interface, L9) [2]
- `CommandeMsg` (type, L17) [1]
### `src/commande/production.ts` — LA PRODUCTION POSÉE SUR L'ÎLE
- `PlanProduction` (interface, L41) [1]
- `VilleExistante` (interface, L52) [0]
- `lotsDeProduction` (function, L61) [1] : Lots de production : les lignes qui échangent des biens restent ensemble.
- `couper` (function, L87) [2] : Coupe un lot en deux DEMI-CHAÎNES : la moitié de chaque ligne de part et d'autre.
- `disposerProduction` (function, L106) [1] : Pose la production d'une commande sur l'île, autour d'une ville déjà posée.
### `src/commande/runPlanifier.ts` — Lance la planification d'une commande dans un Web Worker (interface non bloquée).
- `runPlanifier` (function, L5) [3]

## src/data

### `src/data/islandGrid.ts` — Construit la grille VIVANTE ½-tuile (cellsPerTile=2) d'une île à partir de son id.
- `buildIslandGrid` (function, L7) [30]
### `src/data/islands.ts` — Décode le masque RLE en tableau de booléens (longueur w*h).
- `Island` (interface, L3) [2]
- `islands` (const, L12) [34]
- `decodeMask` (function, L15) [4]
- `islandById` (function, L28) [8]
- `WORLDS` (const, L37) [4] : MONDES du jeu.
- `WorldRegion` (type, L41) [2]
- `worldLabel` (const, L44) [3] : Libellé du monde correspondant à une région (« Latium » / « Albion »).
- `regionOfIsland` (function, L53) [19] : Région d'une île, lue dans les données extraites — et non devinée à partir de son identifiant.
- `upscale2x` (function, L65) [5] : Suréchantillonne un masque booléen ×2 (chaque tuile → bloc 2×2, plus proche voisin) : conversion tuile → ½-tuile pour l…
### `src/data/seed.ts` — Catalogue par défaut : données réelles extraites des fichiers d'Anno 117 (tailles, routes, rayons, champs, production, noms FR, icônes).
- `seedCatalog` (function, L12) [3]
### `src/data/terrain.ts` — DEUX REPÈRES, UN SEUL AFFICHAGE
- `TerrainSlot` (interface, L31) [0] : Slot de ressource (extrait des .a7minfo, positions en tuiles).
- `terrainOf` (function, L53) [1]
- `riversOf` (function, L58) [2] : Cases rivière (boolean[w*h]) d'une île, ou undefined si aucune.
- `ZonesIle` (interface, L65) [0] : Zones constructibles d'une île selon le jeu, repère de l'image ; undefined si absentes.
- `zonesOf` (function, L73) [2] : LE JEU DIT LUI-MÊME OÙ L'ON BÂTIT (AreaIDs × Water dans le gamedata de l'île) : terre constructible, bande d'eau côtièr…
- `hasHeights` (function, L81) [8] : Vrai si l'île a des hauteurs extraites (le décodage peut malgré tout échouer côté navigateur).
- `slotsOf` (function, L86) [1] : Slots posables (montagne/rivière/marais — les blockers sont ignorés), repère de l'image.
- `heightsOf` (function, L100) [9]

## src/economy

### `src/economy/attributes.ts` — BILAN D'ATTRIBUTS PAR MAISON.
- `VITAL_ATTRS` (const, L28) [9] : Attributs qui doivent rester positifs pour qu'une maison soit viable.
- `VitalAttr` (type, L29) [0]
- `Attrs` (type, L31) [1]
- `addAttrs` (const, L33) [0]
- `isViable` (const, L40) [2] : La maison tient-elle ?
- `worstAttr` (function, L43) [3] : Attribut vital le plus déficitaire (celui qui bloque), ou null si tout va bien.
- `needAttrs` (function, L56) [1] : Attributs apportés par les BESOINS remplis d'un palier, pour une maison dont les services couvrants sont donnés.
- `zoneAttrs` (function, L72) [1] : Contribution des effets de zone d'un ensemble de bâtiments couvrants, en EXCLUANT ceux qui remplissent déjà un besoin d…
- `houseAttrs` (function, L84) [1] : Bilan complet d'une maison : besoins + effets de zone + rang de cité.
- `institutionDefs` (function, L109) [4] : Institutions anti-incidents (Vigiles, Medicus, Préfecture et leurs versions Mini).
- `SHRINE_TYPE` (const, L129) [5] : `UniqueType` que partagent les seize autels de dieux.
- `pickPatron` (function, L146) [2] : DIVINITÉ TUTÉLAIRE — un seul dieu par île.
- `patronResidenceAttrs` (function, L184) [2] : Attributs qu'un patron ajoute à CHAQUE résidence de l'île, à une dévotion donnée.
- `bestDeityAttrs` (function, L207) [2] : LA DIVINITÉ SE CHOISIT AVANT L'AUTEL, ET SUR DONNÉES SEULES.
- `bestDeity` (function, L213) [1] : Le dieu dont `bestDeityAttrs` rend les attributs ; aucun si nul ne rend rien.
### `src/economy/coverage.ts`
- `ServiceCoverage` (interface, L7) [0]
- `CoverageReport` (interface, L19) [2]
- `analyzeCoverage` (function, L32) [3] : Analyse la couverture des services publics : pour chaque type de service requis par les tiers présents, quel % des rési…
### `src/economy/dieux.ts` — LES DIEUX TUTÉLAIRES : CE QU'ILS RENDENT, SELON LA DÉVOTION
- `dieux` (function, L24) [17] : Les huit dieux, dans l'ordre alphabétique de leur nom affiché.
- `nomDuDieu` (const, L28) [5]
- `dieuParId` (function, L30) [5]
- `dieuDeLAutel` (function, L35) [2] : Le dieu dont `defId` est un autel, s'il y en a un.
- `echelleA` (function, L40) [0] : Échelle atteinte à cette dévotion : celle du dernier palier franchi, 0 sous le premier.
- `devotionDeFoi` (const, L47) [2] : Dévotion d'équilibre d'une île : sa Foi (voir l'en-tête).
- `prochainPalier` (function, L50) [2] : Prochain palier d'effet au-dessus de cette dévotion, tous effets locaux confondus.
- `EffetsDuDieu` (interface, L61) [0]
- `effetsDuDieu` (function, L78) [4]
- `productiviteDuDieu` (function, L111) [3] : MULTIPLICATEUR DE PRODUCTIVITÉ par atelier (defId → 1,6 pour +60 %), vide sans dieu.
- `resumeEffets` (function, L120) [4] : Ce qu'un dieu rend, en une ligne : productivité et effet sur les maisons.
### `src/economy/economy.ts`
- `TierGood` (interface, L3) [0]
- `TierService` (interface, L15) [0]
- `Tier` (interface, L25) [10]
- `BProd` (interface, L53) [1]
- `ResolvedEffect` (interface, L74) [0] : Un effet, tel que résolu depuis les assets du jeu.
- `Patron` (interface, L132) [6] : DIVINITÉ TUTÉLAIRE — une par île, choisie par le joueur.
- `BuildingEffect` (interface, L150) [0]
- `CityStatusStep` (interface, L181) [0] : PALIER DE RANG DE CITÉ (`EconomyFeature7/CityStatusFeature`).
- `chainFertilities` (function, L228) [3] : Fertilités/gisements requis par la chaîne de production d'un bien (récursif).
- `economy` (const, L245) [69]
- `tiers` (const, L247) [42]
- `upkeepOf` (const, L248) [4]
- `tierByGuid` (const, L252) [11]
- `residentialChain` (function, L271) [3] : Chaîne résidentielle menant au tier-cible : ses ANCÊTRES dans le graphe de montée, du plus bas à la cible.
- `residentialChainExtended` (function, L305) [7] : CHAÎNE ÉTENDUE — la chaîne résidentielle, plus les LIGNÉES PARALLÈLES du même monde.
- `goodName` (const, L321) [12]
- `priceOf` (const, L325) [5] : Valeur marchande de référence d'un bien (BasePrice), 0 si inconnu.
- `effectOf` (const, L329) [6] : Effet de zone d'un bâtiment, ou undefined s'il n'en porte pas.
- `cityStatusAttrs` (function, L336) [6] : Malus/bonus de RANG DE CITÉ pour une population donnée, appliqués à chaque résidence.
- `worldOf` (const, L351) [21] : MONDE d'une culture de population.
- `cityStatusLadder` (function, L358) [2] : Échelle des rangs de cité telle que la subit une CULTURE donnée : les seuils de population viennent du MONDE (40 rangs…
- `regionOf` (const, L367) [2] : Région d'un bâtiment ("Roman"/"Celtic"/undefined).
- `pickProducer` (function, L374) [8] : Producteur d'un bien.
- `pickProducerInWorld` (function, L396) [5] : Producteur CONSTRUCTIBLE dans un monde donné, ou `undefined`.
### `src/economy/needsModel.ts` — MODÈLE DE PALIER ET DE CAPACITÉ — la mécanique réelle d'Anno 117. Règle du jeu (`Residence7/UpgradeThreshold`, cf. GAME_MECHANICS.md §3, verdict [FIC…
- `TierReach` (interface, L41) [0]
- `EvaluatorOptions` (interface, L51) [0]
- `TierEvaluator` (interface, L59) [0]
- `compileTierEvaluator` (function, L115) [8] : Compile un évaluateur pour une chaîne résidentielle donnée.
### `src/economy/resources.ts` — Ressources déclarées d'une île (saisie utilisateur — fertilités par-partie dans le jeu).
- `ResourceProfile` (interface, L4) [2]
- `emptyProfile` (const, L9) [1]
- `missingFertilities` (function, L12) [1] : Fertilités requises par la chaîne de `good` mais ABSENTES du profil.
- `canProduce` (function, L18) [1] : Le bien est-il produisible sur ce profil (toutes ses fertilités présentes) ?
- `producibleGoods` (function, L23) [2] : Ensemble des biens AYANT UN PRODUCTEUR et produisibles avec ce profil.
### `src/economy/solve.ts` — Maisons couvertes par défaut par un bâtiment de service (rayon d'influence).
- `PopTarget` (interface, L6) [0]
- `SolveOptions` (interface, L11) [1]
- `TierProfile` (interface, L51) [0]
- `ExtraDemand` (type, L59) [0] : Demande exogène de biens (GUID -> unités/min), ex: objectif de production.
- `SolveResult` (interface, L61) [0]
- `prodRatePerMin` (const, L82) [2]
- `inputRatePerMin` (const, L87) [1]
- `TierProfileOptions` (interface, L113) [0]
- `buildTierProfile` (function, L126) [2] : Besoins RETENUS d'un tier (partagé solveur ↔ planificateur d'île) : - "thresholds" : par catégorie, sous-ensemble coût/…
- `solve` (function, L188) [7] : Solveur point-fixe : population cible -> besoins (biens) -> bâtiments de production -> main-d'œuvre requise -> populati…
### `src/economy/uniques.ts` — UNICITÉ DES BÂTIMENTS — combien d'exemplaires d'un même `UniqueType` tiennent sur une île.
- `SHRINE_PERMIT` (const, L23) [2] : Permis d'autel (produit 93771) — celui qui borne les sanctuaires de la divinité tutélaire.
- `DEFAULT_PERMITS` (const, L39) [2] : PERMIS DÉTENUS par défaut, par GUID.
- `uniqueCap` (function, L42) [5] : Combien d'exemplaires de ce bâtiment l'île accepte, tous porteurs du même type confondus.
### `src/economy/workforce.ts` — MAIN-D'ŒUVRE — le pool d'ouvriers d'une île.
- `Difficulty` (type, L26) [0] : Réglage de difficulté de la partie — le comptoir n'offre pas autant dans les trois.
- `workforceGrant` (function, L37) [4] : Main-d'œuvre NETTE offerte par un bâtiment, par palier.
- `workforceDemand` (function, L56) [2] : Main-d'œuvre réclamée par un ensemble de bâtiments posés, par palier.
- `workforceDeficit` (function, L67) [1] : Ce qui manque, palier par palier.
- `alienDemand` (function, L87) [1] : Paliers dont la main-d'œuvre est HORS DU MONDE de l'île.

## src/engine

### `src/engine/geometry.ts`
- `isDiagonal` (const, L11) [1] : Rotation diagonale (diamant) ?
- `gridScale` (const, L14) [6] : Cellules par tuile d'une grille (½-tuile = 2 ; tuile/optimiseur = 1 par défaut).
- `footprintSize` (function, L17) [20] : Dimensions effectives après rotation, EN CELLULES (def.size ×scale).
- `partieEauPosee` (function, L32) [5] : Partie dans l'eau d'un bâtiment côtier posé avec `rot`, en cases relatives à son coin (même échelle que l'emprise), ou…
- `partieQuaiPosee` (function, L39) [1] : Le quai d'un bâtiment côtier posé avec `rot` (cf.
- `footprintCells` (function, L59) [9] : Liste des cases occupées (EN CELLULES) par un bâtiment posé en (x,y).
- `inBounds` (const, L88) [1]
- `cellIndex` (const, L91) [1]
- `routeSeule` (const, L99) [6] : Une ROUTE peut-elle passer sur la case `c` alors qu'aucun bâtiment ne le peut ?
- `isUsable` (const, L101) [2]
- `isWater` (const, L105) [2] : Case d'eau (mer) ?
- `isBuildable` (const, L113) [2] : Case constructible pour un bâtiment selon son terrain de pose.
- `cellKey` (const, L116) [3]
- `parseCellKey` (const, L119) [1] : Décode une clé "x,y" en cellule (inverse de cellKey ; sans alloc de tableau).
- `orthoNeighbors` (function, L125) [2] : Voisins orthogonaux (4-connexité).
- `neighbors8` (function, L135) [2] : Voisins 8-connexité (4 ortho + 4 diagonaux) — connexion au coin du jeu 45°.
- `tileToHT` (const, L143) [1] : 1 tuile-jeu = 2 cellules (½-tuile).
- `htToTile` (const, L144) [1]
### `src/engine/reseauRoutier.ts` — LE RÉSEAU ROUTIER EN GRAPHE
- `Trame` (interface, L46) [5] : Les dimensions seules : la géométrie des contacts n'a pas besoin des routes.
- `trameDe` (const, L53) [1]
- `ReseauRoutier` (interface, L55) [4]
- `reseauVide` (function, L65) [3] : Réseau sans route, ou posé sur un masque `droite` existant (le `roadAt` d'un moteur).
- `poserLosange` (function, L69) [5]
- `retirerLosange` (function, L74) [2]
- `tailleReseau` (const, L80) [5] : Nombre total d'identifiants : cases droites puis coins.
- `idDroite` (const, L82) [2]
- `idLosange` (const, L83) [3]
- `estLosange` (const, L84) [3]
- `coinDe` (function, L86) [5] : Coin (X, Y) du losange `id`.
- `estRoute` (const, L91) [3]
- `idDeRoute` (function, L100) [3] : Identifiant de la case de route `t` (`t.losange` : losange centré sur le coin (x, y)), −1 hors grille.
- `routeDe` (function, L106) [3] : La case de route du nœud `id`.
- `reseauDeRoutes` (function, L113) [5] : Réseau des routes d'un plan ; celles hors de la grille sont ignorées.
- `routesDuReseau` (function, L125) [2] : Les routes du réseau en cases de plan : les droites dans l'ordre des indices, puis les losanges.
- `noeudsAuContact` (function, L157) [2] : CONTACT D'UN BÂTIMENT : tous les nœuds (route ou non) au contact de la case de bâtiment `id` — par un côté entre objets…
- `noeudsAuContactDeCase` (function, L168) [2] : Les nœuds au contact de la case droite (x, y), qui peut déborder de la grille (une emprise de bâtiment côtier, par exem…
- `noeudsAuContactRect` (function, L185) [3] : Les nœuds au contact d'une emprise droite rectangulaire [x, x+w) × [y, y+h) : - les cases droites qui partagent un côté…
- `routesAuContactRect` (function, L219) [4] : Les routes au contact d'une emprise droite rectangulaire, dans l'ordre de `noeudsAuContactRect`.
- `routesAuContact` (function, L227) [4] : Les routes au contact de la case de bâtiment `id` : ses points de départ.
- `noeudsLies` (function, L241) [2] : ARÊTES DU GRAPHE : tous les nœuds (route ou non) liés au nœud `id` s'ils portaient une route.
- `noeudsLiesDuReseau` (function, L261) [1] : `noeudsLies`, sans les losanges candidats quand le réseau n'en porte aucun : pour les tracés droits qui explorent le te…
- `voisins` (function, L271) [9] : Les routes voisines de la route `id` dans le graphe.
- `losangeSur` (function, L303) [3] : Le premier losange de route qui recouvre la case droite `c`, ou −1.
- `casesAuContact` (function, L317) [5] : Les cases droites au contact du nœud `id` : celles qu'une route atteinte sert, puisqu'un bâtiment droit qui en occupe u…
- `casesSousLosange` (function, L327) [2] : Les 4 cases droites dont le losange (X, Y) couvre la moitié.
- `degre` (function, L332) [2] : Nombre de routes voisines.
- `COUT_LOSANGE` (const, L341) [0] : Longueur d'un losange de route : la portée est une longueur de trajet.
- `coutDe` (const, L343) [1] : Coût d'un nœud de route dans un trajet : 1 pour une case droite, √2 pour un losange.
- `Parcours` (interface, L353) [1] : Un parcours réutilisable : `dist` (−1 non atteint ; sinon la longueur du trajet, source comprise : 1 pour une source dr…
- `creerParcours` (function, L359) [5]
- `parcourir` (function, L374) [5] : PORTÉE le long des routes : les nœuds dont le trajet depuis une source, source comprise, ne dépasse pas `budget` (1 par…
- `FileDeNoeuds` (class, L419) [1] : File de priorité (tas binaire) sur (longueur, ordre d'arrivée).
### `src/engine/roads.ts` — LE TYPE DE ROUTE ALLONGE LA PORTÉE DES SERVICES
- `RoadType` (type, L20) [15]
- `ROAD_TYPES` (const, L22) [1]
- `DEFAULT_ROAD_TYPE` (const, L28) [1]
- `roadFactor` (const, L30) [1]
- `planningRange` (function, L39) [11] : Portée de PLANIFICATION d'un bâtiment, en cases de route du type donné.
- `porteeDeTrajet` (function, L49) [2] : Portée en LONGUEUR de trajet, sans arrondi : pour un réseau qui mêle cases droites (1) et losanges diagonaux (√2, cf.
### `src/engine/rules.ts`
- `DefLookup` (type, L37) [25]
- `makeLookup` (function, L71) [44]
- `canPlace` (function, L103) [3] : Peut-on poser `def` en (x,y,rot) ?
- `terrainConvient` (function, L133) [6] : Le terrain convient-il à `def` posé en (x, y) ?
- `rootedRoadSet` (function, L160) [13] : Ensemble des cases de route reliées à un comptoir (roadRoot), via BFS sur le réseau (4-connexité).
- `roadConnected` (function, L220) [10] : Le bâtiment touche-t-il une route reliée au comptoir ?
- `FieldResult` (interface, L250) [0]
- `validateFields` (function, L259) [3] : Valide le champ d'un bâtiment : assez de cases, connectées, touchant le bâtiment.
- `computeRadiusCoverage` (function, L421) [8] : Cases couvertes par le rayon de chaque bâtiment d'influence.
- `BuildingIssues` (interface, L448) [1]
- `validateLayout` (function, L470) [5] : Valide toute la disposition, renvoie les problèmes par bâtiment.

## src

### `src/main.tsx`

## src/model

### `src/model/entrepot.ts` — ENTREPÔT DE L'ÎLE, du bon monde.
- `estEntrepot` (const, L19) [3] : Un entrepôt, de l'un ou l'autre monde.
- `pickWarehouseDef` (function, L21) [3]
### `src/model/factories.ts` — Identifiant unique court (suffisant côté client).
- `uid` (function, L5) [41]
- `makeGrid` (function, L10) [10]
- `emptyLayout` (function, L19) [4] : Layout vide pour l'éditeur : grille ½-tuile (cellsPerTile=2) afin que la construction 45° soit possible d'emblée (cf.
- `resizeGridShape` (function, L28) [2] : Redimensionne une grille en PRÉSERVANT le terrain : re-clippe les masques par-case (usable/water/rivers) et filtre les…
- `makeBuildingDef` (function, L48) [9]
- `placeBuilding` (function, L63) [3]
### `src/model/serialize.ts`
- `SaveFile` (interface, L3) [1]
- `toSaveFile` (function, L10) [0]
- `serialize` (function, L14) [3]
- `parse` (function, L18) [6]
- `RefIssues` (interface, L29) [0]
- `findOrphanRefs` (function, L39) [2] : Vérifie l'intégrité référentielle d'une disposition : tout `defId` doit exister dans le catalogue et tout champ doit po…
### `src/model/types.ts`
- `Rotation` (type, L5) [10]
- `RadiusKind` (type, L7) [0]
- `RadiusSpec` (interface, L9) [0]
- `FieldSpec` (interface, L14) [0]
- `ProductionGood` (interface, L19) [0]
- `ProductionSpec` (interface, L24) [0]
- `BuildingDef` (interface, L31) [82] : Définition catalogue : gabarit réutilisable d'un type de bâtiment.
- `PlacedBuilding` (interface, L84) [23] : Instance d'un bâtiment posé sur la grille.
- `FieldTile` (interface, L93) [5]
- `AIRE_LIBRE` (const, L105) [4] : `fieldType` d'une case d'AIRE LIBRE : la terre qu'un bûcheron ou un rucher (`freeArea`) doit garder nue autour de lui.
- `RoadTile` (interface, L107) [14]
- `AqueductTile` (interface, L119) [3] : Tuile de conduite d'aqueduc (réseau d'eau, distinct des routes).
- `GridSlot` (interface, L126) [0] : Slot de ressource du terrain (montagne/rivière/marais) — extrait du jeu.
- `GridShape` (interface, L135) [39] : Grille de forme libre : masque des cases utilisables.
- `Layout` (interface, L150) [27]
- `Catalog` (type, L161) [10] : Catalogue persistant des définitions de bâtiments.
- `Cell` (interface, L163) [2]

## src/monde

### `src/monde/calcul.ts` — CALCULER UN MONDE
- `Executeurs` (interface, L42) [3]
- `PlanPose` (interface, L47) [0]
- `IleCalculee` (interface, L55) [1]
- `Flux` (interface, L78) [0]
- `Deficit` (interface, L79) [0]
- `ResultatMonde` (interface, L81) [2]
- `OptionsCalcul` (interface, L95) [0]
- `VERSION_CALCUL` (const, L110) [1] : VERSION DES MOTEURS, dans l'empreinte de chaque île.
- `capaciteCote` (function, L154) [3] : Combien d'exemplaires d'un bâtiment côtier la côte de l'île accueille, posés seuls et serrés : la règle de terrain de l…
- `versProductrice` (function, L193) [0] : Une île en île de production : ce que la répartition et la pose savent d'elle.
- `sansEmplacementsInactifs` (function, L233) [1] : L'île telle qu'elle est DANS LA PARTIE : sans les emplacements que le générateur de carte n'a pas activés (lus dans une…
- `ConseilPrincipale` (interface, L277) [1]
- `conseillerPrincipales` (function, L297) [2] : CONSEILLER L'ÎLE PRINCIPALE (exigence E5)
- `calculerMonde` (function, L316) [3]
- `nomIle` (const, L585) [0] : Nom lisible d'une île de la configuration.
- `nomPalier` (const, L586) [0]
### `src/monde/configuration.ts` — CONFIGURATION D'UN MONDE
- `Propriete` (type, L20) [2] : À qui est l'île.
- `PROPRIETES` (const, L21) [0]
- `LIBELLES_PROPRIETE` (const, L22) [2]
- `RoleIle` (type, L27) [0] : Rôle voulu par le joueur ; « auto » laisse le moteur décider (production, pour une île à lui).
- `ROLES` (const, L28) [3]
- `IleDuMonde` (interface, L30) [7]
- `ObjectifPrincipale` (type, L58) [1] : Ce que maximisent les îles principales.
- `LIBELLES_OBJECTIF` (const, L59) [1]
- `Cran` (type, L64) [2] : Cran d'un réglage de partie (`datasets.xml` : Low 0, Medium 1, High 2).
- `CRANS` (const, L65) [2]
- `LIBELLES_CRAN` (const, L66) [1]
- `FACTEUR_CONSOMMATION` (const, L68) [1] : `DifficultySettings/NeedConsumption/ConsumptionFactor` : les biens consommés par les maisons.
- `FACTEUR_ENTRETIEN` (const, L70) [1] : `DifficultySettings/Maintenance/MaintenancePercentage` : argent ET main-d'œuvre d'entretien.
- `ReglagesMonde` (interface, L72) [0]
- `reglagesParDefaut` (const, L81) [0]
- `ConfigurationMonde` (interface, L85) [7]
- `paliersDeLaProvince` (const, L98) [1] : Paliers résidentiels d'une province, du plus dense au moins dense.
- `palierParDefaut` (const, L101) [2]
- `nouvelId` (const, L105) [1] : Identifiant court, unique dans la session (horodatage + compteur).
- `nouvelleConfiguration` (function, L108) [5]
- `nouvelleIle` (function, L114) [4]
- `provinceDe` (const, L119) [4] : Province d'une île de la configuration.
- `normaliserConfiguration` (function, L131) [3]
### `src/monde/fertilites.ts` — FERTILITÉS D'UNE ÎLE, rangées comme le joueur les lit en jeu : terrestres, maritimes, minières, de rivière (et, en Albion, de marais et de prairie).
- `CategorieFertilite` (type, L16) [0]
- `LIBELLES_CATEGORIE` (const, L18) [0]
- `FertiliteProposee` (interface, L39) [0]
- `fertilitesDeLaProvince` (function, L50) [2] : Fertilités qu'un bâtiment de la province exige, groupées par catégorie, dans l'ordre d'affichage.
- `fertilitesLisibles` (const, L78) [2] : Les fertilités d'une île, en clair (« lin, olives, Gisement de fer »).
### `src/monde/repartition.ts` — RÉPARTIR LA DEMANDE D'UN MONDE ENTRE SES ÎLES DE PRODUCTION
- `BienDebit` (interface, L20) [1]
- `IleProductrice` (interface, L22) [2]
- `OptionsRepartition` (interface, L37) [2]
- `AUCUNE_FERTILITE` (const, L54) [0] : Les moteurs d'île lisent une liste de fertilités VIDE comme « tout est présent » (convention de « Remplir l'île », où l…
- `fertilitesPourMoteur` (const, L55) [2]
- `devisIle` (function, L64) [2] : Le devis d'une île pour un objectif : bâtiments, ouvriers, biens de leurs maisons, imports.
- `terreDuDevis` (const, L75) [0] : Terre consommée par l'objectif : production et quartiers des ouvriers.
- `besoinsDuDevis` (function, L79) [2] : Ce qu'il faut AUSSI fournir à l'île pour qu'elle tienne son objectif : les biens de ses ouvriers et les matières premiè…
- `Repartition` (interface, L87) [0]
- `BudgetsPris` (type, L97) [1] : Ce qu'une répartition précédente a déjà pris sur les îles (passe de rattrapage).
- `cumulerBudgets` (function, L100) [2] : Cumule les budgets pris par deux répartitions successives.
- `repartir` (function, L117) [2]
- `nomDuBien` (const, L237) [1]
- `SuggestionAchat` (interface, L241) [1]
- `suggererAchats` (function, L263) [1] : Les îles à acheter qui couvriraient le plus de ce qui manque — choisies l'une après l'autre : la deuxième est jugée sur…

## src/monde/sauvegarde

### `src/monde/sauvegarde/filedb.ts` — FILEDB v3 — le format des données d'une sauvegarde (`data.a7s`, et chaque province dedans).
- `NoeudFileDb` (interface, L19) [1]
- `FiltreFileDb` (type, L25) [0]
- `lireFileDb` (function, L40) [2]
- `filtreChemins` (function, L94) [2] : Un filtre qui garde les chemins donnés et tout ce qui est dessous.
- `enfant` (const, L104) [1]
- `enfants` (const, L105) [2]
- `chemin` (const, L106) [21]
- `attribut` (const, L108) [14]
- `attributs` (const, L109) [22]
- `entier` (function, L112) [20] : Un entier little-endian signé, de la taille de la donnée (1, 2, 4 ou 8 octets).
- `entier64Texte` (function, L125) [1] : Un entier 64 bits signé, en texte (il ne tient pas dans un nombre JavaScript).
- `entiers32` (function, L131) [2] : Une suite d'entiers 32 bits little-endian.
- `texteUtf16` (const, L139) [1]
### `src/monde/sauvegarde/partie.ts` — IMPORT D'UNE SAUVEGARDE `.a8s` — les îles de la partie, leurs fertilités, leur propriétaire.
- `PROFIL_JOUEUR` (const, L27) [0]
- `PROFILS_HUMAINS` (const, L30) [0] : Les profils humains d'une partie (assets.xml : `Profile_Human_00` à `_03`).
- `joueursDeLaPartie` (function, L36) [2] : Les joueurs humains qui possèdent des îles : plus d'un, la partie est à plusieurs et il faut savoir lequel est l'utilis…
- `IleLue` (interface, L43) [0]
- `PartieLue` (interface, L56) [2]
- `ilesDeLaSession` (function, L68) [0] : Les îles d'une province, depuis le FileDB de sa session.
- `reglagesDeLaPartie` (function, L125) [0] : Réglages de la partie qui changent l'économie, dans `GameSetupManager/Setup…/value@id`.
- `lirePartie` (function, L136) [2] : Lit une sauvegarde `.a8s` entière.
- `configurationDepuisPartie` (function, L172) [2] : La configuration d'un monde tirée d'une partie lue : îles, fertilités, propriétaires.
### `src/monde/sauvegarde/rda.ts` — ARCHIVE RDA « Resource File V2.2 » — le conteneur d'une sauvegarde `.a8s` (et des archives du jeu).
- `FichierRda` (interface, L23) [0]
- `inflerZlib` (function, L40) [1] : Décompresse un flux zlib (RFC 1950), dans le navigateur comme sous Node.
- `fichierDeSauvegarde` (function, L62) [2] : Le contenu d'un fichier de sauvegarde (`data.a7s`…) : son flux zlib, sans la fin de 12 octets qui fait échouer `Decompr…
- `lireIndexRda` (function, L89) [1] : Le répertoire de l'archive.
- `extraireRda` (function, L124) [1] : Le contenu d'un fichier de l'archive, déchiffré et décompressé par l'archive si besoin.

## src/monde

### `src/monde/stockage.ts` — STOCKAGE DES CONFIGURATIONS DE MONDE — IndexedDB.
- `DepotMondes` (interface, L15) [1]
- `depotEnMemoire` (function, L29) [1]
- `depotMondes` (function, L70) [1] : Le dépôt de l'application : IndexedDB si possible, sinon en mémoire.
- `lireExport` (function, L77) [2] : Contenu d'un fichier d'export : une configuration, ou une liste.

## src/optimizer

### `src/optimizer/cadreDiagonal.ts` — LE REPÈRE DIAGONAL
- `CadreDiagonal` (interface, L20) [1]
- `cadreDe` (function, L31) [2]
- `centreDroit` (function, L37) [3] : Coin de la grille droite au centre de la case diagonale (c, r).
- `versDiagonalPoint` (function, L43) [2] : Point continu de la grille droite → coordonnées continues de la grille diagonale.
- `versDroitPoint` (function, L48) [1] : Point continu de la grille diagonale → grille droite.
- `polygoneDroit` (function, L57) [1] : Les 4 sommets, en coordonnées de la grille droite, d'un rectangle de cases diagonales [c, c+w) × [r, r+h) : un losange…
- `grilleDiagonale` (function, L71) [5] : La grille d'une île (en cases droites) vue dans le repère diagonal.
- `hauteursDiagonales` (function, L104) [2] : Hauteurs (une par case droite) → une par case diagonale : la plus haute des 4 chevauchées.
- `catalogueDiagonal` (function, L129) [6] : Le catalogue à l'échelle du repère diagonal : emprises divisées par √2 et arrondies (3 → 2, mesuré en jeu), portées euc…
### `src/optimizer/doublons.ts` — COPIES EN TROP D'UN MÊME SERVICE
- `copiesEnTrop` (function, L13) [4]
### `src/optimizer/emplacements.ts` — Pose d'un bâtiment d'emplacement : coin haut-gauche et orientation.
- `PoseEmplacement` (interface, L4) [0]
- `posesSurEmplacement` (function, L26) [3] : UN EMPLACEMENT EST UN ENDROIT PRÉDÉFINI
- `facadeDe` (function, L67) [2] : FAÇADE d'une pose : la rangée de cases le long du grand côté qui donne sur le plus de terre constructible.
### `src/optimizer/halfTileAdapter.ts` — Adaptateur ½-tuile ⇄ tuile pour l'optimiseur.
- `gridWithObstacles` (function, L22) [4] : Marque l'emprise des bâtiments donnés comme NON constructible (obstacle) sur une copie de la grille.
- `downscaleGrid` (function, L44) [29] : Inverse de upscale2x : ½-tuile → tuile (coin haut-gauche de chaque bloc 2×2).
- `upscaleBuildings` (function, L75) [1] : Bâtiments tuile → ½-tuile : position ×2 (l'emprise re-double via cellsPerTile=2).
- `upscaleTiles` (function, L80) [1] : Tuiles (route/champ/aqueduc) tuile → ½-tuile : 1 tuile → bloc 2×2 (route large 1 tuile).
- `scaleResultToHalfTile` (function, L91) [4] : Reprojette un résultat de plan d'île (tuile) en ½-tuiles si la grille d'origine l'était.
### `src/optimizer/invariants.ts`
- `TERRE_VIDE_MAX` (const, L17) [0] : Part de terre constructible laissée vide au-delà de laquelle un plan est suspect.
- `Severity` (type, L38) [0] : CE QU'UN PLAN D'ÎLE DOIT RESPECTER
- `Violation` (interface, L40) [1]
- `PlanContext` (interface, L47) [0]
- `checkPlan` (function, L60) [4] : Toutes les règles, dans l'ordre du catalogue.
- `groupByRule` (function, L328) [1] : Regroupe des violations par règle, pour l'inventaire.
### `src/optimizer/islandPlan.ts` — Choix des services à poser : - "auto" (défaut) : RECHERCHE DE RECETTE — on énumère les sous-ensembles minimaux qui franchissent les seuils du palier,…
- `IslandPlanRequest` (interface, L33) [8]
- `ImportGood` (interface, L189) [0]
- `IslandPlanResult` (interface, L195) [8]
- `planIsland` (function, L295) [3] : Point d'entrée UNIQUE du plan d'île.
- `planIslandImport` (function, L546) [18]
### `src/optimizer/islandPlanWorker.ts`
- `IslandPlanMsg` (type, L5) [1]
### `src/optimizer/kontor.ts` — COMPTOIR (kontor) — racine du réseau de routes et point d'entrée des marchandises.
- `pickKontorDef` (function, L38) [4] : Comptoir canonique du catalogue.
- `KontorReservation` (interface, L52) [0]
- `reserveKontor` (function, L70) [5] : Réserve une emprise de comptoir sur la CÔTE : toutes les cases sur la terre, au moins une case du périmètre sur la mer.
- `keepMainLandmass` (function, L236) [4]
- `KontorPlacement` (interface, L290) [0]
- `connectKontor` (function, L304) [4] : Pose le comptoir réservé et le raccorde au réseau routier produit par le moteur.
- `repairRoadConnectivity` (function, L443) [2] : RÉPARATION DE CONNEXITÉ du réseau routier.
- `OptionsLiaison` (interface, L708) [0] : Options de tracé des liaisons (comptoir, réparation des îlots).
- `PRIX_CASE_RASEE` (const, L730) [0] : UNE MAISON RASÉE COÛTE PLUS QU'UN DÉTOUR
### `src/optimizer/localProd.ts` — PRODUCTION FINALE SUR L'ÎLE — dépenser le budget d'attributs.
- `LocalProdOptions` (interface, L27) [0]
- `LocalWorkshop` (interface, L63) [1]
- `LocalProdResult` (interface, L81) [0]
- `planLocalProduction` (function, L111) [1] : Pose des ateliers de production finale tant que le bilan d'attributs de l'île le permet.
- `netOf` (function, L407) [1] : BILAN DES BIENS d'un ensemble d'ateliers : positif = produit ici, négatif = à acheminer en plus pour l'alimenter.
### `src/optimizer/maillageTriangles.ts` — LE MAILLAGE COMMUN : 4 TRIANGLES PAR CASE
- `HAUT` (const, L17) [2]
- `triangle` (const, L20) [1] : Indice du triangle `t` de la case droite (x, y).
- `trianglesDuCoin` (function, L23) [3] : Les 8 triangles d'une case diagonale centrée sur le coin (X, Y) de la grille droite.
- `trianglesDeCase` (const, L37) [1] : Les 4 triangles d'une case droite.
- `Occupation` (interface, L41) [0] : Ce qui occupe un triangle : -1 libre, sinon l'indice de l'objet (bâtiment ou route).
- `occupation` (function, L56) [10] : Projette un plan sur le maillage.
### `src/optimizer/planLattice.ts`
- `LatticeOpts` (interface, L19) [0]
- `SPINE_STEP` (const, L90) [0] : Espacement des épines verticales du peigne de routes.
- `HousePlot` (interface, L98) [2] : Une PARCELLE bâtie et les paliers qu'elle peut légalement accueillir, d'après les services qui la couvrent.
- `hostableTiers` (const, L112) [1] : Paliers qu'au moins une parcelle sait accueillir — le VIVIER de la cascade.
- `LatticeResult` (interface, L118) [1]
- `planLattice` (function, L175) [14]
### `src/optimizer/planQuality.ts` — QUALITÉ D'UN PLAN : CE QUE LE SOL DEVIENT
- `PlanRole` (type, L24) [0] : Rôle d'un bâtiment dans le plan, du point de vue de l'usage du sol.
- `roleOf` (function, L32) [2] : Rôle d'un bâtiment.
- `PlanQuality` (interface, L41) [2]
- `planQuality` (function, L56) [8] : Mesure l'usage du sol d'un plan.
- `Regroupement` (interface, L121) [1] : REGROUPEMENT ET ESPACEMENT DES SERVICES
- `regroupement` (function, L149) [2] : Mesure le regroupement des services d'un plan.
### `src/optimizer/plansAuChoix.ts` — PLANS AU CHOIX
- `PlanComparable` (interface, L19) [1] : Ce qu'un plan doit exposer pour être comparé.
- `Critere` (type, L28) [1]
- `LIBELLE_CRITERE` (const, L30) [1]
- `valeurCritere` (function, L38) [0] : Valeur d'un critère, PLUS GRAND = MEILLEUR (le bilan est la sévérité changée de signe).
- `PlanChoisi` (interface, L73) [0]
- `choisirPlansContrastes` (function, L83) [2] : Jusqu'à `max` plans contrastés, le `recommande` en tête — celui que la règle du moteur désigne ; les autres sont pris s…
### `src/optimizer/prixDuBilan.ts` — PRIX DU BILAN par défaut (cf.
- `PRIX_DU_BILAN` (const, L12) [2]
### `src/optimizer/recipes.ts` — CHOIX DE LA RECETTE DE SERVICES.
- `Recipe` (interface, L40) [0]
- `landTax` (function, L60) [1] : Taxe foncière d'un service : fraction d'île qu'occupent ses copies quand il pave l'île.
- `RecipeOptions` (interface, L92) [0]
- `candidateRecipes` (function, L140) [3] : Recettes candidates pour un palier cible, triées par population ESTIMÉE décroissante.
### `src/optimizer/roadCleanup.ts` — ÉLAGAGE DES CULS-DE-SAC
- `pruneDeadEnds` (function, L25) [4]
### `src/optimizer/runIslandPlan.ts` — Lance le planificateur d'île dans un Web Worker (UI non bloquée).
- `AnyIslandPlanResult` (type, L4) [2]
- `runIslandPlan` (function, L7) [4]
### `src/optimizer/slotPlan.ts` — EXPLOITATION DES EMPLACEMENTS DE TERRAIN LAISSÉS LIBRES.
- `SlotPlanOptions` (interface, L37) [0]
- `ExploitedSlot` (interface, L85) [1]
- `SlotPlanResult` (interface, L98) [0]
- `pickSlotBuilding` (function, L131) [3] : Meilleur bâtiment pour un type de slot : celui dont la production a la plus forte VALEUR MARCHANDE par minute (débit ×…
- `planSlots` (function, L167) [4]
### `src/optimizer/streetGrid.ts` — Primitives de grille/rue des moteurs de placement — partagées entre planLattice et packPlan jusqu'au retrait de ce dernier (2026-10-29).
- `StreetGridParams` (interface, L26) [0]
- `ReachState` (interface, L50) [2] : TypeCov minimal commun (le défunt packPlan y ajoutait `covered`).
- `Footprint` (type, L63) [2]
- `makeStreetGrid` (function, L65) [3]
### `src/optimizer/types.ts` — Un plan à poser dans l'éditeur (`applyOptimization`).
- `OptimizeResult` (interface, L9) [1]
### `src/optimizer/viability.ts` — CE MODULE EST LA SEULE SOURCE DE VÉRITÉ SUR « VIABLE »
- `BRUIT_VITAL` (const, L50) [4] : PLANCHER DE BRUIT DU MODÈLE D'ATTRIBUTS
- `verdictViable` (const, L58) [4] : VERDICT du plan LIVRÉ : tolérance joueur + plancher de bruit, par maison.
- `severiteVitale` (const, L72) [4] : DÉFICIT VITAL LE PLUS PROFOND, PAR MAISON
- `SEVERITE_INGERABLE` (const, L91) [1] : SÉVÉRITÉ au-delà de laquelle une ville est tenue pour ingérable, en points vitaux par maison.
- `populationEffective` (const, L113) [2] : POPULATION EFFECTIVE : LA POPULATION, ESCOMPTÉE DU RISQUE QU'ELLE PORTE
- `Weighed` (interface, L126) [2] : Une maison candidate, réduite à ce dont la sélection sous contrainte a besoin.
- `ViabilityOpts` (interface, L160) [0] : Réglages du garde-fou.
- `viableSubset` (function, L176) [3]
### `src/optimizer/waterPlan.ts` — Réseau d'eau (cf.
- `WATER_CAPACITY` (const, L22) [1]
- `MAX_RUN` (const, L23) [2]
- `CLIMB_MARGIN_Q` (const, L28) [0] : Marge de MONTÉE tolérée (en unités de hauteur quantifiée, 1 q = 16 unités jeu) : l'eau ne coule pas vers plus haut que…
- `DEBORD_AQUEDUC` (const, L41) [1] : DÉBORD HORS DE LA TERRE CONSTRUCTIBLE, en cases.
- `MOUNTAIN_BLOCK_RADIUS` (const, L46) [1] : Rayon (Chebyshev) de la zone montagne autour d'un slot : bloquée pour les moteurs de placement, mais posable/traversabl…
- `WaterConsumerReport` (interface, L61) [1]
- `WaterPlanResult` (interface, L68) [3]
- `waterDemandOf` (const, L96) [1] : Unités d'eau qu'un bâtiment prélève sur sa source (0 s'il n'en consomme pas).
- `needsWater` (const, L99) [3] : Le bâtiment a-t-il besoin du réseau d'eau ?
- `blockMountains` (function, L109) [5] : Réserve les emplacements de montagne dans une COPIE du masque usable — à donner aux moteurs de placement pour qu'ils n'…
- `planWater` (function, L142) [4] : Planifie le réseau d'eau pour une disposition donnée : pose les sources sur les slots montagne, trace les conduites en…
### `src/optimizer/workforceLedger.ts` — CASCADE DE MAIN-D'ŒUVRE — le grand-livre qui décide quelles maisons deviennent ouvrières.
- `Conversion` (interface, L32) [0] : Une conversion retenue, pour restitution à l'utilisateur.
- `SettleResult` (interface, L39) [0]
- `WorkforceLedger` (class, L69) [2]

## src/persist

### `src/persist/json.ts` — Télécharge la disposition + catalogue en fichier JSON.
- `exportJson` (function, L5) [1]
- `importJson` (function, L16) [1] : Ouvre un sélecteur de fichier et renvoie le contenu parsé.
### `src/persist/local.ts`
- `saveState` (function, L17) [1] : Sauvegarde auto dans le navigateur (localStorage).
- `migrateV7toV8` (function, L26) [2] : Suréchantillonne un layout TUILE (v7) en ½-tuiles (v8) : tout ×2, masques upscale2x.
- `loadState` (function, L99) [2]
- `clearState` (function, L124) [0]
### `src/persist/party.ts` — Normalise une valeur brute en PartyState valide (défauts si champs manquants/invalides).
- `PartyState` (interface, L6) [1]
- `emptyParty` (const, L11) [1]
- `normalizeParty` (function, L14) [1]
- `loadParty` (function, L24) [1]
- `saveParty` (function, L32) [1]
### `src/persist/png.ts` — Exporte un canvas en image PNG téléchargée.
- `exportPng` (function, L2) [1]

## src/prodlayout

### `src/prodlayout/basket.ts` — LE PANIER — ce que l'utilisateur a choisi, littéralement.
- `BasketLine` (interface, L13) [3]
- `Basket` (interface, L18) [2]
- `GoodFlow` (interface, L23) [0] : Un débit de bien, en unités par minute, exact.
- `Advisory` (interface, L30) [2] : Ce que le module ne peut pas vérifier hors terrain — signalé, jamais bloquant.
- `Balance` (interface, L35) [1]
- `normalizeBasket` (function, L49) [7] : Panier canonique : doublons fusionnés, comptes tronqués à l'entier, comptes ≤ 0 écartés, ordre total par defId.
- `balanceBasket` (function, L69) [4] : Production moins consommation, bien par bien, en rationnels exacts.
### `src/prodlayout/chain.ts` — DONNÉES DE CHAÎNE — la seule porte de ce module vers les données économiques.
- `eco` (const, L33) [3]
- `ratePerMin` (const, L36) [6] : Débit d'un bâtiment pour un bien, en unités par minute.
- `pickProducer` (function, L43) [8] : Producteur d'un bien, en préférant la région demandée.
- `goodName` (const, L49) [12]
- `isProducer` (const, L59) [2] : Le bâtiment produit-il réellement quelque chose ?
### `src/prodlayout/complete.ts` — COMPLÉTER LE PANIER — un geste explicite, jamais un effet de bord.
- `completeBasket` (function, L27) [2]
### `src/prodlayout/exit.ts` — LA SORTIE DE ROUTE — la seule règle qui ne vienne pas du catalogue.
- `ExitSide` (type, L13) [4]
- `ExitPoint` (interface, L15) [2]
- `EXIT_SIDES` (const, L21) [1]
- `ensureExit` (function, L42) [2] : Garantit une case de route sur le bord `side`, reliée aux `seeds` en distance-rue.
### `src/prodlayout/fields.ts` — CHAMPS ET AIRES LIBRES — les deux exigences de surface que le catalogue déclare.
- `FarmClaim` (interface, L15) [0]
- `FieldCell` (interface, L26) [1]
- `fillFields` (function, L37) [3]
- `reserveFreeArea` (function, L60) [2] : Réserve les cases libres à `radius` du bâtiment : plus rien ne s'y bâtira.
- `freeAround` (function, L88) [2] : Cases libres disponibles à `radius` du rectangle — sonde avant réservation.
- `reservedAround` (function, L107) [1] : Cases DÉJÀ réservées à `radius` du rectangle.
### `src/prodlayout/frac.ts` — Arithmétique rationnelle exacte.
- `Frac` (interface, L11) [2] : Rationnel réduit.
- `frac` (function, L18) [6]
- `addF` (const, L25) [2]
- `mulF` (const, L26) [2]
- `subF` (const, L27) [2]
- `divF` (const, L29) [2]
- `toNumber` (const, L34) [3]
- `commonMultiplier` (const, L39) [1] : Plus petit entier k ≥ 1 tel que k·f soit entier pour tout f — le lot parfait.
### `src/prodlayout/index.ts` — BLUEPRINTS DE PRODUCTION — la porte du module.
- `BasketPlanOptions` (interface, L21) [0]
- `BasketPlan` (interface, L32) [1]
- `pickWarehouse` (function, L48) [1] : Entrepôt canonique de la région : plus petit GUID, templates des deux mondes (`model/entrepot.ts`).
- `planFromBasket` (function, L77) [3] : Pose une commande libre de bâtiments : le plus petit plan ENTIÈREMENT servi, avec une sortie de route sur le bord deman…
### `src/prodlayout/occupancy.ts` — Grille d'occupation du blueprint.
- `FREE` (const, L7) [7]
- `BUILDING` (const, L8) [5]
- `ROAD` (const, L9) [6]
- `FIELD` (const, L10) [3]
- `RESERVED` (const, L12) [2] : Aire libre réservée autour d'un bâtiment à `freeArea` : traversable, jamais bâtie.
- `BLOCKED` (const, L21) [5] : Case hors de la FORME demandée : ni bâtie, ni traversée, ni comptée.
- `Occ` (interface, L23) [4]
- `makeOcc` (const, L29) [6]
- `inBox` (const, L35) [0]
- `at` (const, L39) [11] : Contenu d'une case, ou -1 hors limites.
- `setAt` (const, L42) [5]
- `fits` (function, L47) [4] : Le rectangle tient-il entièrement dans la boîte, sur des cases libres ?
- `fill` (function, L55) [40]
- `count` (function, L60) [32] : Nombre de cases portant une valeur donnée.
- `usableArea` (const, L67) [1] : Surface réellement disponible — le dénominateur honnête de l'efficacité.
### `src/prodlayout/pack.ts` — LE PLACEUR — glouton, à ordre total, sans une once d'aléa.
- `Rot0or90` (type, L28) [0]
- `Placement` (interface, L30) [0]
- `PackInput` (interface, L38) [3]
- `PackResult` (interface, L45) [2]
- `Copy` (interface, L74) [0] : Une copie à poser, dans l'ordre total de pose.
- `expandCopies` (function, L80) [1]
- `usefulArea` (function, L96) [1] : Surface utile estimée : emprises + champs + aires libres exigées.
- `tryBox` (function, L210) [3] : Pose la commande dans une boîte de dimensions données, et rend ce qui manque.
- `better` (function, L424) [5] : ORDRE TOTAL : servi, puis petit, puis carré.
### `src/prodlayout/roads.ts` — SQUELETTE ET PORTÉE.
- `SpineAxis` (type, L11) [0]
- `paintSkeleton` (function, L36) [4] : Épine dorsale à `spinePos` et branches perpendiculaires tous les `pitch`.
- `roadComponents` (function, L57) [1] : Étiquette les composantes de la voirie.
- `connectRoads` (function, L101) [2] : Raccorde les îlots de voirie à la composante principale, par le couloir LIBRE le plus court, en ligne droite.
- `adjacentRoads` (function, L150) [3] : Indices des cases ROUTE contiguës aux quatre côtés d'un rectangle.
- `touchesRoad` (const, L166) [4]
- `roadDistances` (function, L174) [5] : Distance-rue depuis un ensemble de graines.
### `src/prodlayout/search.ts` — LE CHOIX DE LA BOÎTE.
- `BoxSpec` (type, L16) [2]
- `searchBox` (function, L24) [2]
### `src/prodlayout/unmet.ts` — CE QUI MANQUE, CHIFFRÉ.
- `Unmet` (type, L11) [1]
- `PlanRefus` (interface, L19) [1]
- `direUnmet` (function, L26) [2] : Phrase lisible pour un manque — l'interface l'affiche telle quelle.

## src/render

### `src/render/draw.ts`
- `View` (interface, L5) [2]
- `HoverPreview` (interface, L11) [1]
- `DrawOpts` (interface, L19) [0]
- `gridToScreen` (const, L31) [0]
- `screenToGrid` (function, L51) [1]
- `drawScene` (function, L58) [2]
### `src/render/exportImage.ts` — View qui fait tenir TOUTE la grille (w×h cases) dans `maxPx`, marge incluse — indépendant du zoom/pan courant de l'éditeur.
- `fitView` (function, L9) [1]
- `renderFullCanvas` (function, L27) [1] : Rend la disposition ENTIÈRE sur un canvas hors-écran (toute l'île, pas le viewport visible).
- `downloadLayoutPng` (function, L50) [0] : Télécharge le rendu plein cadre d'un layout en PNG.

## src/state

### `src/state/store.ts`
- `Tool` (type, L20) [1]
- `useStore` (const, L110) [21]

## src/ui

### `src/ui/BuildingIcon.tsx` — Chemin relatif de l'icône (ex: "icons/xxx.png"), absent si non extraite.
- `BuildingIcon` (function, L22) [3] : Icône d'un bâtiment, avec repli automatique sur une pastille de sa couleur.
### `src/ui/Catalog.tsx`
- `Catalog` (function, L9) [10]
### `src/ui/CatalogEditor.tsx`
- `CatalogEditor` (function, L14) [1]
### `src/ui/CommandePlanner.tsx` — ONGLET COMMANDE — le joueur commande, le moteur dispose.
- `CommandePlanner` (function, L36) [1]
### `src/ui/CoveragePanel.tsx`
- `CoveragePanel` (function, L19) [1] : Diagnostic de couverture des services publics : rapport par service (% de résidences servies) et surlignage des maisons…
### `src/ui/EditorView.tsx` — Vue ÉDITEUR : catalogue · canvas (avec palette flottante + toggles diagnostics) · panneau droit qui montre l'inspecteur ou un diagnostic (couverture…
- `EditorView` (function, L11) [1]
### `src/ui/GridCanvas.tsx`
- `GridCanvas` (function, L8) [2]
### `src/ui/IslandPicker.tsx`
- `IslandPicker` (function, L11) [2]
### `src/ui/IslandPlanner.tsx`
- `IslandPlanner` (function, L43) [2]
### `src/ui/Modal.tsx` — Coquille de modale partagée : backdrop, stop-propagation, fermeture au clic backdrop, Escape, rôle/aria-modal et focus à l'ouverture.
- `Modal` (function, L15) [6]
### `src/ui/MondeView.tsx` — ONGLET MONDE — la planification globale d'une partie.
- `MondeView` (function, L46) [1]
### `src/ui/PlanifierView.tsx`
- `PlanifierView` (function, L22) [1] : Écran Planifier : un seul point d'entrée pour planifier une île, avec trois façons de le faire (commande à la main, rem…
### `src/ui/ProductionPlanner.tsx` — ÎLE DE PRODUCTION — le joueur demande des biens et un débit, le moteur de la commande pose.
- `ProductionPlanner` (function, L35) [1]
### `src/ui/RoadAudit.tsx` — Audit des données : liste tous les bâtiments marqués SANS route (`needsRoad === false`).
- `RoadAudit` (function, L18) [1]
### `src/ui/SidePanel.tsx`
- `SidePanel` (function, L5) [1]
### `src/ui/ToolPalette.tsx`
- `ToolPalette` (function, L20) [1] : Palette d'outils flottante (verticale) sur le canvas — remplace la barre horizontale.
### `src/ui/TopBar.tsx`
- `TopBar` (function, L12) [1]

## src/ui/components

### `src/ui/components/ChipMultiSelect.tsx` — Multiselect à chips : puces des sélectionnés (× pour retirer) + recherche + liste d'ajout.
- `ChipMultiSelect` (function, L13) [1]
### `src/ui/components/DieuSelect.tsx` — Dévotion : celle qu'atteindra l'île (sa Foi), ou un palier imposé.
- `ChoixDevotion` (type, L4) [3]
- `DieuSelect` (function, L23) [3] : Choix du dieu tutélaire et de sa dévotion.
### `src/ui/components/IslandThumb.tsx` — VIGNETTE D'UNE ÎLE, pour la reconnaître d'un coup d'œil : terre constructible, relief, rivières et bande d'eau côtière, d'après les zones du jeu (`te…
- `IslandThumb` (function, L32) [3]
### `src/ui/components/PlanPreview.tsx` — Carte de prévisualisation d'un plan — colorée par PALIER ATTEINT, navigable, et capable de montrer la portée réelle d'un service au survol.
- `PlanPreviewProps` (interface, L25) [0]
- `PlanPreview` (function, L81) [4]
- `PlanPreviewLegend` (function, L327) [1] : Légende : une pastille par palier présent + les repères de lecture.
### `src/ui/components/PlansAuChoix.tsx`
- `PlansAuChoix` (function, L28) [1] : PLANS AU CHOIX : une carte par plan proposé, le recommandé d'abord.
### `src/ui/components/RoadTypeSelect.tsx` — Choix du type de route d'un plan.
- `RoadTypeSelect` (function, L12) [5]
### `src/ui/components/RunPanel.tsx` — Bandeau d'action partagé : boutons + barre de progression + message d'erreur.
- `RunPanel` (function, L17) [3]
### `src/ui/components/chipFilter.ts` — Filtre pur : options dont le label matche `query` (insensible casse/accents), hors déjà sélectionnés.
- `Opt` (interface, L1) [1]
- `filterOptions` (function, L6) [2]

## src/ui/monde

### `src/ui/monde/AssistantMonde.tsx`
- `EtapeAssistant` (type, L15) [1] : ASSISTANT D'UNE CONFIGURATION DE MONDE — une grande fenêtre au premier plan, en trois étapes : le nom, les îles de la c…
- `AssistantMonde` (function, L33) [1]
### `src/ui/monde/ResultatMondeVue.tsx`
- `ResultatMondeVue` (function, L29) [1]

## src/ui/shell

### `src/ui/shell/AppShell.tsx`
- `AppShell` (function, L12) [1] : Coquille de l'application : nav latérale + barre du haut + contenu du mode courant.
### `src/ui/shell/NavRail.tsx` — Barre de navigation latérale : modes de l'application + bascule de MONDE.
- `NavRail` (function, L11) [1]
