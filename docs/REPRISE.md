# Reprise du projet — état au 30/10/2026

Point d'entrée d'une nouvelle session. Tout le travail est sur la branche **`dev`** (poussée
sur GitHub) ; `main` n'a pas été mis à jour depuis.

## Remettre le projet en route

```
git clone https://github.com/MaissaRemi/anno117-designer.git
cd anno117-designer
git switch dev
pnpm install
pnpm dev          # application sur http://localhost:5173
pnpm test         # ~480 tests, 1 min 45 ; pnpm test:fast écarte les balayages lourds
```

Machine actuelle : Windows, projet dans `C:\Users\rem34\Projects\anno117-designer`, jeu dans
`C:\Program Files (x86)\Ubisoft\Ubisoft Game Launcher\games\Anno 117 - Pax Romana\maindata`
(patch 210). Les données extraites (`src/data/*.generated.json`, patch 200) sont versionnées :
l'application et les tests n'ont besoin de rien d'autre. `tools/rda_extract.py` lit les
archives `.rda` du jeu (`list`, `get`, `dump`) pour aller vérifier une règle dans les fichiers.

## Conventions du dépôt

- Échanges avec Rémi en français. Le dépôt est **en français** : commentaires, documentation,
  messages de commit (sans accents dans les commits). Garder cette cohérence.
- Ne jamais pousser sans l'accord de Rémi. Les commits sont libres.
- Toute règle de jeu se vérifie dans les fichiers du jeu, ou se demande à Rémi qui la teste en
  jeu — jamais d'extrapolation présentée comme un fait.
- Raisonner à l'échelle de l'île et de l'objectif choisi (habitants, maisons…), pas chipoter
  sur quelques cases perdues localement.
- PowerShell 5.1 : `R` est un alias réservé ; un message de commit avec guillemets passe par
  `git commit -F fichier`.

## Ce qui a été fait (26–30/10/2026)

Détail et mesures : `docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`, puis
`docs/superpowers/plans/2026-10-29-portees-motifs-eau.md`, puis
`docs/superpowers/specs/2026-10-29-diagonales-moteur.md` (le plus récent).

- Refonte du moteur d'île : onglet « Ma commande » (nomenclature, îlots, production posée).
- Portée selon le type de route, copies en trop retirées, corridors d'eau, objectif
  « maximum de maisons », un seul écran Planifier.
- Géométrie des îles lue dans le jeu (terre constructible, eau côtière, relief), emplacements
  de montagne prédéfinis, ponts sur les rivières, bâtiments côtiers à cheval sur l'eau.
- Dieux tutélaires branchés (dévotion = Foi de l'île, productivité, habitants de Cérès).
- Eau fiable pour les Patriciens ; prix du bilan (un bilan sain vaut quelques habitants).
- **Plans au choix** : jusqu'à trois plans contrastés (front de Pareto : habitants, maisons
  au palier, bilan, argent), présentés en cartes (`optimizer/plansAuChoix.ts`).
- **Trame diagonale expérimentale** (`optimizer/cadreDiagonal.ts`) : l'île planifiée dans la
  grille tournée de 45°, proposée parmi les plans au choix (option avancée). Une fois la portée
  comptée en longueur et le raccordement au comptoir corrigé, elle ne gagne plus nettement que
  sur small_07 (+26 %).
- **Maillage de triangles** (`optimizer/maillageTriangles.ts`) : 4 triangles par case, socle
  commun aux trames droite et diagonale (étape 1 de la trame mêlée).

## Règles du jeu établies pour la diagonale (vérifiées en jeu par Rémi)

- Route diagonale = losanges de côté √2 centrés sur les coins de la grille : √2 de large en
  travers, 2 cases sur une ligne horizontale.
