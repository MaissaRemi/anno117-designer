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

## Sur les sanctuaires : l'archetype qui validait son propre mensonge

Le besoin « Sanctuaire » (2753) se resolvait vers `g3615 « Public Roman Sanctuary »` — un
ARCHETYPE 6x10 de portee 38, sans `uniqueType`, non constructible en jeu. Les vrais batiments
sont les sanctuaires de divinite : **3x3, portee 16 a 24**, un par dieu.

Le piege est que l'invariant cense detecter ce genre d'erreur — *attributs du besoin == effet de
zone du batiment* — **se validait lui-meme**. Le besoin declare `Bonheur+1 / Croyance+2`, mot
pour mot l'effet de `g3615` et d'aucun dieu. Le match par icone tombait donc sur l'archetype,
et l'invariant confirmait.

Trois corrections, indissociables :

1. **Override du besoin** vers un vrai sanctuaire (`tools/build_economy.py`).
2. **Les attributs suivent le batiment pose**, plus le besoin. Sans quoi le moteur promettait
   l'effet de l'archetype pour un batiment qui en emet un autre. Passe generale, no-op sur tous
   les autres services — l'equivalence y est reelle.
3. **Un permis DEBLOQUE, il ne plafonne pas** (`src/economy/uniques.ts`). Le quota lu comme un
   compte posait « deux sanctuaires » et masquait la vraie regle du jeu : autant de copies
   qu'on veut, **d'un seul dieu**. C'est le `UniqueScope=Area` qui porte l'unicite du TYPE.

L'election du patron est alors contrainte au dieu **deja pose**, pas a celui que le palier
DECLARE : sur celtic le palier declare le besoin sans que le glouton ne pose jamais la copie, et
se fier a la declaration verrouillait l'election sur un dieu absent du plan.

### Le dieu par defaut se mesure

Une fois les attributs alignes, le dieu cesse d'etre interchangeable. Population LIVREE :

| dieu | effet | small_06 | medium_01 |
|---|---|---|---|
| **Cernunnos** (retenu) | Sante+1 / Croyance+1, portee 22 | **10 001** | **21 105** |
| Vulcain | Incendie+2, portee 20 | 9 716 | 20 760 |
| Ceres | Population+1 / Sante+1 | 8 282 | 10 390 |
| Epona | Population+1 / Bonheur+1 | 8 282 | 10 390 |

Contre-intuitif : les deux dieux qui donnent **Population+1 perdent la moitie de medium_01**.
Le gain de capacite gonfle la population, le rang de cite se degrade, et le garde-fou rase.

### Ce que ca coute, et pourquoi ce n'est pas une perte

| ile | avant | apres |
|---|---|---|
| small_06 | 418 maisons / 9 545 hab | 468 / **10 001** (+4,8 %) |
| medium_01 | 896 / 24 034 | 801 / **21 105** (−12,2 %) |
| celtic_07 | 242 / 4 867 | 238 / 4 745 (−2,5 %) |

Le −12 % de medium_01 est le prix de la verite : la portee passe de 38 a 22. Le moteur
promettait la couverture d'un batiment que le joueur ne peut pas poser — meme nature que le
double comptage des marches ou les maisons comptees sans acces routier.

Reste ouvert : celtic n'elit plus de patron et finit sans sanctuaire (−2,5 %).
