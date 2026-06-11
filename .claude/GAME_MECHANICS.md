# Anno 117 Pax Romana — Mécaniques réelles du jeu (référence planner)

Notes de recherche (web + fouille `assets_base.xml` extrait du jeu). À relire AVANT toute refonte
du planificateur. Datées juin 2026. Vérité-terrain = fichiers du jeu (`.gamedata/assets_base.xml`),
le web confirme/complète.

---

## 1. Influence des services publics = DISTANCE PAR LA RUE (pas euclidienne !)

**Preuve fichiers** : chaque service a un asset `Effect` avec `<EffectScope>StreetDistance</EffectScope>`
(Effect Roman Market Service 99314, Tavern 99315, Cistern 99330, Library 99320…). Le scope `Radius`
n'est utilisé que pour specialists/items/incidents/colisée, PAS pour les services de base.

- `EffectSource` des bâtiments porte DEUX valeurs : `RadiusDistance` (UI/préviz) et `StreetDistance`
  (la vraie portée jeu). Ex Marché : Radius 24 / **Street 28**. Citerne : 36/36. Bains : 62/**66**.
  Forum : 66/**70**.
- En jeu : on clique un bâtiment → les routes connectées deviennent VERTES jusqu'à la portée ;
  là où le vert s'arrête, l'influence s'arrête. Une maison est couverte si elle touche une route
  verte (les diagonales/coins comptent, cf. §2).
- Le mod « Public Buildings Use Radius » CONVERTIT street→radius : confirme que vanilla = street.
- Notre `streetCoverage` (BFS le long des routes depuis les routes adjacentes au bâtiment, limite
  `streetRange`, cases servies = adjacentes à une route atteinte) est le BON modèle de base.
  **Le planner districtPlan v2 utilise l'euclidien (`radius.range`) → à migrer vers BFS-rue.**

## 2. Routes & grille

- Grille en tuiles, chaque tuile divisée en 4 sous-tuiles (45° supporté). Routes = graphe.
- **Connexion par le COIN comptée** : une route qui passe au coin d'un bâtiment connecte (devblog
  officiel — différent d'Anno 1800 qui exigeait une arête). Notre modèle 4-adjacence est plus
  strict que le jeu (acceptable/conservateur).
- 2 niveaux de route (terre/pavée) + ponts + rues de quai. RIEN dans les assets n'indique une
  portée différente par type de route (pas de RangeFactor) → pavée = vitesse charrettes (logistique),
  pas la portée des services.
- `StreetActivation` sur résidences/services : le bâtiment ne FONCTIONNE que raccordé à une route.

## 3. Résidences

- `Residence7/PopulationLevel` = GUID tier. GUIDs : 1499 Liberti, 1496 Plébéiens, 1497 Equites,
  1498 Patriciens (Latium) ; 1500 Tourbiers, 1501 Forgerons, 1502 Aldermen (Albion) ;
  1503 Mercators, 1504 Nobles (romano-celtes).
- `NeedsList` : items AVEC `NeedConsumptionRate` = biens (tonnes/min PAR MAISON, pas par habitant) ;
  SANS taux = service/wonder (présence dans la portée rue).
- Les biens sont consommés depuis le **stock partagé de l'île** (pas de transport physique vers les
  maisons). Pas de contrainte de distance maison↔entrepôt pour les BIENS. Seuls les SERVICES ont
  une portée.
- Capacité par maison = Σ `Population` des NeedAttributes des besoins REMPLIS (déjà modélisé).
- `AttributeProvider/Population` = GUID du tier desservi (PAS un cap de desserte — fausse piste).

### Catégories de besoins & seuils d'UPGRADE (mécanique clé, non modélisée chez nous)

Chaque besoin a `SupplyWeight` (1/2/4/8) et `NeedCategoryType` : `Food`, `Fashion`, `Household`,
`Wonders`, `Culture` — absent = **Public** (services). Besoin REMPLI → ajoute son poids au score de
sa catégorie. `UpgradeThreshold` de la résidence = scores minimaux pour MONTER DE TIER :

| Tier (vers le suivant) | Public | Food | Fashion | Household | Wonders | Culture |
|---|---|---|---|---|---|---|
| T1 Liberti/Tourbiers (1499/1500) | 1 | 1 | 1 | — | — | — |
| T2 Plébéiens/Forgerons/Mercators (1496/1501/1503) | 3 | 3 | 3 | 2 | — | — |
| T3 Equites/Aldermen/Nobles (1497/1502/1504) | 7 | 7 | 7 | 6 | 4 | — |
| T4 Patriciens (1498) | 15 | 15 | 15 | 14 | 12 | 8 |

(Seuil affiché sur la résidence du tier = condition pour upgrade VERS le tier suivant. T4 : seuils
pour « besoins complets »/colisée etc.)

Ex Equites (somme max par catégorie de sa NeedsList) : Food 16, Public 18, Fashion 14, Household 16,
Wonders 8 → pour passer Patricien il faut Public≥7, Food≥7, Fashion≥7, Household≥6, Wonders≥4 :
**sous-ensemble au choix** → c'est LA base d'un vrai « max-éco » (choisir les besoins les moins
chers atteignant les seuils). Remplace notre heuristique actuelle « besoin rentable ssi Money ≥ coût ».

- Poids notables (Equites/Patriciens) : Sardines/Porridge/Marché/Taverne/Tuniques/Chapeaux w=1 ;
  Pain/Garum/Sanctuaire/Grammaticus/Sandales/Savon/Amphores/Huile w=2 ; Vin/Fromage/Citerne/
  Théâtre/Maison de jeu/Toges/Broches/Tablettes/Verre fin/Idoles/Forum/Bains w=4 ; Temple/
  Bibliothèque w=8.

## 4. Wonders (Forum, Bains, Colisée) — catégorie à part

- `NeedCategoryType: Wonders` : Forum (2755), Bains (2782), Colisée (2783, Patriciens), + celtiques.
- Ce sont des `PublicServiceBuilding` géants à portée rue ÉNORME (Bains street 66, Forum 70) —
  quelques exemplaires couvrent l'île. MAIS :
- **EAU OBLIGATOIRE** : `AqueductConsumer` `Mandatory` — Bains consomment **25**, Forum **15**
  unités d'eau (sur les 100 d'une source). Sans aqueduc → pas de Bains/Forum → pas de T4.

## 5. Aqueducs & eau (non modélisé chez nous — bloquant pour T3+/T4)

Système (fichiers + web) :
- **Source** (« Aqueduct Roman Basin » 19691) : `WaterVolumeSupply 100`. Se pose sur **slot
  MONTAGNE** (concurrence mines/carrières). Entretien 26/min.
- **Conduites** : 3 sous-types (H1 2 arches, H2 3 arches, tours). L'eau coule en PENTE : la hauteur
  de l'aqueduc décroît avec la longueur ; descendre un terrain rallonge la portée, monter la réduit.
  Sous le minimum H1 → l'eau ne coule plus. Tours = reset hauteur (mais réduisent la portée
  effective). Split = tour automatique.
- **Citerne** (« Aqueduct Roman Distribution » 19753, celtic 29526) : `AqueductDistributor`,
  agit comme un SERVICE PUBLIC : `EffectSource` street **36**, effet 99330 scope StreetDistance.
  Entretien 26/min. Plusieurs citernes par source possibles.
- **Conduites vs routes (confirmé par l'utilisateur en jeu, 2026-06-11)** : une conduite peut
  être ADJACENTE à une route et peut la CROISER (l'arche enjambe), mais ne partage JAMAIS une
  case avec une route. Modèle tuiles : franchissement de case route EN LIGNE DROITE uniquement
  (entrée/sortie opposées), pas de terminus/virage/jonction sur route. Conséquence planner :
  un bâtiment au périmètre 100 % route est IRRACCORDABLE → laisser une « prise d'eau »
  (cases sans route) sur les consommateurs d'eau, et router les conduites AVANT les maisons
  (sinon plus aucun passage dans les poches pleines).
- **Citerne = BESOIN public** (need 68747 « Public Cistern », w=4, Health+3 FireSafety+3) exigé par
  les tiers **1497 Equites et 1498 Patriciens** (+ équivalent celtic 80116-zone). Dans notre
  `economy.generated.json` le besoin existe mais `building: None` → c'est le « Service sans
  bâtiment au catalogue » affiché en trou par l'UI. Le bâtiment est 19753 (template infra, pas
  PublicServiceBuilding → raté par build_economy).
- **Consommateurs d'eau** (`AqueductConsumer`):
  - `Mandatory` : Bains 25, Forum 15 (sans eau → inactifs).
  - `Optional` : fermes (`AqueductConsumedWaterSupply 5`, buff **+50 productivité**, débloqué par
    recherche « Duct Irrigation » 26949) ; plantations (« Aqua Arborica ») ; mines (« Hushing »).
  - Présent vide (`<AqueductConsumer />`) sur marché/pêcheries etc. = raccordables, sans obligation.
- Budget eau : Σ conso des consommateurs actifs ≤ 100 par source. Trop de fermes → désactivation.
- **Limite data pour nous** : nos masques d'île n'ont PAS l'élévation ni les slots montagne →
  impossible de tracer les conduites exactement. Approximation raisonnable : citerne = service
  posable (coût + entretien), budget eau par source, et marquer Bains/Forum « nécessitent réseau eau ».

## 6. Bâtiments de production

- `FactoryBase` : `FactoryOutputs` (Product, Amount, StorageAmount), `FactoryInputs`, `CycleTime` s.
- **`MaxTransporterRange`** : portée MAX des charrettes (en distance-rue) pour livrer/chercher au
  réseau entrepôt. Distribution réelle : **30 (majorité, 85 assets), 40 (16 : côtiers+champs),
  70 (3), 80 (2), 45 (1)**. → Un bâtiment de prod doit avoir un entrepôt/comptoir à ≤ ~30 de rue,
  sinon les biens ne partent pas. **Contrainte de placement majeure, pas modélisée chez nous.**
- En jeu, cliquer une prod montre en vert jusqu'où vont les charrettes.
- Fermes : `ModuleOwner/ModuleLimits/Main/Limit` = nb cases champ (oats 80, olive 160…), modules
  CONNECTÉS (bloc contigu), `FarmType PlantFarm`. Champ lui-même = asset Production Field avec
  son propre FactoryBase (cycle).
- `RawResourceType` : `Coastal` (pose sur côte/eau), mines = slots montagne, argile = **rivière**
  (tiles). Fertilités par île : certains biens exigent la fertilité (vin, olives…), d'autres non
  (oats, hemp → partout).
- Entretien : argent + workforce (Product 2181 = workforce T1 etc.) — déjà modélisé.
- Entrepôt (`Warehouse`) : stock PARTAGÉ île entière, `LogisticNode` LoadingSpeed 0.15,
  upgrades ↑ nb transporteurs. Les biens doivent être charriés prod→entrepôt ; entre entrepôts
  d'une même île : partagé automatiquement.

## 7. Divers utiles

- `IncidentInfectable` : feu/émeute/maladie/séismes — FireSafety/Health des besoins remplis et de
  la citerne réduisent les risques. Bibliothèque : FireSafety **−2** (risque incendie !).
- `Maintenance` argent : Product 1010017 par minute (modélisé). Marché 10, Bains 160, Citerne 26.
- `InfluencedByNeighbors` sur résidences = purement VISUEL (variations de façades).
- Romanization/Buffs/Specialists : hors scope planner v1.

## 8. Écarts planner actuel → corrections à faire (ordre de priorité)

1. **Couverture services par BFS-rue** (StreetDistance) au lieu d'euclidien `radius.range` :
   utiliser `streetRange` + `streetCoverage` existant. Conséquence design : les maisons doivent
   partager le RÉSEAU de routes avec le service (notre peigne + squelette le permet déjà).
2. **Citerne** : mapper need 68747/celtic → bâtiment 19753/29526 dans build_economy (+ catalogue
   si absent) ; la traiter comme service street-36 + prérequis « réseau d'eau » (approx).
3. **Seuils par catégorie** : extraire SupplyWeight + NeedCategoryType + UpgradeThreshold dans
   build_economy → max-éco = choisir le sous-ensemble de besoins le moins cher qui atteint les
   seuils du tier visé (sinon les maisons NE MONTENT PAS de tier → plan « 100% nul » actuel).
4. **Wonders** : Forum/Bains à poser en 1-2 exemplaires (portée 66-70 rue) + eau obligatoire
   (25/15 par source de 100) ; Colisée pour Patriciens.
5. **MaxTransporterRange ~30** : toute prod placée doit être à ≤30 de rue d'un entrepôt → le plan
   auto-suffisant (phase 2) doit semer des entrepôts (ou poser la prod autour du comptoir).
6. Corner-adjacency route (jeu plus permissif que notre 4-adj — on peut rester conservateur).
7. Terrain : slots montagne (mines + source aqueduc), rivière (argile), côte (déjà), fertilités —
   données absentes de nos masques d'île → à extraire des .a7m si on veut la phase 2 exacte.

## 9. Sources

- Fichiers jeu : `.gamedata/assets_base.xml` (GUIDs cités), `templates.xml`.
- [DevBlog roads & grid](https://www.anno-union.com/devblog-roads-building-in-the-grid/) — coins/diagonales.
- [Mod Public Buildings Use Radius](https://mod.io/g/anno-117-pax-romana/m/public-buildings-use-radius-taludas) — vanilla = street.
- [Steam : observations aqueducs](https://steamcommunity.com/app/3274580/discussions/0/802331493180488207/) — pente/hauteurs/tours.
- [GameRant : construire les aqueducs](https://gamerant.com/anno-117-pax-romana-how-build-aqueduct/) — source 100u, slots montagne, boosts.
- [NoobFeed : entrepôts](https://www.noobfeed.com/articles/anno-117-pax-romana-how-to-use-warehouses) — stock partagé.
- [Anno-companion wiki](https://anno-companion.com/wiki/117/goods) — base de données biens.
- [GameRant : fertilités](https://gamerant.com/anno-117-pax-romana-island-fertility-guide-how-settle-island-expand/).
