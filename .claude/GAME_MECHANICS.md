# Anno 117 Pax Romana — Mécaniques réelles du jeu (référence planner) — v2

Registre d'hypothèses validées/réfutées. Campagne de recherche 2026-06-11 (plan
`ultrathink-tip-important-on-smooth-catmull.md`). Verdicts :
**[FICHIERS]** = prouvé dans les données du jeu (source exacte citée) ;
**[WEB]** = source communautaire (confiance moindre) ;
**[IN-GAME]** = testé par l'utilisateur ;
**[OUVERT]** = non tranché (voir checklist tests in-game §13).

Sources fichiers : `.gamedata/assets_base.xml` (AB), `.gamedata/templates.xml` (T),
dumps `.gamedata/research/*.json` (script `tools/_dump_research.py`),
`.gamedata/med01_gamedata.data` (île médium, FileDB).

---

## 1. Grille & routes

- **[FICHIERS]** Portée des services = DISTANCE PAR LA RUE (`EffectScope StreetDistance`,
  ×1279 dans AB). `RadiusDistance` = préviz UI seulement. Pattern systématique :
  **street = radius + 4** sur tous les services.
- **[FICHIERS]** Coûts routes (argent 1010017) : terre **5**, pavée **40**, route de
  marais (Celtic) 10, pont bois 10 / pavé 20, quai bois/pierre/marbre 10/40/80,
  ponts-canaux celtiques 10/20/25. Pavée = vitesse charrettes (aucun `RangeFactor`
  trouvé → ne change PAS la portée des services). [OUVERT in-game #7 pour confirmation]
- **[FICHIERS]** Rues de quai = template `Street` → routes normales pour
  réseau/couverture (H1.9).
- **[FICHIERS]** `BridgeLengthMax = 16` (MeshGraphBalancing 43985).
- **[FICHIERS]** `StreetActivation` sur les templates PublicService/CityInstitution/
  MiniInstitution/AqueductDistributor : service non raccordé = inactif.
- **[WEB devblog]** Connexion par le COIN comptée (8-adjacence) — notre modèle
  4-adjacence est plus strict = conservateur. [OUVERT in-game #3]
- [OUVERT] Distance-rue en diagonale (coût 1/tuile ?), grille 45° sous-tuiles.

## 2. Services publics — TABLE COMPLÈTE DES PORTÉES [FICHIERS]

Défauts templates : PublicServiceBuilding & CityInstitutionBuilding **26 street / 22
radius** ; MiniInstitutionBuilding **22/18** ; AqueductDistributor 26/22 (citerne
override 36/36) ; MonumentEventBuilding 90/84 (Colisée override 250).

| Bâtiment (Roman) | street | radius | | Bâtiment (Celtic) | street | radius |
|---|---|---|---|---|---|---|
| Marché | 28 | 24 | | Marché | 28 | 24 |
| Taverne (défaut tpl) | 26 | 22 | | Fanum | 36 | 32 |
| Grammaticus (défaut tpl) | 26 | 22 | | Grammaticus (défaut) | 26 | 22 |
| Sanctuaire | 38 | 34 | | Sporting Grounds | 38 | 34 |
| Citerne d'aqueduc | 36 | 36 | | Citerne | 36 | 36 |
| Maison de jeu | 42 | 38 | | Maison de jeu | 42 | 38 |
| Théâtre | 50 | 46 | | Théâtre | 50 | 46 |
| Bibliothèque | 62 | 58 | | Town Hall | 46 | 42 |
| Bains (wonder) | 66 | 62 | | Bains | 66 | 62 |
| Temple (wonder) | 68 | 64 | | Temple | 68 | 64 |
| Forum (wonder) | 70 | 66 | | Barrow (wonder) | 66 | 62 |
| **Colisée** (wonder) | **250** | 250 | | Sacred Grove (wonder) | 68 | 64 |

Institutions anti-incidents (portée street) : **Vigiles (feu) 30**, **Medicus
(maladie) 38**, **Préfecture (émeute) 34** ; versions Mini (early game) 20/24/20 ;
celtiques idem mini. Shrines (mini-services) : 16-24 street.

- **[FICHIERS]** Pas de falloff dans `Effect` → couverture binaire à la coupure.
- [OUVERT] H2.13 : des bâtiments de PROD donneraient des bonus pop en rayon
  (« bakery +2 pop/maison » vu en guide [WEB] + TextPools « Tavern Supplied ») — à
  vérifier : 2e système de desserte par bâtiment de production ?

## 3. Résidences & besoins

- **[FICHIERS]** `UpgradeThreshold` par catégorie (somme des `SupplyWeight` des
  besoins REMPLIS, sous-ensemble au choix) : T1 Public1/Food1/Fashion1 ;
  T2 3/3/3/Household2 ; T3 7/7/7/6/Wonders4 ; T4 Patriciens 15/15/15/14/12/Culture8.
  Identique Roman/Celtic (Smiths=T2, Alderman/Nobles=T3-équivalent).
- **[FICHIERS]** Upgrade MANUEL : `Upgradable/PossibleUpgrades` avec `Cost`
  (argent 1010017 + matériaux 2174/2176…). Patriciens/Nobles/Alderman : `<Upgradable />`
  vide = tier final.
- **[WEB]** Conso de biens liée au NOMBRE DE MAISONS, pas à la population
  (« tied to the amount of residence buildings alone ») — conforme à notre modèle
  NeedConsumptionRate par maison. [OUVERT in-game #4 pour trancher plein/vide]
- **[FICHIERS]** Capacité = Σ `Population` des NeedAttributes des besoins remplis (v1).
- **[FICHIERS]** `EconomyFeature7` : `ProductivityDeltaSpeedPos/Neg = 0.333`
  (vitesse de transition de productivité), `MissingWorkforce/WorkforceThresholdInPercent = 10`.
- [OUVERT] Workforce manquante → productivité proportionnelle ou tout-ou-rien ?
  (guides [WEB] : « efficiency plummets, halting production »).

## 4. Eau & aqueducs (mécanique critique T3+)

Budget par source (`WaterVolumeSupply = 100`, basins Roman 19691 / Celtic 29524) :

| Consommateur | Conso | Type | Source |
|---|---|---|---|
| **Colisée** (3621) | **50** | Mandatory | [FICHIERS] AB AqueductConsumer |
| Bains | 25 | Mandatory | [FICHIERS] |
| Forum | 15 | Mandatory | [FICHIERS] |
| **Citerne** (19753/29526) | **10** | (distributeur) | [FICHIERS] T `WaterConsumption=10`, non overridé |
| Champs (oats/hemp/wheat/grapes/lavender/olives/flax/herbs/barley/dye) | 5 | Optional (+buff prod) | [FICHIERS] |
| Mines (iron/gold/silver/tin/copper/coal) | 10 | Optional (+buff) | [FICHIERS] |
| Carrières (limestone/marble/minerals/granite) | (conso après unlock 26950 « Hushing ») | Optional | [FICHIERS] |

⚠ Conséquence : les 3 wonders romains = 90u → quasi une source ENTIÈRE ; chaque
citerne mange 10u → une source alimente au mieux 10 citernes (et zéro wonder).
Les slots montagne (7 sur medium_01) deviennent une ressource de design rare.

- **[IN-GAME]** Conduite JAMAIS sur case route ; croisement perpendiculaire OK
  (l'arche enjambe) ; pas de terminus/virage/jonction sur route.
- **[IN-GAME]** **NO-MERGE** : impossible de raccorder 2 réseaux pour cumuler l'eau.
  1 réseau = 1 source. Planner : conduites de réseaux ≠ ne partagent jamais une case.
- **[WEB Steam]** H1 (2 arches) / H2 (3 arches) / tours : l'eau perd de la hauteur
  avec la longueur ; descendre regagne, monter perd plus vite ; sous le min H1 → stop.
  Tour = reset à max-H1 (pénalise la portée). **Citerne attachée = « fausse tour »
  SANS réduction de hauteur**. Pas de constantes publiées. [OUVERT in-game #1]
- [OUVERT] H4.20 : une conduite peut-elle en CROISER une autre ? (impacte le routage)
- [OUVERT] Priorité de coupure si Σ conso > 100 (Mandatory d'abord ?).
- **[FICHIERS]** Heightmap île DISPONIBLE (cf. §7) → pente réelle calculable.

## 5. Production & chaînes

- **[FICHIERS]** `FreeAreaProductivity` — productivité fonction de l'AIRE LIBRE
  (ne pas enclaver !) :

| Bâtiment | InfluenceRadius | NeededArea |
|---|---|---|
| Bûcheron (wood) | 8 | 80 |
| Charbonnier | 9 | 80 |
| Résine | — | 45 |
| Ruches (miel) | 8 | 80 (Beehive) |
| Anguilles (marais) | 9 | 140 |
| Oiseaux (marais) | 10 | 180 |
| Castor (Celtic) | 10 | 180 |
| Poneys Dartmoor | 10 | 140 (Meadow) |

- **[FICHIERS]** 31 productions exigent une FERTILITÉ (`NeededFertility`) — y compris
  CÔTIÈRES (maquereaux 2206, escargots de mer 4051, huîtres 2208) et MINIÈRES
  (fer 4049, or 32027, marbre 4062…). 51 items/techs AJOUTENT des fertilités.
- **[FICHIERS]** Fertilités PAR PARTIE, pas par île : `RandomIsland` ne référence
  que le fichier .a7m (aucun FertilitySet). → Le planner doit DEMANDER à
  l'utilisateur les fertilités de son île (saisie).
- **[FICHIERS]** `MaxTransporterRange` (distance-rue prod↔entrepôt) : **30 défaut**
  (85 assets) ; **40** = côtiers (sardines, snails, huîtres, coques), champs de base
  (avoine/chanvre/blé), crafts (tissu, coussins, bois ouvragé), porridge, concrete,
  cordes/voiles, anguilles ; **45** = olives ; **70** = raisin, lin, caviar ;
  **80** = SEL et SILICE.
- **[FICHIERS]** Feu : `HeatValue 2` + `BurstDistance 25 / BurstCount 6` sur les
  MINES (gros risque, sauts à 25 tuiles !) ; côtiers 9/3 ; pâturages 10/2 ;
  carrières 10/2. → coupe-feux et vigiles près de l'industrie.
- [OUVERT] Prod ferme ∝ nb de cases champ ? (in-game #5).
- **[IN-GAME]** Champs en FORME LIBRE (confirmé utilisateur 2026-06-12) : aucune
  contrainte de rectangle — n'importe quelle forme, même non lisse, tant que chaque
  tuile est 4-adjacente à au moins une autre tuile du champ (blob connexe) et qu'au
  moins une tuile touche le bâtiment de ferme. Planner : croissance BFS (greedy.ts
  placeFields), acceptation d'une ferme = cases ATTEIGNABLES ≥ tuiles requises.

## 6. Logistique & entrepôts [FICHIERS]

- **Entrepôts TERRESTRES : `StorageMax = 0`** — ils n'ajoutent AUCUNE capacité de
  stockage, ce sont des points d'accès logistiques (charrettes). Niveaux 1/2/3 :
  parallélisme de traitement —/4/6 (`ProcessingQueueParallelCount`), LoadingSpeed 0.15.
- **Entrepôts PORTUAIRES (Harbor Warehouse 1/2/3) : StorageMax 75/150/250**,
  parallélisme —/4/6. Harbor Depot : +100. → La capacité de stock d'île vient du PORT.
- Stock partagé à l'échelle de l'île (v1) ; biens des maisons : pas de contrainte
  de distance (consommation depuis le stock).
- **[WEB]** Pas de transfert de workforce inter-île en vanilla (un mod existe pour ça).

## 7. Terrain — HEIGHTMAP EXTRACTIBLE [FICHIERS]

- **`med01_gamedata.data` → `TerrainManager/HeightMap`** : 641×641 (= 2×320+1,
  grille demi-tuile) **int16** ; mer < 0 (≈ −2000), terre > 0 (max 3155, médiane 380).
  Validé : slots montagne à 303-865 (pied des reliefs). `DisplacementHeightMap` idem.
  → `build_terrain.py` peut exporter hauteur/pente par île (échelle d'unité à
  calibrer in-game vs `SteepnessMaxHeightDiff`).
- **`WorldManager`** : `Water` (bitmask), `RiverGrid` (déjà extrait), **`FordGrid`**
  (gués ?), `EnvironmentGrid` (val 6400o). **`IrrigationManager/m_StaticTileGrid`** :
  tuiles irrigables statiques (irrigation naturelle le long des rivières ? [OUVERT]).
- **[FICHIERS]** `SteepnessMaxHeightDiff` : seulement 15 assets l'overrident
  (gros bâtiments = 5 ; Bains = 3). Le défaut des autres bâtiments est dans le
  template (non trouvé explicitement → probablement valeur moteur).
- a7minfo : slots (déjà extraits) + StartCoastDirection. PAS de fertilités.

## 8. Économie

- **[FICHIERS]** Entretien argent = Product 1010017/min (v1). Workforce par tier (v1).
- **[FICHIERS]** Romanisation (Albion) : PAR BÂTIMENT — `RomanizationType`
  Roman/Regional, `RomanizationValue` 10-25 (shrines 25, Grammaticus 10). Le choix
  des bâtiments (romains vs régionaux) déplace la jauge.
- [OUVERT] Revenu par habitant (pas de slider taxes apparent), prix PNJ fixes.

## 9. Wonders & monuments [FICHIERS]

- **Colisée** : bâtiment final = `MonumentEventBuilding` 3621 « Wonder Roman
  Colosseum », **street 250** (couvre l'île entière — PAS de contrainte de
  centrage), **`BuildingUnique`**, **eau 50u Mandatory**, pente max 5. CHANTIER =
  3 assets `Monument` (Phase 0/1/2) — construction par phases avec livraisons.
  `MonumentEvent` : jeux du Colisée (Small/Medium/Grand) = events activables.
- Forum/Bains/Temple = `PublicServiceBuilding` ordinaires (construction instantanée),
  catégorie de besoin `Wonders`.
- **[FICHIERS] Poids Wonders : Forum 4, Bains 4, COLISÉE 8.** Seuil T4 Patriciens
  Wonders = 12 → Forum+Bains (8) NE SUFFISENT PAS : **le Colisée est OBLIGATOIRE
  pour monter Patricien** (8+4=12). Tout plan T4 doit l'inclure (unique, 50u d'eau,
  chantier 3 phases).
- **[FICHIERS]** Catégorie Culture (seuil T4 = 8) : biens de luxe Lyres (2785),
  Chars (2781), Jeux de plateau (145225) — w=8 chacun → UN des trois suffit.
- Pas de Circus Maximus constructible (textes narratifs seulement).

## 10. Incidents

- **[FICHIERS]** Propagation feu par SAUTS euclidiens : `BurstDistance`/`BurstCount`
  par bâtiment (mines 25/6 !, côtiers 9/3, pâturages 10/2). `HeatValue` = risque.
- **[FICHIERS]** Contre-mesures = CityInstitution/MiniInstitution à portée STREET
  (vigiles 30, medicus 38, préfecture 34 ; minis 20/24/20).
- Citerne/besoins donnent FireSafety/Health (réduction de risque, v1).

## 11. Côtier & maritime

- **[FICHIERS]** Rues de quai = routes normales (template Street).
- **[FICHIERS]** Pêcheries/côtiers : fertilités côtières requises (maquereaux,
  huîtres…), MaxTransporterRange 40-80.
- LoadingPier/piers : débit navire (LoadingSpeed 0.15). [non bloquant planner v1]

## 12. Albion / celtique

- **[FICHIERS]** Services celtiques : portées dans la table §2. Citerne celtique
  29526 = 36/36, basin celtique 29524 = 100u. Mêmes mécaniques d'eau.
- **[FICHIERS]** Prods de marais (anguilles, oiseaux, etc.) : `CanBePlacedOnNonMarsh=1`
  → posables AUSSI hors marais. Route de marais dédiée (coût 10).
- **[FICHIERS]** Romanisation par bâtiment (cf. §8).

## 13. CHECKLIST TESTS IN-GAME (pour l'utilisateur — à plus fort levier)

1. **Aqueduc plat** : tracer une conduite droite sur terrain plat depuis une source ;
   noter la longueur exacte à laquelle l'eau s'arrête (départ H2 vs H1 si possible).
   → calibre la constante de pente + l'échelle de la heightmap.
2. **Citernes par source** : sur 1 source isolée, raccorder des citernes une à une ;
   noter à combien la dernière se désactive (attendu : 10).
3. **Coin de route** : maison touchant une route uniquement par le COIN — s'active ?
   reçoit les services ? (attendu : oui d'après devblog).
4. **Conso par maison** : île figée, noter la conso t/min d'un bien ; poser 10
   maisons VIDES de plus ; re-noter (attendu si « par maison » : +10×taux immédiat).
5. **Ferme à moitié de champs** : ferme avec 50 % des modules — productivité 50 % ?
6. **Propagation feu** : (optionnel, sauvegarde !) feu près d'une mine — distance des
   sauts (attendu 25 tuiles).
7. **Route pavée** : portée d'un marché et zone charrette d'une prod : identiques
   sur terre vs pavé ? (attendu : oui).
8. **Croisement conduite × conduite** (H4.20) : tenter de croiser 2 conduites de
   réseaux différents perpendiculairement (attendu : refus ?).
9. **Σ conso > 100** : sursaturer une source (ex Bains+Forum+Colisée+citernes) ;
   qui se désactive en premier ?

## 14. BACKLOG DE FIXES PLANNER (classé par impact)

1. **Citernes = 10u** dans waterPlan (actuellement 0) + nb max citernes/source ;
   re-dimensionner les sources par île (3 wonders = 90u → source dédiée).
2. **Colisée** : OBLIGATOIRE pour T4 (Wonders 12 = Colisée 8 + Forum/Bains 4).
   Unique, street 250 = zéro contrainte de placement couverture, MAIS 50u d'eau
   Mandatory + chantier 3 phases. Le planner T4 doit le poser + le compter dans
   le besoin d'eau et le seuil d'upgrade.
3. **Portées complètes** (§2) : vérifier catalog.generated vs table — notamment
   les défauts hérités 26/22 (Taverne/Grammaticus OK) et institutions (vigiles…)
   absentes de nos services de tier (elles ne sont PAS des besoins → placement
   anti-incidents = feature séparée).
4. **Heightmap** : étendre build_terrain.py (hauteur quantifiée + pente par tuile)
   → aqueducs en pente réelle + constructibilité des pentes.
5. **Entrepôts** : archetype production — le STOCKAGE vient du port ; les entrepôts
   terrestres = accès charrettes (MaxTransporterRange par bâtiment, table §5).
6. **FreeAreaProductivity** : contrainte de non-enclavement pour bûcherons/ruches/
   marais (rayon + aire libre, table §5).
7. **Fertilités** : UI de saisie des fertilités de l'île (par partie) + filtrage
   des chaînes possibles.
8. **Coin-adjacence** (si in-game #3 confirme) : couverture 8-adj → plus de maisons.
9. **Anti-incidents** : vigiles/medicus/préfecture en placement optionnel (portées §2,
   burst data §10).
10. **Romanisation** (si Albion) : choix bâtiments romains vs régionaux.

## 15. Sources

- Fichiers jeu : assets_base.xml, templates.xml (extraits config.rda), gamedata.data
  des îles (RDA imbriqué .a7m), dumps `.gamedata/research/`.
- [DevBlog roads & grid](https://www.anno-union.com/devblog-roads-building-in-the-grid/) — coins/diagonales.
- [Mod Public Buildings Use Radius](https://mod.io/g/anno-117-pax-romana/m/public-buildings-use-radius-taludas) — vanilla = street.
- [Steam : observations aqueducs](https://steamcommunity.com/app/3274580/discussions/0/802331493180488207/) — H1/H2/tours qualitatif, citerne fausse-tour.
- [GameRant : aqueducs](https://gamerant.com/anno-117-pax-romana-how-build-aqueduct/), [Deltia's Gaming](https://deltiasgaming.com/how-to-build-aqueducts-in-anno-117-pax-romana/).
- [Steam : consumption per house](https://steamcommunity.com/app/3274580/discussions/0/684112727828918553/), [Into Indie Games éco](https://intoindiegames.com/walkthroughs/anno-117-pax-romana-money-and-economy-guide/).
- [Calculateur communautaire anno-117-calculator](https://anno-mods.github.io/anno-117-calculator/) — validation croisée des chaînes.
- [Mod workforce inter-île](https://mod.io/g/anno-117-pax-romana/m/workforce-transfer-between-islands-crash-fixed) — confirme pas de navettage vanilla.
- Historique v1 (notes détaillées NeedsList/capacités/solveur) : voir git history de ce fichier.
