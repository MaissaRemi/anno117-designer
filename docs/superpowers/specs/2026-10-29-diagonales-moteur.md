# Diagonales dans les moteurs de plan — étude (29-30/10/2026)

Demande de Rémi : en jeu, routes et bâtiments se posent à l'horizontale, à la verticale ou en
diagonale ; un bâtiment se tourne ; une maison en diagonale dont un coin touche une route
droite est raccordée. Une route en diagonale passerait les couloirs étroits en biais de
certaines îles, là où les moteurs n'avancent qu'à angle droit.

## Ce qui existe

La fondation 45° de juin (`specs/2026-06-21-diagonal-45-foundation-design.md`) est livrée :
- grille vivante en ½-tuiles, `Rotation` à 8 crans, emprise en diamant (`footprintCells`) ;
- pose à 45° et rendu dans l'éditeur (SP2) ;
- réseau de routes en 8-adjacence sur la grille ½-tuile : **raccordement par le coin** (SP3),
  dans la couverture et l'accès au comptoir de l'éditeur ;
- les moteurs contournent les diamants posés à la main (SP4 réduit).

Ce qui manque : **aucun moteur ne produit de diagonale**. `planLattice`, `ilots` et la
production tournent sur la grille en TUILES (`downscaleGrid`), en 4-adjacence, routes et
bâtiments à angle droit ; le résultat est reprojeté en blocs 2 × 2.

## La géométrie de la diagonale

### Ce que disent les fichiers du jeu

- `DiagonalBuildEnabled` (templates.xml) : la pose diagonale est un réglage global, actif.
- **La route est un graphe de tronçons** (`MeshGraphStyle`), comme les murs et les aqueducs, pas
  une peinture case par case. Le jeu pose le long des tronçons des pièces de modèle
  (`TileSetCfgFolder` : `street_*/tileset/`).
- Dimensions de ces pièces (`.ifo` de `graphics_roman.rda`, `infrastructure/street_01/`, unité =
  une case) : les tronçons `street_{05,10,20,40}_straight` font **1,414 = √2 de large** pour
  0,5 / 1 / 2 / 4 de long ; les demi-tronçons font 0,5 (`inner`) ou 0,707 = √2 / 2 (`outer`) ;
  les décors au sol `*_decal`, 1 de large.
- `WedgeConfig` de l'asset `Street` : cases « coin » `Street_Building_Any`, `Building_Street_Any`…
  en versions droite et diagonale — des cases coupées le long de leur diagonale, une moitié
  route, l'autre bâtiment.

### Ce que Rémi a vérifié en jeu (30/10/2026)

- **Raccordement par le coin** : vrai pour une maison droite contre une route diagonale et pour
  un service en diagonale (Taverne) contre une route droite.
- **Portée** : non réduite. Elle part de chaque point de contact entre bâtiment et route ;
  collé par un côté, un bâtiment a plusieurs points de départ, touché par un coin, un seul —
  il couvre donc quelques cases de moins aux extrémités, à portée égale.
- **Demi-cases au bord d'une route diagonale** : constructibles par un bâtiment posé lui aussi
  en diagonale, qui se colle à la route comme en droite. Un bâtiment droit ne la touche que par
  un coin.

### Le modèle qui en sort

- La grille diagonale est la grille droite **tournée de 45° et agrandie de √2**. Une case de
  route diagonale est un losange centré sur un coin de la grille, pointes sur les 4 coins
  voisins : la moitié de chacun des 4 carrés autour, soit la surface de 2 cases.
- Une route droite fait 1 case de large ; une route diagonale **√2 en travers, donc 2 cases sur
  une ligne horizontale** (√2 / sin 45°).
- Le long d'une route diagonale, les demi-cases du bord vont aux bâtiments diagonaux ; pour un
  bâtiment droit, elles sont perdues. Un quartier diagonal est donc cohérent s'il est
  diagonal en entier : routes ET bâtiments.
- Reste ouvert : la portée le long d'une route elle-même diagonale (hypothèse : une case
  diagonale compte pour un pas, comme une case droite).

### Mesure en jeu des bâtiments diagonaux (30/10/2026)

Une maison 3 × 3 droite fait, posée en diagonale, **2 × 2 cases de route diagonale** (côté 2√2,
surface 8 cases droites au lieu de 9). La grille diagonale est donc celle des losanges de
route : tournée de 45°, côté √2.

## Trame diagonale : livrée en expérimental (30/10/2026)

