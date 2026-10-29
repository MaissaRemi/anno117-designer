# Portées, doublons, motifs et eau (29/10/2026)

Suite de la refonte (`2026-10-26-refonte-moteur-ile.md`), sur le retour de Rémi après
essai : services qui « se marchent dessus », maisons illisibles en un bloc jaune, motifs de
maisons à trouver, corridor d'eau route | aqueduc | route, objectif « maximum de maisons »,
menu trop chargé. Découpe validée en sept étapes, A à G, toutes faites et fusionnées dans
`dev`.

Toutes les mesures : Patriciens, grille tuile, sondes hors navigateur (vite-node).

## A — La portée suit le type de route

Données du jeu (patch 200, `config.rda` → `assets.xml`) : la route pavée (23996) porte
`LogicisticSpeedFactor` 1.5, et son texte dit qu'elle « prolonge ainsi la portée des
bâtiments ». La route en marbre (77947) hérite de la pavée sans redéfinir le facteur : même
vitesse, plus du prestige. Terre = 1. Les deux moteurs comptaient tout sur la terre.

`src/engine/roads.ts` (`planningRange`) remplace sept copies de `rangeOf`. Le type voyage
dans la requête, le résultat et le layout (`Layout.roadType`, lu par la couverture de
l'éditeur). Choix « Routes » dans les planificateurs (pavée par défaut) et le panneau
Couverture.

| `roman_island_small_06` | terre | pavée |
|---|---|---|
| Remplir l'île | 705 maisons, 16 970 hab., 164 services | 815 maisons, 24 086 hab., 105 services |
| Commande 300 maisons | 204 maisons, non servie, 250 services | 300 servies, 79 services |

## B — Les copies en trop sortent

Une maison est couverte par un TYPE, pas par une copie. `optimizer/doublons.ts`
(`copiesEnTrop`) retire, la moins utile d'abord, toute copie dont les maisons sont toutes
vues par une autre copie du même type. Commande : dans la boucle (la place revient aux
maisons) puis sur les maisons gardées. Remplir l'île : avant la pose des maisons, jugé sur
les origines où une maison tient ; les consommateurs d'eau restent.

Commande 300, pavée : 79 → 55 services, aucune copie retirable. Terre : 250 → 108 services,
204 → 267 maisons. Remplir l'île, terre : 705 → 735 maisons. En pavée il n'y avait presque
rien à retirer (couverture 1,15 à 1,45 par maison).

Reste, en terre seulement : les grappes de petits services de `planLattice` sont espacées sur
la plus courte portée (Puits) ; les retirer ne suffit plus, il faudrait les replacer.

## C — Chaque maison se voit

Contour assombri (bord droit et bas) de chaque bâtiment dans l'aperçu.

## D — Motifs de maisons

**Le motif anneau 3 × 3 de Rémi** (9 × 9 de maisons cerné de route, la maison du milieu à
droite retirée, un bout de route de 3 cases dessert la maison centrale, reste un emplacement
3 × 2) : période 10 × 10 = 100 cases pour 8 maisons et un petit service. L'îlot actuel :
période 13 × 7 = 91 cases pour 8 maisons ; un petit service y coûte une maison, soit
91 × 9/8 = 102 cases pour 8 maisons et un service. L'anneau gagne ~2 %, mais il n'a pas
d'allée pour l'eau (l'îlot les inclut dans ses 91 cases) : avec un corridor, il perd.
L'emplacement 3 × 2 n'accueille que Latrine, Puits, Tour de guet (pas la Custodia, 4 × 4).
**Non adopté.**

**Ce que la mesure a désigné à la place** : 23 à 26 % de la zone d'une ville commandée était
vide. En partie l'excédent d'îlots (normal pour une commande servie), en partie les bandes
autour des gros services : un groupe effaçait toutes ses routes intérieures, et seules ses
deux rangées extérieures logeaient. Un groupe n'efface plus que les routes sous son bâtiment
(`maisonsDeGroupe`).

Coût d'un service posé dans un îlot (maisons perdues, cases gâchées au-delà de l'emprise) :
Puits et Tour de guet 1 et 5, Latrine 1 et 3, Custodia 4 et 20, Vigiles 4 et 16, Medici et
Marché 4 et 6, Taverne 4 et 12. Le modèle de coût de `couvrir` range déjà les petits dans
les restes des moyens.

## E — Corridors d'eau

Dans la trame, l'eau ne circulait que verticalement (allées). Toutes les 4 rangées d'îlots,
la route de séparation peut devenir route | voie d'eau | route, avec un pont de route à chaque
colonne de route. ~9 % de sol en plus : seulement en secours, quand le plan sans corridor
laisse des consommateurs secs ; on garde celui qui loge le plus.

Routes en terre, maisons au palier : `large_03`/800 756 → 758, `continental_01`/800 573
(inchangé), `extralarge_01`/1200 775 → 1 176. Espacement 2 et 3 moins bons.

En routes pavées, l'eau ne bloque plus : 800 maisons servies sur `large_03`, `large_07` et
`continental_01` (502/800 avant A), 1 500 sur `continental_01`. Seul reste un Forum sec sur
`extralarge_01` (1 405/1 500), que les corridors ne sauvent pas.

## F — Objectif « maximum de maisons »

`IslandPlanRequest.objectif = "maisons"` : les comparateurs classent les maisons posées
contre une route, la population départage. Menu Services de « Remplir l'île ».

| pavée | habitants | maisons |
|---|---|---|
| `small_06` | 897 maisons, 24 590 hab. | 960, 21 816 |
| `medium_01` | 1 203, 38 301 | 1 606, 27 722 |
| `large_03` | 4 195, 119 447 | 4 283, 116 351 |

Écarté : un mode « remplir » du moteur d'îlots logeait 25 à 30 % de maisons de moins (618
contre 897 sur `small_06`) — ses îlots rigides épousent mal les côtes. Pour remplir une île,
`planLattice` reste le meilleur moteur. Reste 11 à 17 % de terre libre : franges de côte trop
étroites pour une maison 3 × 3.

## G — Un seul écran « Planifier »

`src/ui/PlanifierView.tsx` : commutateur Ma commande / Remplir l'île / Plusieurs îles
(`planMode` du store), barre latérale à trois entrées (Éditeur, Planifier, Production).
Titres et introductions retirés, options secondaires dans « Options avancées », aides longues
réduites à une phrase avec le texte complet en infobulle. Aucun comportement ne change.

Reste, hors de G : à la largeur d'un téléphone, la barre du haut déborde (bouton « Charger une
île » coupé).

## Hors plan

Les données du dépôt datent de juin ; le jeu installé est au patch 200 (2 329 assets de plus,
Colisée portée 250 → 420). Réextraction en cours dans une session à part, branche
`chore/donnees-patch-200`.
