# Exigences de Rémi

Ce que le projet DOIT tenir. Ce fichier dit ce qui est exigé, pas ce qui a été fait (état :
`docs/REPRISE.md` ; mesures et causes : `docs/AUDIT-2026-11-10.md`).

**Règles de travail**

- Un changement de placement ne se juge jamais au seul nombre d'habitants : il se juge sur le
  panneau de qualité (`pnpm vitest run src/optimizer/qualite.panneau.test.ts`).
- Les seuils du panneau sont un cliquet : une amélioration les resserre dans le même commit ;
  ils ne se relâchent qu'avec l'accord de Rémi.
- Une exigence sans test s'outille avant d'y travailler.
- Ne pas répondre qu'un défaut signalé par Rémi est « une conséquence du jeu » sans le lui
  avoir montré, mesure à l'appui.

| # | Exigence | Vérifiée par | État au 10/11/2026 |
|---|---|---|---|
| E1 | Le moins de copies possible d'un même service, espacées selon sa portée réelle (le long de la route, allongée par le type de route). Pas une copie tous les dix pas quand la portée en couvre cinquante. | panneau, `espacement` (`regroupement`, `optimizer/planQuality.ts`) ; 1 = au pas que la portée permet | **en progrès** (étape 1) : « Ma commande » 0,27 à 0,46 (était 0,2 à 0,4), 48 services pour 450 maisons sur medium_01 (était 61 pour 333) ; « Remplir l'île » inchangé en pavée (0,49 à 0,59) |
| E2 | Pas de pâtés : les services ne forment pas des groupes collés ; ils sont placés là où ils couvrent le mieux. | panneau, `enPate` (part des services à une case ou moins de deux autres) | **en progrès** : « Ma commande » 22 à 35 % (était 39 à 74 %) ; « Remplir l'île » **non tenue**, 75 à 83 % en pavée |
| E3 | Rien ne manque : ce qui est commandé est logé à son palier, ce qui est annoncé au devis est posé, ni plus ni moins. | panneau, `auPalier` ; la ligne imprimée donne aussi « services posés / au devis » | **en progrès** (étape 2) : 450 Patriciens logés sur 450 (medium_01, était 333), 158 sur 200 (small_06, était 91 ; île trop petite) ; devis et pose encore différents (48 pour 43, 38 pour 23) |
| E4 | La portée se compte le long de la route et le type de route l'allonge. | `engine/roads.ts` (`planningRange`), `commande/ilots.test.ts` (moins de services en pavée) | tenue |
| E5 | Monde, phase 1 : repérer le monde, puis choisir l'île principale **ou se la faire conseiller**, et savoir sur quelle île produire quoi. | aucun test | conseil de l'île principale : **absent** |
| E6 | Île de production : plan complet (ateliers, fermes, champs), tassé pour gagner de la place et produire le plus possible. | aucun test de densité | **non tenue** : fermes refusées « faute de place » avec 43 % de terre vide |
| E7 | Fidélité au jeu : aucune valeur tapée à la main ; une règle se lit dans les fichiers ou se teste en jeu. | conventions du dépôt | tenue |

**Point ouvert, à trancher par Rémi.** E2 vise-t-elle aussi des services DIFFÉRENTS posés côte
à côte ? Des copies du même service trop proches sont du gaspillage pur. Des services
différents voisins couvrent les mêmes maisons : les séparer peut coûter des maisons, coût à
mesurer avant d'en faire une règle.

Mesuré le 10/11/2026 dans « Remplir l'île », route pavée (`TRANCHE` dans `planLattice.ts` :
1,5 aujourd'hui ; 1,25 sépare davantage les services de portées différentes) :

| Île | Services en pâté | Maisons au palier | Habitants | Pire espacement |
|---|---|---|---|---|
| medium_01 | 75 → 65 % | 563 → 516 | 22 121 → 21 645 | 0,59 → 0,53 |
| small_06 | 81 → 64 % | 217 → 226 | 8 190 → 8 495 | 0,49 → 0,47 |
| celtic_large_07 | 83 → 40 % | 888 → 1 013 | 20 843 → 21 628 | 0,55 → 0,42 |
| large_03 | 83 → 40 % | 1 495 → 1 413 | 60 843 → 60 827 | 0,66 → 0,53 |

Au total des quatre îles : autant de maisons au palier, +0,5 % d'habitants, deux fois moins de
pâtés ; mais trois seuils du panneau reculent (maisons au palier de medium_01, pire espacement),
donc ce réglage attend l'accord de Rémi.