`optimizer/cadreDiagonal.ts` : la grille de l'île vue dans le repère diagonal (une case
diagonale est constructible si ses 4 cases droites le sont), le catalogue remis à l'échelle
(emprises et portées euclidiennes ÷ √2, arrondies). Le moteur tourne tel quel dans ce repère.
Option « Essayer aussi une trame diagonale » : le plan diagonal rejoint les plans au choix,
l'aperçu le dessine tourné de 45° ; pas de pose dans l'éditeur.

Patriciens, routes pavées, dévotion selon la Foi :

| Île | droit | diagonal |
|---|---|---|
| large_07 | 64 691 hab., 1 566 maisons | 72 663 (+12 %), 1 910 |
| large_03 | 70 281, 1 883 | 87 461 (+24 %), 2 065 |
| medium_01 | 24 751 | 17 696 (247 maisons rasées vers le comptoir) |
| small_06 | 8 890 | 5 836 (11 services sans accès au comptoir) |

Correctif au passage (vaut aussi en droit) : `keepMainLandmass` gardait la terre la plus
PROCHE du comptoir, pas la plus grande — dans le repère diagonal, une case isolée collée au
comptoir faisait perdre l'île entière.

**⚠ INFIRMÉ ENSUITE (captures de Rémi, conception du réseau en graphe, Q1)** : la portée est une
longueur de trajet, une case diagonale coûte environ √2 pas. Le paragraphe suivant et le tableau
ci-dessus reposent sur la règle fausse. Corrigé : `catalogueDiagonal` divise les portées-rue par
√2 (sans arrondi, `planningRange` arrondit après le facteur de route).

**Gains recalculés**, mêmes réglages (Patriciens, pavée, Foi, 80 %), 27 îles romaines :

| Île | droit (hab.) | diagonal (hab.) | écart |
|---|---|---|---|
| small_05 | 3 780 | 5 313 | **+41 %** |
| small_07 | 6 411 | 8 109 | **+26 %** |
| medium_07 | 24 746 | 25 207 | +2 % |
| large_01 | 67 654 | 68 800 | +2 % |
| small_03 | 9 030 | 9 090 | +1 % |
| extralarge_01 à 03 | 85 755 à 87 229 | 80 544 à 83 749 | −4 à −7 % |
| large_03 | 70 281 | 66 782 | −5 % |
| large_07 | 64 691 | 58 212 | −10 % |
| 15 autres | | | −8 à −44 % (medium_01 −43 %, small_06 −44 %) |
| extralarge_04 | 81 382 | 0 | échec du plan diagonal |

La trame diagonale entière ne vaut donc que sur quelques îles à la forme en biais ; small_05
est aussi celle dont le plan droit rase le plus de maisons pour joindre le comptoir (74). C'est
plutôt un argument pour la trame MÊLÉE (droite ici, en biais là) que pour la diagonale seule.
L'échec complet sur extralarge_04 n'est pas expliqué.

~~Vérifié en jeu (30/10/2026)~~ : une case de route diagonale compte pour UN pas de portée,
comme une case droite — elle avance pourtant de √2. C'est l'essentiel du gain de large_03
(1 949 maisons au palier contre 1 496).

**Limites connues** : comptoir et sources d'aqueduc, d'orientation fixe en jeu, sont posés en
biais. Sur les îles à goulets (medium_01), le passage se rétrécit dans le repère diagonal, de
grands services y coupent la route et le sud reste isolé (256 maisons rasées) : les plans au
choix ne retiennent alors pas le plan diagonal. Correctif au passage : la réparation des routes
et le raccordement du comptoir franchissent les rivières par un pont, comme le reste du moteur.

## Trame mêlée : conception

