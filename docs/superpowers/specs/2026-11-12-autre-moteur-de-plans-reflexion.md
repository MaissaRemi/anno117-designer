# Un autre moteur de plans : réflexion avant essais (12/11/2026)

Demande de Rémi : ne pas seulement régler le moteur en place, chercher s'il peut être remplacé
par une méthode plus puissante. Deux essais à mener, la réflexion d'abord :

1. **entraîner un modèle** sur cette machine, entraînement, jeu de données et jeu de test
   supervisés par Claude ;
2. **faire des plans parfaits** d'îles, puis voir quelle méthode s'en approche le plus.

Le calcul n'a pas à tourner dans le navigateur : un programme lancé sur la machine convient.

Machine relevée le 12/11 : Intel i7-12700K (12 cœurs, 20 fils), NVIDIA RTX 4070, 32 Go de
mémoire. Python 3.12 et Node 24 installés. Absents, à installer avec l'accord de Rémi :
`ortools` (solveur exact), `lightgbm` ou `scikit-learn` (modèle léger), `torch` (réseau).

## 0. Préalable commun aux deux essais

**Une note unique par plan.** Aujourd'hui un plan se juge sur plusieurs chiffres (maisons au
palier, pâtés, espacement). Une recherche ou un modèle n'optimise qu'un seul nombre : sans
note fixée, chaque méthode optimisera autre chose et la comparaison ne voudra rien dire.
Proposition : maisons au palier (ou habitants, selon l'objectif), sur un plan VALIDE (invariants,
eau, comptoir), avec les exigences de placement en pénalités ou en seuils. **À trancher par Rémi.**

**Un juge commun.** Le code existant sait déjà noter un plan (`optimizer/invariants.ts`,
`planQuality.ts`, évaluateur de palier). Toute méthode rend un `Layout`, le juge le note. Un
modèle ou un solveur n'offre aucune garantie de validité : tout repasse par le juge.

**Un banc d'essai.** Les 55 îles, séparées en îles d'entraînement et îles de test (par exemple
45 et 10, les deux provinces des deux côtés). La séparation se fait PAR ÎLE, jamais par plan :
sinon le modèle a déjà vu l'île sur laquelle on le teste. Hauteurs de l'île passées, mêmes
réglages pour tous (palier, route pavée). Le moteur actuel est la ligne de base, temps compris.

**Un lanceur hors navigateur.** Un script Node qui prend une île et des réglages et rend la
note. Les réglages du moteur (pas de la trame, décalage, `TRANCHE`, `PART_GAIN`, corridors,
recette) sont aujourd'hui des constantes : il faut en faire des options.

## 1. Essai « plan parfait »

**Ce qui n'est pas réalisable** : que Claude dessine à la main le plan parfait d'une île. Six
cents maisons sur quinze mille cases ne se placent pas par raisonnement ; un tel plan serait
moins bon que celui du moteur, et rien ne prouverait qu'il est parfait.

**Ce qui l'est**, et qui donne la même chose — une cible à laquelle comparer les méthodes :

- **a. L'optimum prouvé sur un petit cas.** Un solveur exact (OR-Tools CP-SAT) sur un bloc de
  30 à 40 cases de côté, un palier, les vraies règles : maisons 3 × 3, routes, portée le long
  de la route, services de la recette. Il rend le meilleur plan ET la preuve, ou à défaut un
  écart borné. On en tire la densité maximale d'un palier, en cases par maison.
- **b. Le plafond d'une île entière.** Terre de l'île divisée par cette densité, sources d'eau
  comprises : aucun plan ne peut faire mieux. Chaque méthode se lit en pourcentage du plafond.
- **c. Le meilleur plan connu.** La recherche la plus longue que l'on sache faire, laissée
  tourner des heures, gardée comme référence par île.

