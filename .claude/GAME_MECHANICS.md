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

- **[FICHIERS]** Portée des SERVICES = DISTANCE PAR LA RUE (`EffectScope StreetDistance`,
  ×1279 dans AB). Pattern systématique : **street = radius + 4** sur tous les services.
  ⚠ `RadiusDistance` n'est PAS une simple préviz d'interface (correction 2026-08-06) : c'est
  la portée réelle des effets dont `EffectScope = Radius` — voir §2. Les deux valeurs
  coexistent parce qu'elles servent deux mécaniques distinctes.
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
- **[FICHIERS] H2.13 CONFIRMÉE (2026-08-06) — EFFETS DE ZONE À RAYON EUCLIDIEN.**
  Oui, des bâtiments de PRODUCTION modifient les attributs des résidences autour d'eux.
  Chaîne dans les fichiers : `Building/FunctionalEffects` → asset `Effect` → `BuildingBuff`
  dont `BuildingUpgrade/AdditionalAttributes` porte les deltas. **140 bâtiments** en portent.
  - `EffectScope = Radius` (86 bâtiments) → distance **EUCLIDIENNE**, valeur = `RadiusDistance`,
    portées 20 à 30. C'est le cas des ateliers, mines et carrières.
  - `EffectScope = StreetDistance` (54 bâtiments) → distance le long des rues, valeur =
    `StreetDistance`. C'est le cas des services et des institutions.
  - `IsStackable` : les MALUS cumulent (3 mines côte à côte = −6 Santé), les bonus non.
  - Attributs touchés : Health 46, FireSafety 45, Happiness 36, Money 36, Prestige 25,
    **Population 23**, Knowledge 13, Belief 9.
  - Exemples : Mine de fer −2 Santé (r20, cumulable) · Charbonnière −3 Santé −3 Incendie
    (r20, cumulable) · Lyrier +1 Argent +1 Bonheur (r24) · Épicurien de l'eau +1 Population
    +1 Santé (r28) · Bains +2 Population +2 Santé +3 Incendie (street 66).
  - **Conséquence de design** : une mine près des maisons COÛTE, un atelier de luxe RAPPORTE.
    Extrait dans `economy.generated.json → buildingEffects`. Non encore exploité par
    l'optimiseur de placement.
  ⚠ Corrige aussi §1 : « `RadiusDistance` = préviz UI seulement » est FAUX. C'est la portée
  réelle des effets à `EffectScope = Radius`. Le pattern « street = radius + 4 » reste vrai,
  mais les deux nombres servent à deux mécaniques différentes.

## 2 bis. RANG DE CITÉ — malus d'échelle [FICHIERS, 2026-08-06]

`EconomyFeature7/CityStatusFeature/Region/<Roman|Celtic|Egyptian>/CityStatusList` : le rang
d'une ville est déterminé par sa **population totale**, et chaque rang applique des deltas
d'attributs à **TOUTES** ses résidences (assets `CityStatus`, `AttributeEffects*`).
**40 paliers** côté romain.

| population ≥ | Bonheur | Santé | Incendie | Croyance | Connaissance | Prestige |
|---|---|---|---|---|---|---|
| 0 | — | — | — | — | — | — |
| 500 | | | −1 | +1 | | |
| 1 000 | −2 | | −2 | +2 | +1 | |
| 3 000 | −6 | −4 | −4 | +4 | +3 | +2 |
| 7 500 | −10 | −8 | −6 | +6 | +5 | +4 |
| 20 000 | −13 | −10,4 | −6,6 | +9 | +8 | +7 |
| 70 000 | −15,8 | −12,4 | −7,9 | +19 | +18 | +17 |
| 260 000 | −18,2 | −14,7 | −9,8 | +30 | +29 | +28 |

**L'échelle et les effets ne se lisent pas au même endroit** (corrigé le 2026-08-06, cf. §17).
Les **seuils** viennent du MONDE — 40 rangs jusqu'à 260 000 habitants en Latium, **25 rangs
jusqu'à 47 500 seulement** en Albion. Les **effets**, eux, existent en trois variantes par
rang (`AttributeEffectsRoman` / `Mixed` / `Regional`), une par culture de population. En
Latium les trois sont identiques ; en Albion elles divergent nettement — au dernier rang :

| culture d'Albion | Bonheur | Santé | Incendie | Croyance | Connaissance |
|---|---|---|---|---|---|
| romaine (`Roman`) | −10,6 | −12,0 | −8,2 | +23 | +33 |
| romanisée (`Mixed` — Mercators, Nobles) | **−17,4** | −9,35 | −5,1 | +34,5 | +33 |
| native (`Regional` — Tourbiers…Aldermen) | −12,6 | −6,7 | −1,95 | +34,5 | +22 |

