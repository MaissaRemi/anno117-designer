# Exigences de Rémi

Ce que le projet DOIT tenir. Ce fichier dit ce qui est exigé, pas ce qui a été fait (état :
`docs/REPRISE.md` ; mesures et causes : `docs/AUDIT-2026-11-10.md`).

**Règles de travail**

- Un changement de placement ne se juge jamais au seul nombre d'habitants : il se juge sur le
  panneau de qualité (`pnpm vitest run src/optimizer/qualite.panneau.test.ts`).
- Les seuils du panneau sont un cliquet : une amélioration les resserre dans le même commit ;
  ils ne se relâchent qu'avec l'accord de Rémi.
- Une exigence sans test s'outille avant d'y travailler.
- Une mesure passe les hauteurs de l'île, comme l'application : sans elles l'eau passe partout
  et le plan mesuré n'est pas celui de l'écran (10/11 : un plan à 450 maisons au test en
  logeait 0 à l'écran).
- Ne pas répondre qu'un défaut signalé par Rémi est « une conséquence du jeu » sans le lui
  avoir montré, mesure à l'appui.

| # | Exigence | Vérifiée par | État au 10/11/2026 |
|---|---|---|---|
| E1 | Le moins de copies possible d'un même service, espacées selon sa portée réelle (le long de la route, allongée par le type de route). Pas une copie tous les dix pas quand la portée en couvre cinquante. | panneau, `espacement` (`regroupement`, `optimizer/planQuality.ts`) ; 1 = au pas que la portée permet | **en progrès** (étape 1) : « Ma commande » 0,37 à 0,38 (était 0,2 à 0,4), 46 services pour 450 maisons sur medium_01 (était 61 pour 333) ; « Remplir l'île » 0,42 à 0,53 en pavée (était 0,49 à 0,59 : relâché avec l'accord de Rémi, contre moins de pâtés), 0,69 en terre sur medium_01 (était 0,52) |
| E2 | Pas de pâtés : les services ne forment pas des groupes collés ; ils sont placés là où ils couvrent le mieux. | panneau, `enPate` (part des services à une case ou moins de deux autres) | **en progrès** : « Ma commande » 7 à 60 % (était 39 à 74 %) ; « Remplir l'île » 40 à 65 % en pavée (était 75 à 83 %), 37 % en terre sur medium_01 (était 86 %) |
| E3 | Rien ne manque : ce qui est commandé est logé à son palier, ce qui est annoncé au devis est posé, ni plus ni moins. | panneau, `auPalier` ; la ligne imprimée donne aussi « services posés / au devis » | **en progrès** (étape 2) : 450 Patriciens logés sur 450 (medium_01, était 333), 165 sur 200 (small_06, était 91 ; île trop petite) ; devis et pose proches sur les grandes îles (46 pour 43, 71 pour 70), pas sur la petite (35 pour 23) |
| E4 | La portée se compte le long de la route et le type de route l'allonge. | `engine/roads.ts` (`planningRange`), `commande/ilots.test.ts` (moins de services en pavée) | tenue |
| E5 | Monde, phase 1 : repérer le monde, puis choisir l'île principale **ou se la faire conseiller**, et savoir sur quelle île produire quoi. | `monde/orchestration.test.ts` (conseil classé selon l'objectif) ; `monde/calcul.test.ts`, vrai monde avec hauteurs : part de la demande de la ville servie, part de l'affecté posée | **en progrès** (étape 4) : conseil de l'île principale fait ; sur le monde d'essai (une ville de Patriciens, quatre îles de production) la demande de la ville est servie à 73 % (64 % avant l'audit) et les îles de production posent 86 % de ce qui leur est affecté (était 79 %) ; le reste manque de place |
| E6 | Île de production : plan complet (ateliers, fermes, champs), tassé pour gagner de la place et produire le plus possible. | panneau, part de l'objectif posée (trois îles) ; la terre vide et le sol par bâtiment sont imprimés, sans seuil ; `commande/maximum.test.ts` : débit maximal tenu en entier (deux îles) | **en progrès** (étape 3) : medium_01 83 % de l'objectif posé (était 71 %), small_06 100 % (était 40 %), large_03 100 % (était 64 %). Mode « Produire le maximum » fait (12/11) : medium_01 tient 33,7 pains et 22,5 tuniques par minute en entier (28 pains posés sur 40 demandés avant), small_06 15 et 10 |
| E7 | Fidélité au jeu : aucune valeur tapée à la main ; une règle se lit dans les fichiers ou se teste en jeu. | conventions du dépôt | tenue |

**Tranché par Rémi le 10/11/2026 : E2 vise aussi des services DIFFÉRENTS posés côte à côte.**
Des copies du même service trop proches sont du gaspillage pur ; des services différents
voisins couvrent les mêmes maisons, et les séparer déplace des maisons. Rémi a choisi de les
séparer, sur cette mesure dans « Remplir l'île », route pavée (`TRANCHE` dans
`planLattice.ts`, passé de 1,5 à 1,25) :

| Île | Services en pâté | Maisons au palier | Habitants | Pire espacement |
|---|---|---|---|---|
| medium_01 | 75 → 65 % | 563 → 516 | 22 121 → 21 645 | 0,59 → 0,53 |
| small_06 | 81 → 64 % | 217 → 226 | 8 190 → 8 495 | 0,49 → 0,47 |
| celtic_large_07 | 83 → 40 % | 888 → 1 013 | 20 843 → 21 628 | 0,55 → 0,42 |
| large_03 | 83 → 40 % | 1 495 → 1 413 | 60 843 → 60 827 | 0,66 → 0,53 |

Au total des quatre îles : autant de maisons au palier, +0,5 % d'habitants, nettement moins de
pâtés. Les seuils du panneau qui reculaient (maisons au palier de medium_01, pire espacement)
ont été relâchés avec cet accord. En chemin de terre, sur sept îles : 86 → 56 % de services en
pâté en moyenne, +1 % de maisons au palier, −3 % d'habitants, 18 % de services en plus (les
puits et tours étaient trop rares pour leur portée).