- Maison 3 × 3 droite = 2 × 2 cases de route diagonale une fois posée en biais.
- **La portée est une longueur de trajet** : une case de route diagonale, longue de √2,
  coûte environ 1,4 pas (captures de Rémi : depuis un même embranchement, la zone servie
  s'arrête à la même distance réelle sur la branche droite et sur la branche diagonale). La
  règle notée d'abord, « une case diagonale = un pas », était FAUSSE ; le gain de la trame
  diagonale (+12 à +24 %) a été mesuré avec elle et est à recalculer.
- **Jonction droite / diagonale par recouvrement** : la route droite entre dans la route en
  biais, sa dernière case est la case entière de la bande diagonale sur sa ligne ; la case
  d'avant est à moitié recouverte par le pavage diagonal. Pas de contact par une simple pointe.
- Raccordement par un coin : valable (maison droite / route diagonale, service diagonal /
  route droite). La portée part de chaque point de contact.
- Les demi-cases au bord d'une route diagonale sont constructibles par un bâtiment diagonal.
- La route du jeu est un graphe de tronçons (`MeshGraph`), pas une peinture de cases.

## Où en est la trame mêlée : EN PAUSE

Décidé après mesure (section « étape 3 : étude préalable » de l'étude des diagonales) : le
gain espéré d'une île droite ici et en biais là est du même ordre que le bruit entre deux plans
droits, et l'orientation des côtes ne prédit rien. Les étapes 3 à 6 (carte d'orientation,
squelette mêlé, placement global, comparaison) ne sont pas commencées.

Ce qui en reste, utilisable :
- le **réseau routier en graphe** (`engine/reseauRoutier.ts`), cases droites et losanges, sous
  l'analyseur, `streetGrid`, `planLattice`, le comptoir, la réparation, l'élagage et l'eau.
  Conception et bilan : `docs/superpowers/specs/2026-10-29-reseau-routier-graphe.md` ;
- le **golden de la trame droite** (`pnpm vitest run src/optimizer/trameDroite.golden.test.ts`,
  `GOLDEN=1` pour les 15 cas, `-u` pour recapturer un changement VOULU) ;
- les **liaisons diagonales** vers le comptoir, derrière l'option `liaisonsDiagonales`
  (désactivée : elles n'apportent rien de mesurable, et l'éditeur ne sait pas dessiner un
  losange — `RoadTile.losange`).

Q2 (deux losanges pointe contre pointe) et Q3 (aqueduc et route en biais) restent à vérifier en
jeu ; sans effet tant qu'aucun losange n'est posé.

## Raccordement au comptoir : corrigé

**Albion**, mesuré à part (22 îles, pavée, Foi, 80 %, hauteurs), avant les corrections
(commit 62e8e0b) → après, chaque branche séparément, aucune île en recul :
- branche celte (Aldermen) : 339 540 → 339 973 habitants, 114 → 73 maisons rasées, 0 service
  sans accès avant comme après ;
- branche romanisée (Nobles) : 354 443 → 356 489 habitants, 171 → 68 maisons rasées, 18 → 0
  services sans accès (tous sur small_04 : 1 011 → 2 612 habitants).

Recensement sur les 27 îles romaines du **Latium** (Patriciens, pavée, Foi, 80 %), avant →
après :
1 078 230 → 1 082 207 habitants, 263 → 113 maisons rasées, 31 → 1 service sans accès au
comptoir. Trois corrections dans `optimizer/kontor.ts`, une dans `optimizer/planLattice.ts` :
- **une maison rasée coûte plus qu'un détour** (`PRIX_CASE_RASEE` = 3) dans le raccordement du
  comptoir et la réparation des îlots ;
- **la réparation repasse sur ses échecs** tant qu'un îlot s'est raccroché : un îlot du fond ne
  se raccroche souvent qu'à travers un autre, traité après lui. small_05 : 3 780 → 6 450
  habitants, 16 → 1 service coupé ; son plan droit dépasse désormais le diagonal (5 313), dont
  le « +41 % » venait surtout de ce défaut ;
- **la réparation raccorde aussi le BÂTIMENT**, depuis tout son pourtour, quand son îlot de
  route est irrécupérable : la route d'une source d'aqueduc, creusée côté montagne, ne
  revenait pas vers la ville alors que le réseau était à 2 ou 3 cases de l'autre côté
  (large_02, medium_02, small_05, extralarge_04). Services sans accès : 8 → 4. La population
  affichée ne bouge pas — le moteur comptait déjà ces services actifs —, mais en jeu une
  source coupée assèche tout son réseau d'eau ;
- **les poches murées restent vides** (`planLattice`) : un grand bâtiment posé contre le relief
  peut murer une bande de terre ; une route qu'aucun chemin à travers la terre (sans traverser
  de bâtiment) ne relie au comptoir réservé est déclarée murée, ses services sortent du plan et
  aucune maison ne s'y pose. medium_05 : 3 → 0 services sans accès, −69 habitants AFFICHÉS
  (l'ancien chiffre comptait trois services inactifs) ; plan diagonal de medium_01 : 37 → 2.
  Effet de bord assumé : la recette retenue peut changer. Seul cas vu en Albion, par le test
  `bilanIndicatif` : celtic_island_large_07, branche ROMANISÉE (Nobles), sans hauteurs, passe
  de 14 400 à 12 301 habitants affichés ; la recette qui l'emportait devait son bilan à huit
  services (versions d'Albion) d'un quartier muré, inactifs en jeu — piste la plus probable,
  non isolée ; avec les réglages du recensement (hauteurs, pavée, Foi), cette île ne recule pas.
  Les poches laissées vides peuvent déclencher l'invariant `terre-vide`.

## La suite, par intérêt

1. ~~Ne pas créer de poches~~ : fait (`planLattice`, « UN GRAND BÂTIMENT NE MURE PAS UNE PARTIE
   DE L'ÎLE ») — une grande emprise qui couperait du comptoir plus de 25 maisons de terre est
   posée ailleurs. Latium : +1 926 habitants (extralarge_02), aucune île en recul ; seuils 3, 6
   et 12 essayés, chacun faisait reculer une ou deux îles. Plan diagonal de medium_01 :
   14 384 → 22 990 habitants.
2. ~~Deux écarts « cases en coin »~~ : corrigés, sans effet mesuré en Latium.
3. ~~Plan diagonal d'extralarge_04 à 0 habitant~~ : il loge désormais 2 218 maisons ; l'une
   des corrections du raccordement ou des poches a levé l'échec, non isolée.
4. **Un service sans accès compte encore dans la couverture et le bilan** : reporté. Il n'en
   reste qu'un en Latium (medium_02, une source d'aqueduc barrée par un service) et aucun en
   Albion ; le corriger demande de réévaluer chaque maison sans les services inactifs, or
   `planLattice` n'exporte que le palier atteint, pas la couverture.
5. **Île de production** : conception à valider, quatre questions pour Rémi
   (`docs/superpowers/specs/2026-10-30-ile-de-production-design.md`).
6. ~~Prix du bilan non réglable~~ : curseur dans les options avancées de « Remplir l'île »
   (indicatif seulement, 0 à 20 %, 6 % par défaut).
7. **Plan diagonal non posable dans l'éditeur** : reporté. L'éditeur (demi-cases) ne sait
   représenter ni un losange de route ni une maison diagonale sans approximation, et la
   diagonale ne gagne plus nettement que sur small_07 (+26 %).

## Pièges connus

- Après une fusion, le serveur de développement peut garder des modules périmés (page blanche,
  « does not provide an export named … ») : le redémarrer.
- Une sonde de mesure doit passer les hauteurs de l'île (`heightsOf`) comme le worker de
  l'application, sinon ses résultats diffèrent de l'écran.
- Les moteurs tournent en cases entières (`downscaleGrid`) ; le résultat est reprojeté en
  demi-cases pour l'éditeur (`scaleResultToHalfTile`), alternatives comprises — un plan
  diagonal garde son repère.