⚠ **Contrainte de fond ignorée jusqu'ici.** Les plans produits par l'optimiseur atteignent
38 000 à 570 000 habitants : ils encaissent donc **−15 à −18 en Bonheur, −12 à −15 en Santé,
−8 à −10 en Sécurité incendie** sur chaque maison, qu'il faut compenser par les services et
les ateliers à effet positif (§2). Extrait dans `economy.generated.json → cityStatus`.
Non encore appliqué par l'optimiseur.

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

## 5 bis. MAIN-D'ŒUVRE [FICHIERS, 2026-08-06]

Chaque palier fournit **un** bien de main-d'œuvre qui lui est propre
(`PopulationLevel/ConnectedWorkforce`), en quantité `habitants × PopulationToWorkforceFactor`.
Ces biens portent `IsWorkforce=1` et `StorageLevel=Area` : **le pool est par ÎLE**, rien ne
circule entre îles (`WorkforceTransferConfig` ne décrit que l'animation des dockers).

| monde | palier | bien | facteur |
|---|---|---|---|
| Latium | Liberti / Plébéiens / Equites / Patriciens | 2181 / 2184 / 2185 / 2186 | 0,5 / 0,3 / 0,2 / 0,1 |
| Albion natif | Tourbiers / Forgerons / Aldermen | 2192 / 2196 / 2197 | 0,5 / 0,3 / 0,2 |
| Albion romanisé | Mercators / Nobles | 2198 / 2199 | 0,3 / 0,2 |

⚠ **AUCUNE SUBSTITUTION ENTRE PALIERS.** Aucune table de conversion n'existe dans les
fichiers. Un palier supérieur ne remplace **jamais** un palier inférieur : une île de
Patriciens purs ne fait tourner **aucun** atelier réclamant des Plébéiens, quelle que soit
sa population. Le coût est déclaré par `Maintenance/Maintenances/Item` dont le `Product` est
un bien de main-d'œuvre — et sur les 151 bâtiments extraits, **aucun n'en réclame deux**.
La contrainte est donc un simple système d'inégalités, une par palier.

**MAIN-D'ŒUVRE OFFERTE.** Le comptoir alimente le pool sans aucune maison, via
`Distribution/Deltas`. Le net n'est pas monotone en niveau, le comptoir se prélevant sa part :

| comptoir | offert (Medium) | prélevé | **net** |
|---|---|---|---|
| niveau 1 (3402 / 7037) | 25 | 0 | **+25** |
| niveau 2 (3403 / 7038) | 35 | 8 | **+27** |
| niveau 3 (3406 / 7039) | 50 | 12 | **+38** |

Les comptoirs d'Albion 7037/7038/7039 sont des assets **dérivés** : pas de `<Template>`, tout
hérité de `BaseAssetGUID`, seul le bien de main-d'œuvre est surchargé (2181 → 2192).

**PÉNURIE — [OUVERT].** `WorkforceThresholdInPercent=10` n'est PAS une règle de production :
c'est le seuil de la notification 501310. Les fichiers ne disent nulle part comment la
productivité cible est calculée quand la main-d'œuvre manque. Deux indices contradictoires :
`InfolayerBalancing` (140695) définit deux seuils d'affichage (Low 90 %, Critical 50 %) qui
suggèrent une variable **continue**, tandis que l'allocation réelle suit `ConsumerPriority`
(1 à 9, Kontor = 9). L'optimiseur impose donc `offre ≥ demande` par palier — hypothèse sûre.

⚠ **PIÈGE DE PLANIFICATION.** Les listes de services sont emboîtées, mais les scores ne le
sont pas : chaque palier ne compte que les services de **sa propre** liste. Une recette qui
ne garde que les services lourds donne Public 8 ≥ 7 aux Equites et Public **0** aux
Plébéiens, dont la liste s'arrête au marché et à la taverne. Mesuré : le vivier de conversion
contenait 799 Liberti, 688 Equites, 617 Patriciens et **zéro** Plébéien. Cf.
`optimizer/recipes.ts → unlockWorkerTiers`.

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
  Colosseum », **street 250**, **`BuildingUnique`**, **eau 50u Mandatory**, pente max 5.
  ⚠ **CORRECTION 2026-08-06** : « street 250 couvre l'île entière, pas de contrainte de
  centrage » était FAUX au-delà des îles moyennes. 250 est une distance **le long des
  rues**, pas un rayon à vol d'oiseau. Mesures : BFS géodésique sur la terre (borne
  supérieure, la distance-rue est toujours ≥) → `large_07` 99,0 % de la terre atteignable,
  `extralarge_04` 91,3 %, **`continental_01` (406 901 tuiles) seulement 30,2 %**. Confirmé
  au moteur, recette maigre : continental 9 328 maisons T4 sur 29 370 = 31,8 %.
  → Sur une île de plus de ~350 tuiles d'étendue, le Colisée **plafonne mécaniquement** la
  part de maisons au palier final. Conséquence de design : planifier les Patriciens DANS sa
  boule et les Equites dehors (Wonders 4 = Forum seul) plutôt que de laisser 68 % de l'île
  au palier de base. Non implémenté à ce jour. CHANTIER =
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
- **[FICHIERS, 2026-08-06] DEUX ÉCHELLES DE POPULATION COEXISTENT EN ALBION.** Les assets
  `PopulationLevel` se rangent en trois familles selon leur nom interne :

  | GUID | nom interne | nom FR | monde | culture |
  |---|---|---|---|---|
  | 1499, 1496, 1497, 1498 | `Population Level **Roman** 01–04` | Liberti, Plébéiens, Equites, Patriciens | Latium | `Roman` |
  | 1500, 1501, 1502 | `Population Level **Celtic** 01–03` | Tourbiers, Forgerons, Aldermen | Albion | `Celtic` |
  | 1503, 1504 | `Population Level **Roman Celtic** 02–03` | Mercators, Nobles | **Albion** | `RomanCeltic` |

  ⚠ Piège : « Roman Celtic » contient « Roman ». Ce sont pourtant des paliers **d'Albion** —
  la population romanisée — et non du Latium : leurs services sont le **Fanum** et le
  **Théâtre bardique**, bâtiments celtiques. Corroboré par les trois variantes d'effets du
  rang de cité (§2 bis), qui n'auraient aucun sens s'il n'y avait que deux cultures.
  Il n'existe **pas** de palier 01 romano-celtique : les Mercators montent depuis les
  Tourbiers natifs. Une île d'Albion peut donc porter les deux échelles à la fois.