Repère : une rangée double de maisons le long d'une rue fait 7 cases de large pour 6 de
maisons, soit 10,5 cases par maison au strict minimum, sans service ni rue transversale. Le
moteur actuel en mesure 19,8 à 23,1 sur ses plans denses. L'optimum d'un palier avec ses
services est entre les deux : c'est ce que (a) dira, et c'est lui qui décide si un autre
moteur vaut la peine.

Méthodes à comparer ensuite, au même juge : moteur actuel ; réglage automatique (réglages
tirés au hasard, le meilleur gardé) ; quartiers défaits puis refaits ; motif optimal de (a)
pavé sur l'île ; modèle entraîné (§ 2). Résultat attendu : un tableau « méthode, pourcentage
du plafond, temps ».

Risques : la portée le long de la route est le point dur d'un solveur exact (il faut exprimer
qu'une route est d'un seul tenant) ; repli : imposer une famille de trames de rues et laisser
le solveur placer maisons et services. Un bloc trop petit sous-estime les grands services,
dont la portée dépasse le bloc.

## 2. Essai « modèle entraîné »

Réalisable sur cette machine. La vraie question est QUOI apprendre. Trois niveaux, du plus sûr
au plus risqué :

- **A. Apprendre à régler le moteur** (un à deux jours). Données : 10 000 à 20 000 plans
  produits par le moteur actuel avec des réglages tirés au hasard, sur les îles d'entraînement ;
  une dizaine de secondes par plan, vingt fils : une nuit. Modèle : arbres boostés, sans carte
  graphique, qui prédit la note à partir des traits de l'île et des réglages. Test sur des îles
  jamais vues, contre (1) les réglages par défaut et (2) la recherche au hasard au même temps de
  calcul. Attendu, honnêtement : bat les réglages par défaut, fait jeu égal avec la recherche
  directe ; son seul avantage serait d'aller plus vite.
- **B. Apprendre où poser, en imitant les plans parfaits** (une à deux semaines, incertain).
  Les blocs optimaux du solveur (§ 1a) servent d'exemples ; un réseau convolutif apprend quelle
  case reçoit quel bâtiment et guide la construction sur une île entière. C'est là que la carte
  graphique sert, et c'est ce qui relie les deux essais. N'a de sens que si (1a) montre un
  écart important.
- **C. Apprentissage par renforcement** : un agent pose bâtiment après bâtiment et apprend de
  ses notes. Demande un évaluateur bien plus rapide que l'actuel (à réécrire) et des millions
  d'essais. Le plus coûteux, le moins sûr ; à ne tenter qu'après A et B.

Supervision prévue : jeu de données rangé hors du dépôt (trop lourd), séparation par île,
mesure sur la note ET sur le panneau de qualité, courbe d'apprentissage, contrôle qu'aucune
île de test n'a été vue, comparaison à budget de calcul égal.

Pièges : 55 îles seulement, donc peu de diversité pour généraliser à une île nouvelle ; la
note doit être fixée avant de produire les données ; un bon chiffre sur les îles
d'entraînement ne prouve rien.

## 3. Ordre proposé

1. Fixer la note et le banc d'essai (décision de Rémi).
2. Écrire le lanceur hors navigateur et sortir les réglages du moteur en options.
3. Référence (1a) sur un bloc : densité optimale, puis plafond (1b) des îles du banc.
4. Lancer pour la nuit la production des plans à réglages tirés au hasard : c'est à la fois le
   jeu de données de (2A) et la méthode « réglage automatique » de la comparaison.
5. Entraîner (2A), dresser le tableau comparatif, décider de la suite (motif pavé, 2B).

À décider par Rémi avant de commencer : la note d'un plan ; l'installation de `ortools` et
`lightgbm` (puis `torch` si l'on va jusqu'à 2B) ; le dossier des données.

## Non vérifié

- L'écart réel entre nos plans et l'optimum : aucune mesure n'existe. Tout l'intérêt des deux
  essais en dépend.
- Qu'un solveur exact vienne à bout d'un bloc de 40 cases avec la portée le long de la route
  en un temps raisonnable.
- Le temps réel de production des données (les plans de grandes îles prennent jusqu'à 40 s).
