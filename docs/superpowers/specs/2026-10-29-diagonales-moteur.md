# Diagonales dans les moteurs de plan — étude (29/10/2026)

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

## Ce que les fichiers du jeu disent, et ce qu'ils taisent

- `DiagonalBuildEnabled` (templates.xml) : la pose diagonale est un réglage global, actif.
- Routes : `WedgeConfig` (tuiles « coin » diagonales) sur l'asset `Street`.
- Bâtiment à 45° : diamant, accroché à l'aire bloquée la plus proche.
- **Raccordement au coin : aucune preuve dans les fichiers** (ni `StreetAdjacency`, ni type de
  connexion). Rémi le constate en jeu pour « certaines maisons ».
- **Coût d'un pas diagonal pour la portée des services (1 ou √2) : inconnu.**
- **Largeur d'une route diagonale (combien de tuiles elle consomme de part et d'autre) :
  inconnue.**

## Ce que coûtent aujourd'hui les raccordements à angle droit

Recensement du 29/10/2026, « Remplir l'île », Patriciens, routes pavées, 23 îles romaines :
**toutes** rasent des maisons pour relier leur ville au comptoir (2 à 18, et 74 sur
roman_island_small_05), et 8 laissent des services sans accès au comptoir, donc inactifs —
16 sur small_05 (126 maisons, 3 780 habitants), 4 à 5 sur medium_04, medium_05, large_04, et
une source d'aqueduc sur small_02, medium_02, medium_06, large_02. C'est la cible du palier 1.

## Proposition, par paliers mesurables

1. **Routes de liaison en diagonale.** Les moteurs gardent leur trame droite, mais les
   chemins qui RELIENT (comptoir, poches isolées, sources d'aqueduc, couloirs en biais) se
   tracent en 8-adjacence sur la grille ½-tuile, après la pose. Cible : les échecs de
   raccordement recensés ci-dessus. Faible risque — la trame et ses tests ne bougent pas.
2. **Bâtiments en diagonale dans les franges.** 11 à 17 % de la terre reste libre en bord de
   côte, trop étroite pour une maison 3 × 3 droite. Une maison en diamant, raccordée par un
   coin, y loge peut-être. Demande la règle du coin, confirmée en jeu.
3. **Trame entière à 45°** pour les îles allongées en biais : la trame de `planLattice` tournée,
   comparée à la trame droite, la meilleure gardée. Le plus gros chantier : couverture et
   distance-rue en diagonale, donc le coût d'un pas diagonal.

## À vérifier en jeu (Rémi)

1. Une route diagonale : combien de tuiles de large occupe-t-elle, et laisse-t-elle des
   « coins » inconstructibles de chaque côté ?
2. Portée d'un service le long d'une route diagonale : atteint-il autant de maisons qu'en
   ligne droite, ou environ 30 % de moins (√2) ?
3. Raccordement par le coin : maison DROITE dont le coin touche une route DIAGONALE ; maison
   DIAGONALE dont le coin touche une route DROITE ; est-ce vrai pour tous les bâtiments ?
