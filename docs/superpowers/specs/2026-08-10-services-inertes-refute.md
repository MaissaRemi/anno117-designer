# Retirer les services qui ne servent aucune maison — RÉFUTÉ par la mesure

Date : 2026-08-10. Tentative écrite, mesurée sur les 55 îles, **abandonnée**. Rien n'en subsiste
dans `src`. Ce document existe pour que la prochaine tentative parte d'ici plutôt que du même
raisonnement.

## L'idée, et pourquoi elle paraissait sûre

Le glouton de couverture (`diamondGain`, `planLattice.ts`) vise les cases de TERRE non
couvertes, pas les maisons. Sur une île où la terre déborde largement les emplacements
habitables, il pose donc des services pour couvrir du vide. Mesuré sur la continentale du DLC :
**3 095 services pour 764 maisons**, quand les 54 autres îles tiennent un ratio de 0,39.

Corriger le CRITÈRE avait déjà été tenté et reverti (cf. `2026-08-09-services-vs-maisons.md`) :
compter les emplacements sans convertir le seuil `2r²·0,25`, qui est une aire, le rendait
inatteignable pour les grands rayons — plus aucun wonder, palier effondré, −30 % sur celtic.

D'où l'angle retenu : **ne pas toucher au glouton**, et retirer APRÈS COUP les copies qui
s'avèrent ne servir personne, une fois les maisons posées et le garde-fou passé.

La sûreté reposait sur une propriété qui, elle, est vraie. Le BFS de portée est multi-source ;
en l'étiquetant par la copie LA PLUS PROCHE (`srcIdx`), on obtient : pour toute case-maison
couverte, la copie qui l'atteint au plus court est marquée utile, donc conservée. Une copie non
marquée n'est la plus proche d'aucune maison, et tout ce qu'elle couvre est couvert par une
autre, gardée. **La couverture distance-rue de chaque maison est donc rigoureusement
préservée**, et les attributs déjà figés par `placeHouses` restent exacts.

## La mesure, et le verdict

Balayage des 55 îles, protocole habituel, comparé à l'état de `dev` avec les exploitations
stériles retirées (`705cc12`) :

| | |
|---|---|
| habitants | **−13 819** |
| argent | +3 012 |
| îles qui bougent | 3 |
| `viable` | vrai partout |

| île | avant | après | écart |
|---|---|---|---|
| `roman_island_large_05` | 28 439 | **14 650** | **−13 789** |
| `roman_dlc01_island_small_02` | 9 964 | 9 943 | −21 |
| `roman_dlc01_island_continental_01` | 19 513 | 19 504 | −9 |

Le gain d'entretien attendu est là — +3 012 — et il est dérisoire devant la perte.

## Ce que la réfutation apprend

**L'île qui s'effondre est exactement celle que le correctif précédent avait fait monter.**
`roman_island_large_05` était passée de 14 650 à 28 439 grâce au retrait des exploitations
stériles : elle basculait tout juste au-dessus du seuil de viabilité de son palier haut. Retirer
des services l'en fait retomber, et elle revient au habitant près à sa valeur d'avant.

**La preuve de sûreté était juste, et insuffisante.** Elle établissait que la COUVERTURE
distance-rue ne change pas. Elle n'établissait pas que le BILAN de l'île ne change pas — ce sont
deux choses différentes, et c'est le bilan qui décide du palier. Une propriété correctement
démontrée sur la mauvaise grandeur ne protège de rien.

**Le projet l'avait déjà mesuré, sous une autre forme.** `2026-08-09-services-vs-maisons.md` :
« LES SERVICES NE GASPILLENT PAS LE SOL, ILS L'ACHÈTENT — diviser les services par deux coûte
23 % de la population ». Ce résultat portait sur des services retirés par un seuil, celui-ci sur
des services retirés par un critère de couverture ; la conclusion tient dans les deux cas. Une
revue adversariale l'avait signalé avant l'écriture du code, et l'argument a été écarté au motif
que la preuve géométrique couvrait le cas. Elle ne le couvrait pas.

**Le mécanisme exact reste à établir.** Les pistes non départagées : effets de zone euclidiens
comptés hors de la couverture distance-rue ; attributs figés dans `plots[].opts` qui créditent
des copies retirées lors de la cascade de main-d'œuvre ; `analyzeCoverage` recalculée sur les
bâtiments restants. Le trancher demanderait une trace du bilan vital de `large_05` avant et
après, palier par palier. Ce n'est pas fait, et ce document ne prétend pas le savoir.

## Ce qui reste vrai, et non traité

Le ratio de 4,05 service par maison sur la continentale reste une anomalie réelle — les 54
autres îles tiennent 0,39. Mais il ne se corrige ni par le critère du glouton (reverti, −30 %),
ni par un retrait a posteriori (ce document, −13 819). Les deux voies évidentes sont fermées, et
la troisième — dimensionner le glouton sur le potentiel de logement plutôt que sur la terre —
demande de convertir TOUS les termes du seuil de façon homogène, ce qui n'a jamais été fait
proprement.

Noter aussi que l'analyse de lecture a établi que les quatre usages de `landCount` sont
homogènes entre eux : le « défaut d'unité » que `ETAT-ET-SUITE.md` §3.6 décrit visait la
variante revertie, pas le code actuel.
