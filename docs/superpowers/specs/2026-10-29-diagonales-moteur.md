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

**Hypothèses à vérifier avant d'aller plus loin** :
- une case de route diagonale compte pour UN pas de portée (elle avance de √2) : c'est sans
  doute l'essentiel du gain de large_03 (1 949 maisons au palier contre 1 496) ;
- comptoir et sources d'aqueduc, d'orientation fixe en jeu, sont posés en biais ; sur les petites
  îles, l'accès au comptoir est le point faible du plan diagonal.

**Suite** : trame mêlée (une partie droite, une partie diagonale, un seul réseau, une seule
économie d'île) — comptoir et emplacements restent droits, les quartiers en biais suivent les
côtes en biais.

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