## 13. CHECKLIST TESTS IN-GAME (pour l'utilisateur — à plus fort levier)

0. **[LE PLUS RENTABLE] Sens de `UpgradeThreshold`** — le seuil porté par la résidence du
   palier T est-il la condition pour **ÊTRE** T, ou pour **QUITTER** T ? Protocole : monter
   une maison au palier Patricien en ne fournissant que le **Forum** côté Wonders (w4), sans
   Colisée. Si elle monte → lecture (b), le Colisée devient OPTIONNEL, le budget d'eau est
   divisé par deux et les recettes gagnantes changent entièrement. Si elle bloque →
   lecture (a), celle qu'implémente le code (`needsModel.ts`, `THRESHOLD_MEANS_REACH`).
   Les deux lectures sont cohérentes avec les fichiers ; seul le jeu tranche.


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

## 16. Corrections audit (2026, branche feature/diagonal-45)

Audit croisé code × fichiers jeu (4 agents). L'ÉCONOMIE/EAU/PROD sont vérifiées exactes
(conso Colisée 50/Bains 25/Forum 15/citerne 10, seuils upgrade, capacités, débit, workforce,
MaxTransporterRange — tous confirmés GUID+propriété). Corrigé :
- **[FICHIERS] Tailles bâtiments = `BuildBlocker` (vraie emprise), plus `BoundingBox/Extents`
  (AABB mesh visuel).** Extents sur-dimensionnait ~74 % (+1 tuile/axe) → planner sur-occupait.
  `build_catalog.parse_ifo_size` lit désormais le span du polygone `BuildBlocker`. **Résidences
  4×4→3×3**, Marché 6×8→5×6, Théâtre 16×12→14×11, Bains 12×21→11×20. 241/343 corrigés.
- **8-adjacence (connexion coin)** : IMPLÉMENTÉE en SP3 (grille ½-tuile) mais **sur base
  WEB/devblog uniquement — zéro preuve fichier** (pas de `StreetAdjacency`/`ConnectionType`).
  Reste [OUVERT in-game #3]. Traversée réseau = 8-adj (runs diagonaux) ; le served-set live
  compte le coin (optimiste vs l'optimiseur tuile 4-adj — écart assumé, l'optimiseur est
  conservateur).
- Correctifs adaptateur ½-tuile : `downscaleGrid` réduit par bloc 2×2 (usable=ET, water/rivers=OU,
  plus d'échantillonnage coin) ; garde hauteurs vs dims après resize ; obstacles verrouillés
  bloquent la tuile entière. Champs peints par bloc (1 clic = 1 tuile). Import JSON tuile migré ×2.
- Doc : le `round(xf*2)` = demi-extent→TUILE entière (pas ½-tuile) ; la grille ½-tuile est un
  choix runtime du planner, pas une granularité jeu prouvée.