Demande de Rémi : une île peut être droite ici et en biais là ; une seule économie d'île
(un Amphithéâtre, un dieu, un réseau d'eau, un bilan), seule la géométrie est locale.

**Le maillage commun : les triangles.** Une case droite coupée par ses deux diagonales donne 4
triangles (la grille du dessin de Rémi). Une case droite = ses 4 triangles ; une case
diagonale = les 8 triangles autour d'un coin (2 par case droite). Les deux trames s'écrivent donc
sur un même maillage de 4 triangles par case : occupation, collisions et jonctions s'y lisent
exactement, sans approximation.

**Étapes** :
1. *Occupation en triangles* : emprises droites et diagonales, routes, eau ; validation des
   collisions. Les plans actuels (droits, ou diagonaux via `cadreDiagonal`) s'y projettent sans
   perte — premier test.
2. *Réseau routier en graphe* : une case de route (droite ou losange) = un nœud ; arêtes par côté
   partagé ; un bâtiment se raccorde par côté ou par coin (vérifié en jeu). Portée = distance en
   longueur (une case diagonale coûte √2, cf. réseau en graphe, Q1 — l'hypothèse d'un pas par
   case était fausse). Couverture, accès au comptoir et
   traversées d'aqueduc se calculent sur ce graphe.
3. *Carte d'orientation* : pour chaque partie de l'île, droite ou diagonale selon l'orientation
   de ses côtes (direction dominante du bord), avec un seuil de taille pour ne pas émietter.
4. *Squelette mêlé* : le peigne de rues de `planLattice` tracé dans le repère de chaque partie,
   recousu aux jonctions par des rues de liaison (pertes locales acceptées).
5. *Placement global* : services, bâtiments uniques, eau, maisons posés UNE fois sur le graphe
   de toute l'île — le moteur actuel, ses entrées passant de la grille au graphe.
6. *Comparaison* : trame droite, diagonale et mêlée rejoignent les plans au choix.

Comptoir et emplacements de montagne restent droits dans toutes les trames.

## Trame mêlée, étape 3 : étude préalable (la carte d'orientation vaut-elle l'effort ?)

Après la correction de la portée (√2 par losange), deux sondes sur les 27 îles romaines,
Patriciens, pavée, Foi, 80 %. Sondes jetables, non versionnées.

**L'orientation des côtes ne prédit rien.** Part de côte en biais (gradient d'un masque de
terre lissé sur 7 × 7, aux cases de bord) : 40 à 60 % sur toutes les îles, comme un cercle
(50 %). small_05 (+41 % en diagonale) en a 45 %, medium_06 (−15 %) 59 %. Le critère « direction
dominante du bord » de la conception ne départage pas les îles.

**Plafond optimiste de la trame mêlée.** Par bloc de 32 × 32 cases, le meilleur des deux plans
entiers (droit, diagonal), en maisons comptées par leur centre : +5 à +18 % sur la plupart des
îles, +42 % sur small_05. Mais prendre le meilleur de DEUX PLANS DROITS différents gagne déjà,
par le seul jeu des fluctuations locales : 8,4 % sur small_07 (190 et 189 maisons), 6,9 % sur
extralarge_02, 16,3 % sur medium_05. (Témoin imparfait : sur les autres îles, l'objectif
« maisons » redonne le même plan droit, excès nul, sans valeur de mesure.) Le plafond de la
trame mêlée est donc du même ordre que ce bruit, AVANT le coût des coutures entre zones et de
l'économie commune. Seule small_05 sort du lot, et le plan entièrement diagonal, déjà proposé
parmi les plans au choix, le capte (+41 %).

**Conclusion provisoire** : les étapes 3 à 6 de la trame mêlée sont un gros chantier pour un
gain attendu faible. Décision à prendre par Rémi avant d'aller plus loin.

## Ce que coûtent aujourd'hui les raccordements à angle droit

Recensement du 29/10/2026, « Remplir l'île », Patriciens, routes pavées, 23 îles romaines :
**toutes** rasent des maisons pour relier leur ville au comptoir (2 à 18, et 74 sur
roman_island_small_05), et 8 laissent des services sans accès au comptoir, donc inactifs —
16 sur small_05 (126 maisons, 3 780 habitants), 4 à 5 sur medium_04, medium_05, large_04, et
une source d'aqueduc sur small_02, medium_02, medium_06, large_02. C'est la cible du palier 1.

## Proposition, par paliers mesurables

1. **Routes de liaison en diagonale.** Les moteurs gardent leur trame droite, mais les
   chemins qui RELIENT (comptoir, poches isolées, sources d'aqueduc, couloirs en biais) se
   tracent en diagonale quand c'est plus court, avec la vraie largeur (2 cases à
   l'horizontale). Aucun bâtiment ne les longe : les demi-cases perdues ne coûtent rien.
   Cible : les échecs de raccordement recensés ci-dessus. Faible risque — la trame et ses
   tests ne bougent pas.
2. **Bâtiments en diagonale dans les franges.** 11 à 17 % de la terre reste libre en bord de
   côte, trop étroite pour une maison 3 × 3 droite. Une maison en diamant, raccordée par un
   coin à la trame droite, y loge peut-être.
3. **Quartiers entiers à 45°** pour les îles allongées en biais : la trame de `planLattice`
   tournée (routes et bâtiments diagonaux), comparée à la trame droite, la meilleure gardée.
   Le plus gros chantier.
