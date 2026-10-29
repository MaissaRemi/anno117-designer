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
  grille tournée de 45°, proposée parmi les plans au choix (option avancée). +12 à +24 % sur
  large_07 et large_03 ; moins bonne sur les îles à goulets.
- **Maillage de triangles** (`optimizer/maillageTriangles.ts`) : 4 triangles par case, socle
  commun aux trames droite et diagonale (étape 1 de la trame mêlée).

## Règles du jeu établies pour la diagonale (vérifiées en jeu par Rémi)

- Route diagonale = losanges de côté √2 centrés sur les coins de la grille : √2 de large en
  travers, 2 cases sur une ligne horizontale.
- Maison 3 × 3 droite = 2 × 2 cases de route diagonale une fois posée en biais.
- Une case de route diagonale compte pour un pas de portée, comme une case droite.
- Raccordement par un coin : valable (maison droite / route diagonale, service diagonal /
  route droite). La portée part de chaque point de contact.
- Les demi-cases au bord d'une route diagonale sont constructibles par un bâtiment diagonal.
- La route du jeu est un graphe de tronçons (`MeshGraph`), pas une peinture de cases.

## La suite : trame mêlée, étape 2 — le réseau routier en graphe

Conception complète dans l'étude des diagonales, section « Trame mêlée : conception ». Une île
peut être droite ici et en biais là, avec UNE seule économie (un Amphithéâtre, un dieu, un
réseau d'eau, un bilan) : seule la géométrie est locale. Étapes restantes :
2. réseau routier en graphe (cases droites et losanges, raccordement par côté ou par coin,
   portée en nœuds) — couverture, accès au comptoir et traversées d'aqueduc dessus.
   Conception et avancement : `docs/superpowers/specs/2026-10-29-reseau-routier-graphe.md`.
   Faits : golden de la trame droite (`pnpm vitest run src/optimizer/trameDroite.golden.test.ts`,
   `GOLDEN=1` pour tout le panel), module `engine/reseauRoutier.ts`, et sur le graphe :
   analyseur à l'échelle 1, `streetGrid`, `planLattice`, comptoir, réparation, élagage,
   `waterPlan`. Une route de plan peut être un losange (`RoadTile.losange`). Restent : les
   liaisons diagonales (étape 6, option), l'occupation des losanges, `commande/ilots.ts` ;
   trois règles à vérifier en jeu (Q1 à Q3) — détail dans « Ce qui reste » de la conception ;
3. carte d'orientation de l'île selon ses côtes ;
4. squelette de rues mêlé, recousu aux jonctions ;
5. placement global unique des services, de l'eau et des maisons sur ce graphe ;
6. trame droite, diagonale et mêlée comparées dans les plans au choix.

Autres chantiers : onglet Production à refaire (mode « île de production » de Planifier) ;
prix du bilan non réglable dans l'interface ; plan diagonal non posable dans l'éditeur.

## Pièges connus

- Après une fusion, le serveur de développement peut garder des modules périmés (page blanche,
  « does not provide an export named … ») : le redémarrer.
- Une sonde de mesure doit passer les hauteurs de l'île (`heightsOf`) comme le worker de
  l'application, sinon ses résultats diffèrent de l'écran.
- Les moteurs tournent en cases entières (`downscaleGrid`) ; le résultat est reprojeté en
  demi-cases pour l'éditeur (`scaleResultToHalfTile`), alternatives comprises — un plan
  diagonal garde son repère.
