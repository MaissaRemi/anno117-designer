# Trop de services par rapport aux maisons ?

Date : 2026-08-09. Signalé sur `roman_island_small_06` (Petite 06, Roman), palier Equites,
emplacements cochés, seuil 80 % : 369 maisons et une carte dominée par les services.

## Ce que la mesure dit

| | cases | part du sol |
|---|---|---|
| services | 6 504 | **33 %** |
| maisons | 3 609 | 18 % |
| routes | 5 005 | 26 % |

189 bâtiments de service pour 401 maisons. Tour de guet ×26, Puits ×25, Latrine ×19,
Marché ×13.

Et ce n'est **pas** propre à cette île : sur `roman_island_medium_01`, l'île « saine », les
services occupent 2,3 fois le sol du logement.

## Le houses-first ne répond pas

`packPlan` place les maisons d'abord puis couvre les maisons réelles. Testé sur les deux îles :

| île | moteur | maisons | habitants | ratio services/maisons |
|---|---|---|---|---|
| small_06 | lattice | 421 | 9 368 | **1,70** |
| small_06 | packed | 344 | 7 399 | 2,41 |
| medium_01 | lattice | 550 | 15 431 | 2,29 |
| medium_01 | packed | 583 | 14 480 | 2,25 |

Il sur-provisionne davantage. Piste fermée.

## LES SERVICES NE GASPILLENT PAS LE SOL, ILS L'ACHÈTENT

C'est le résultat central, et il contredit l'intuition de départ. Balayage du seuil de gain
sur `roman_island_small_06` :

| seuil | services | maisons | habitants |
|---|---|---|---|
| actuel | 202 (33 % du sol) | 459 | **9 613** |
| ×2 | 93 (20 % du sol) | 343 | 7 417 |

**Diviser les services par deux coûte 23 % de la population.** Leurs effets de zone compensent
le malus de rang de cité ; sans eux, le garde-fou de viabilité rase les maisons. Le ratio
services/maisons est une conséquence du jeu, pas un défaut du moteur.

## Le critère de placement, lui, était discutable — mais le corriger ne paie pas

`diamondGain` compte les cases de TERRE non couvertes. Un bras de terre où aucune maison ne
tiendra pèse donc autant qu'un quartier dense. Corrigé en comptant les EMPLACEMENTS DE MAISON
disponibles (`demand0`, figé après le peigne de routes), avec les budgets dimensionnés de même.

| variante | small_06 | medium_01 | celtic_07 |
|---|---|---|---|
| **actuel — gain en cases de terre** | **9 212** | **24 529** | **4 889** |
| gain en emplacements | 9 613 | 24 478 | 3 408 |
| gain en emplacements ÷ densité | 7 480 | 24 105 | 4 824 |

La deuxième ligne gagne 4,4 % sur small_06 et perd **30 %** sur celtic. Cause identifiée : le
seuil `2r²·0,25` est une AIRE comparée à un COMPTE d'emplacements. Pour un wonder de portée 50
il exige 1 250 emplacements — inatteignable, donc plus aucun wonder, donc tout le palier
s'effondre. La troisième ligne convertit par la densité, répare celtic et détruit le gain.

Aucune variante ne bat l'existant sur l'ensemble. **Approche revertie, rien n'en subsiste.**

## Corrigé : les services à eau secs sortent du plan

Un service à eau non raccordé est INACTIF en jeu : il ne rend rien, coûte son entretien, et
occupe une emprise souvent énorme (Forum, Bains, Citerne). Ils sont désormais retirés après le
routage.

**Un seul changement répare DEUX défauts.** Le sol revient aux maisons — c'est le gain évident.
Mais surtout, leur COUVERTURE cesse de compter : `activeType` raisonne par TYPE, si bien qu'une
seule copie raccordée validait toutes les copies du type, sèches comprises, et une maison
desservie par la seule copie sèche était comptée couverte. Le BFS de portée part de
`placements` : en retirer la copie suffit.

| île | avant | après | eau |
|---|---|---|---|
| small_06 | 401 maisons / 9 212 hab | 418 / **9 545** (+3,6 %) | 13/18 → **13/13** |
| medium_01 | 881 / 24 529 | 896 / **24 034** (−2,0 %) | 22/24 → **24/24** |
| celtic_07 | 242 / 4 889 | identique | aucun sec |

**Le −2 % de medium_01 n'est pas une perte.** Ces deux bâtiments ne fonctionnent pas en jeu et
le moteur créditait leur couverture : c'est un mensonge qui cesse, de même nature que le double
comptage des marchés ou les maisons comptées sans accès routier.

**Le signal du réseau d'eau survit au ménage.** `WaterPlanResult.dropped` compte les retirés, et
`waterPct` les garde au dénominateur — sans quoi une île où aucune source n'est possible verrait
tous ses consommateurs disparaître et afficherait un réseau parfait. Un test l'exigeait déjà :
il est passé de vert à rouge à la première version, ce qui a révélé l'oubli.

Verrouillé par l'invariant `pas-de-service-sec`, de gravité `faute`.

## Ce qui reste vrai et non traité

**Le palier Nobles est un mauvais choix sur celtic**, et c'est indépendant : le balayage des
paliers donne Aldermen à 2,25 fois la population. L'option existe (`autoTier`).

## Sur les sanctuaires

Vérifié sur l'île signalée : **7 copies d'un SEUL et même `Sanctuaire` (g3615)**, aucun autel de
divinité, aucun `uniqueType` porté par deux bâtiments distincts. Règle du jeu confirmée par
l'utilisateur : autant de sanctuaires qu'on veut, mais **d'un seul dieu**, et comme ils font
tous la même taille un placeholder suffit — il sera remplacé à la construction. Le
comportement actuel est donc conforme.
