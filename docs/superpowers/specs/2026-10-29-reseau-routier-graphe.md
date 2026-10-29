# Trame mêlée, étape 2 : le réseau routier en graphe — conception

Statut : **validée par Rémi** ; étapes 0 à 5 faites (voir « Avancement » en fin de document).
Suite de `2026-10-29-diagonales-moteur.md`, section « Trame mêlée : conception ».

But de l'étape : que couverture, accès au comptoir et traversées d'aqueduc se calculent sur un
réseau qui contient à la fois des cases de route droites et des losanges diagonaux. L'étape ne
fait PAS encore produire de route diagonale aux moteurs (étapes 4 et 5) ; elle leur donne le
réseau sur lequel ils le feront. Exigence : un plan tout droit donne exactement le même
résultat qu'aujourd'hui, case pour case.

## 1. Comment les routes sont représentées aujourd'hui

### Trois mondes, aucun graphe explicite

| Où | Représentation | Adjacence | Raccordement d'un bâtiment |
|---|---|---|---|
| Moteurs (`planLattice`, `streetGrid`, `kontor`, `waterPlan`, `roadCleanup`, `islandPlan`) | masque `roadAt: Uint8Array(W·H)` en cases entières, modifié en place | 4 voisins, écrits en dur à chaque site | côté partagé (`orthoRoadCells`) |
| Analyseur, échelle 1 (`rootedRoadSet`, `roadConnected`, `streetCoverage` de `engine/rules.ts`) — sert à `invariants`, `ilots`, `planifier`, aux vérifications de `islandPlan` | `Set<string>` de clés `"x,y"` | `orthoNeighbors` | côté partagé |
| Éditeur, échelle 2 (même code, grille ½-tuile) | idem | `neighbors8` | côté OU coin |

- Le « graphe » des moteurs n'existe que dans les boucles : une soixantaine de sites
  énumèrent `c−1, c+1, c−W, c+W` (16 dans `planLattice`, 16 dans `kontor`, 13 dans
  `waterPlan`, le reste dans les moteurs de production).
- **La portée** : BFS multi-sources (`streetGrid.bfsType`), distance 1 sur les cases de route
  au contact de l'emprise, expansion tant que `d < portée`. Le plan diagonal
  (`cadreDiagonal`) fait tourner ce même code dans le repère tourné : un losange y est une case
  4-adjacente. Le graphe des losanges existe donc déjà, mais seul, jamais mêlé aux cases droites.
- **L'ordre d'énumération compte.** `bfsType` remplit `parent` (arbre de BFS), et
  `planLattice.pruneRoads` garde les routes en remontant cet arbre depuis chaque maison :
  changer l'ordre des voisins change les routes gardées, donc le plan. Les sites n'ont pas
  tous le même ordre (`bfsType` : gauche, droite, haut, bas ; `connectRing` : haut, bas,
  gauche, droite ; `orthoRoadCells` : haut/bas alternés, puis gauche/droite).
- **Un coin ne raccorde pas entre deux objets droits** : le moteur l'a appris à ses dépens
  (`connectKontor`, celtic_island_large_05 : 147 services isolés tant qu'une route en coin
  comptait). L'éditeur, en 8-adjacence ½-tuile, accepte pourtant ce coin. Écart connu, hors
  de cette étape (voir § 6).
- **Maillage de triangles** (`maillageTriangles.ts`, étape 1) : occupation et collisions
  seulement, aucune connexité.

## 2. Le modèle

### Les nœuds

Deux sortes de cases de route, dans un seul espace d'identifiants :

- **droite** `(x, y)` : `id = y·W + x`, dans `[0, N)` — exactement l'indice de case actuel ;
- **losange** centré sur le coin `(X, Y)`, `0 ≤ X ≤ W`, `0 ≤ Y ≤ H` :
  `id = N + Y·(W+1) + X`. Ses 8 triangles sont `trianglesDuCoin`.

Tous les coins sont admis, quelle que soit la parité de `X + Y` : deux quartiers diagonaux
décalés d'une case restent représentables. Deux losanges qui se chevauchent (coins voisins
par un côté de la grille) sont refusés par l'occupation en triangles, pas par le graphe.

### Les arêtes (géométriques, figées)

| Entre | Arête si | Voisins possibles |
|---|---|---|
| droite – droite | côté partagé | 4 : `(x±1, y)`, `(x, y±1)` |
| losange – losange | côté partagé | 4 : `(X±1, Y±1)` |
| droite – losange | **jonction de trame** : pointe du losange sur un coin du carré, sans chevauchement | 8 par carré (2 losanges par coin), 8 par losange — **règle à vérifier en jeu (Q1)** |

Deux objets de même orientation qui ne se touchent que par un point (deux cases droites en
coin, deux losanges pointe contre pointe) ne sont PAS reliés — c'est le comportement actuel
pour les cases droites.

### Le raccordement d'un bâtiment

Les points de départ d'un bâtiment sont les nœuds de route à son contact :
- même orientation que lui : par un côté partagé (aujourd'hui : `orthoRoadCells`) ;
- orientation différente : par un point (vérifié en jeu, maison droite / route diagonale et
  service diagonal / route droite).

La portée part de chacun (distance 1), une case de route quelle qu'elle soit compte pour un
pas (vérifié en jeu). Une maison est servie si l'un de ses nœuds de contact est atteint.

### La représentation en mémoire : un graphe implicite sur deux masques

Recommandé : garder l'état là où il est, et ajouter un second masque.

- `routeDroite: Uint8Array(N)` — l'actuel `roadAt`, inchangé, toujours modifié en place par
  `layRoad`, `stamp`, etc. ;
- `routeLosange: Uint8Array((W+1)·(H+1))` — nouveau, vide tant qu'aucun moteur ne pose de
  diagonale ;
- un module `engine/reseauRoutier.ts` qui lit ces deux masques : `voisins(id, f)`,
  `contacts(emprise, f)`, `bfsPortee(sources, portée)`, `racine(sourcesComptoir)`,
  `degre(id)`.

Écarté : un graphe explicite (liste d'adjacence compacte). Les moteurs posent et retirent des
routes des milliers de fois (chaque `stamp` efface les cases recouvertes) ; il faudrait le
reconstruire sans cesse. Le graphe implicite ne coûte rien à la mise à jour, et ses tables de
voisins sont des décalages fixes.

**Règle de parité** : `voisins` et `contacts` énumèrent d'abord les nœuds droits, dans l'ordre
du site qu'ils remplacent, PUIS les losanges. Masque des losanges vide ⇒ mêmes nœuds visités,
dans le même ordre, mêmes `parent`, même plan. Là où les sites diffèrent d'ordre, l'ordre
droit est un paramètre de la fonction (deux ordres existent : celui de `bfsType` et celui de
`connectRing`), plutôt qu'une normalisation qui changerait les plans.

### Les traversées d'aqueduc

Aujourd'hui (`waterPlan.connect`) : BFS à états (case × direction) ; sur une case de route la
conduite continue tout droit. Avec des losanges, la règle de franchissement d'une route
diagonale par une conduite n'est pas connue (Q3). En attendant : une conduite droite n'entre
pas dans une case dont un triangle porte un losange de route. Prudent, et sans effet sur un
plan droit.

## 3. Ce qu'il faut changer, dans quel ordre

Un commit par étape ; à chaque étape, le golden du § 4 passe à l'identique.

0. **Figer la référence** avant toute modification : script de capture, empreintes versionnées,
   test de comparaison (§ 4). Rien d'autre ne bouge.
1. **`reseauRoutier.ts`, module pur, et ses tests** — sans qu'aucun moteur ne l'utilise :
   - arêtes et contacts vérifiés contre le maillage de triangles (oracle : deux nœuds se
     touchent par un côté si leurs triangles partagent une arête, par un point sinon) ;
   - différentiel : sur des masques droits aléatoires, `bfsPortee` donne les mêmes `dist`,
     `reach`, `reachList` et `parent` que l'actuel `bfsType`, et `racine` le même ensemble que
     `rootedRoadSet` ;
   - **projection du plan diagonal** : un plan calculé par `cadreDiagonal` dans son repère,
     reporté dans le graphe commun en losanges, doit donner les mêmes couvertures et le même
     réseau enraciné que ceux calculés par le moteur dans le repère tourné. C'est le test qui
     valide les arêtes losange–losange sur de vrais plans.
2. **Analyseur à l'échelle 1** : `rootedRoadSet`, `roadConnected`, `streetCoverage` passent
   par le graphe quand `scale === 1` (l'échelle 2 de l'éditeur ne bouge pas). Touche
   `invariants`, `ilots`, `planifier` et les vérifications de `islandPlan` sans les modifier.
3. **`streetGrid`** : `orthoRoadCells`, `touchesRoad`, `bfsType`, `connectRing` sur le graphe ;
   puis `planLattice` (`coveredOrigins`, qui inverse le contact route → origines de maison,
   et `pruneRoads`). Mesure de temps avant/après : `bfsType` est le chemin chaud.
4. **Comptoir et nettoyage** : `connectKontor`, `repairRoadConnectivity`, `pruneDeadEnds`
   (le degré d'une case devient le degré d'un nœud).
5. **`waterPlan`** : la règle de franchissement du § 2.
6. *(Option, à décider)* **Premier usage réel : les liaisons en diagonale.** `connectKontor`
   et la réparation tracent leur chemin dans le graphe mêlé et posent des losanges quand c'est
   plus court — le « palier 1 » de l'étude des diagonales. Ici le plan change, volontairement :
   mesuré sur le recensement des 23 îles romaines (maisons rasées pour le comptoir, services
   sans accès). C'est la première fois que le graphe mêlé tournerait sur des plans entiers.

Hors de l'étape : moteurs de production (`slotPlan`, `prodPlan`, `localProd`, `prodlayout`),
puisque l'onglet Production est à refaire ; éditeur et grille ½-tuile ; pose de bâtiments
diagonaux dans un plan droit (étape 5).

## 4. Vérifier qu'un plan droit ne change pas

### Le golden des plans

Les moteurs d'île sont déterministes (aucun budget en temps, aucun tirage hors de `anneal`,
l'ancien optimiseur) : une empreinte exacte a un sens.

- **Panel** : medium_01, large_07, large_03, small_06 (le tableau du plan diagonal), small_05,
  medium_04 (raccordements au comptoir difficiles), une île celte ; Patriciens, routes pavées,
  dévotion selon la Foi ; plus un cas en chemin de terre, deux « Ma commande » (`ilots`), et
  le plan diagonal de large_07 — lui aussi doit rester identique, puisqu'il passe par le même
  code dans son repère.
- **Empreinte** : la sortie complète, dans son ordre (bâtiments `defId@x,y,rot`, routes,
  conduites, champs), réduite à un hachage, plus les chiffres lisibles (maisons, habitants,
  maisons au palier, services posés, bilan, plans au choix retenus) pour qu'un écart se lise
  dans le diff.
- **Fichiers** : capture par un script, empreintes versionnées dans le dépôt ; un test
  bloquant sur deux ou trois cas rapides, le panel entier dans un balayage déclenché par
  variable d'environnement, comme `audit.sweep.test.ts`.
- Le test I5 de `planLattice.test.ts` compare deux exécutions entre elles, pas à une
  référence : il ne détecte pas une dérive. Le golden le complète.

### Les tests différentiels

Pendant la migration, les anciennes fonctions (`bfsType`, `rootedRoadSet`, `streetCoverage`
à l'échelle 1, `pruneDeadEnds`) sont recopiées dans les fichiers de test comme oracles et
confrontées au graphe sur des masques aléatoires. Elles partent une fois la migration finie et
le golden tenu.

### Le temps

Temps du panel mesuré avant (étape 0) et après chaque étape ; tolérance proposée : +10 %.

## 5. Questions de règles du jeu (à tester en jeu)

**Q1 — Jonction route droite / route diagonale.** Quand on prolonge une route droite par une
route en biais, qu'occupe le coude ? Une case droite et un losange qui ne se touchent que par
la pointe sont-ils reliés, ou le jeu pose-t-il des demi-cases de raccord (les « coins » de
`WedgeConfig`) ? Et la portée : le coude compte-t-il pour un pas ?

**Q2 — Pointe contre pointe.** Deux losanges qui ne se touchent que par une pointe (deux
routes diagonales parallèles décalées) sont-ils reliés ? Hypothèse : non, comme deux cases
droites en coin.

**Q3 — Aqueduc et route diagonale.** Une conduite droite peut-elle franchir une route en
biais ? Si oui, sur combien de cases doit-elle aller tout droit ?

Seule Q1 bloque l'étape 6 et la portée à travers une jonction ; les étapes 0 à 5 peuvent
avancer avec la règle géométrique ci-dessus et un test qui la fige, à corriger après réponse.

### Réponse à Q1 (captures en jeu de Rémi, lecture confirmée par lui)

- **Jonction par recouvrement.** Une route droite qui rejoint une route en biais y ENTRE : sa
  dernière case est la case entière que la bande diagonale contient sur cette ligne (couverte
  par deux losanges consécutifs) ; la case d'avant est à moitié sous le pavage diagonal (les
  pièces en coin de `WedgeConfig`). Le contact par une simple pointe, modélisé aux étapes 1 à 5,
  est FAUX pour deux routes ; il reste vrai pour un bâtiment contre une route (vérifié avant).
- **La portée est une longueur de trajet.** Depuis un même embranchement, la zone servie
  s'arrête à la même distance réelle sur la branche droite (7 à 8 cases) et sur la branche
  diagonale (environ 5 losanges). Une case diagonale coûte donc environ √2 pas, et non un.
  La règle notée le 30/10 (« un pas par case diagonale ») était fausse ; elle est encore dans
  `cadreDiagonal` (portées-rue non réduites) et dans `parcourir` (un pas par nœud).

Corrections qui en découlent : jonction par recouvrement dans le graphe ; portée pondérée
(1 par case droite, √2 par losange) ; portées-rue du catalogue diagonal divisées par √2 ; gains
de la trame diagonale recalculés.

## 6. Écart relevé en passant

L'éditeur (grille ½-tuile, `neighbors8`) relie deux objets droits qui ne se touchent que par un
coin, ce que le moteur refuse à juste titre. Un plan affiché peut donc paraître mieux
raccordé qu'il ne l'est en jeu. À traiter quand l'éditeur passera au graphe, pas dans cette
étape.

## Avancement

**Étape 0 — golden** (`optimizer/trameDroite.golden.test.ts`, empreintes dans
`optimizer/__golden__/`, forcées en LF par `.gitattributes`). 15 cas : 11 plans d'île droits
(réglages de l'écran Planifier : 80 %, pavée, dévotion selon la Foi ; plus terre, objectif
maisons, ateliers et emplacements), 2 plans diagonaux dans leur repère, 2 commandes,
`planLattice` seul. Déterministe (deux passes identiques). 3 cas rapides bloquants (3,5 s),
le panel entier avec `GOLDEN=1` (≈ 65 s). Recapture volontaire : `-u`.

**Étape 1 — `engine/reseauRoutier.ts`.** Placé dans `engine` et non `optimizer` : l'analyseur
(`engine/rules.ts`) s'en sert, et `engine` ne dépend pas d'`optimizer`. Une seule relation,
`noeudsAuContact` : elle sert d'arête du graphe ET de raccordement d'une case de bâtiment
(côté entre objets de même orientation, pointe entre droite et losange). `voisins` (les routes
au contact), `casesAuContact` (les cases droites servies), `parcourir` (portée en nœuds,
parcours réutilisable). Tests : contact confronté à l'oracle du maillage de triangles ;
parcours identique à `bfsType` sur 40 masques aléatoires (atteints, ordre, parents) ; plan
diagonal de small_06 projeté en losanges : même réseau enraciné et mêmes couvertures que
l'analyseur dans le repère tourné (`optimizer/reseauRoutier.projection.test.ts`).

**Étape 2 — analyseur à l'échelle 1.** `rootedRoadSet`, `roadConnected` et la couverture le
long des rues passent par le graphe ; l'échelle 2 de l'éditeur est inchangée. Golden identique
sur les 15 cas ; test différentiel contre l'ancienne 4-adjacence sur 30 plans aléatoires
(routes sous les emprises, emprises qui débordent), qui échoue bien si l'on fausse le contact.
Les ensembles renvoyés gardent les clés `"x,y"` ; un losange y aurait la clé `"Lx,y"`.

**`RoadTile.losange`** (décidé à l'étape 3) : une case de route d'un plan peut être un losange,
centré sur le coin (x, y). Champ optionnel, grille des moteurs seulement ; l'éditeur n'en pose
pas et ne sait pas en dessiner. Sans lui, les fonctions qui reçoivent des `RoadTile[]`
(comptoir, réparation, élagage, eau) n'auraient pu être testées sur aucun losange.

**Étape 3 — `streetGrid` et `planLattice`.** Le `roadAt` d'un moteur est le masque `droite`
d'un `ReseauRoutier` (`reseauVide(W, H, roadAt)`) ; les losanges passent par `poserLosange`,
qui tient un compte : à zéro, les parcours sautent la recherche des jonctions. Contact d'une
emprise (`routesAuContactRect`, ordre historique de `orthoRoadCells` puis losanges), portée
(`bfsType`), raccordement d'un anneau (`connectRing`), couverture des maisons, élagage ancré
au comptoir et chemins des sources passent par le graphe. Les tracés à travers le terrain libre
restent droits ; leur arrêt reconnaît un losange touché par un coin (`losangeAuContact`).
Panel du golden : 67,8 s contre 66,2 s (+2,5 %).

**Étape 4 — comptoir et nettoyage.** `connectKontor`, `repairRoadConnectivity`,
`pruneDeadEnds` sur le graphe.

**Étape 5 — `waterPlan`.** Règle prudente : ni conduite ni source sur une case dont un losange
de route couvre la moitié (`casesSousLosange`).

Golden identique à chaque étape ; suite complète verte. Les branches losange sont testées là
où une entrée peut en porter (module, `streetGrid`, comptoir, réparation, élagage, eau).

### Ce qui reste

- **Non testé sur des losanges** : les branches losange de `planLattice` (élagage ancré au
  comptoir, chemins des sources). Aucun moteur n'y pose encore de losange ; elles le seront
  quand un moteur en posera (étape 6).
- **Occupation** : `fitsBld`, `fitsHouse` et `stamp` ignorent les losanges. Une maison droite
  pourrait se poser sur la moitié de case d'un losange. À traiter avec l'étape 6, par le
  maillage de triangles.
- **Hors périmètre, oubliés par la conception** : le moteur des commandes (`commande/ilots.ts`,
  `atteintes` et `routeVersReseau`) a ses propres parcours en 4-adjacence ; de même les moteurs
  de production (`slotPlan`, `prodPlan`, `localProd`, `prodlayout`). L'éditeur (échelle 2).
- **Deux écarts au jeu gardés pour la parité** : les graines du noyau de
  `repairRoadConnectivity` et le test « contre une route » du déplacement d'un consommateur
  d'eau comptent les 4 cases EN COIN d'une emprise, que le jeu ne raccorde pas. Les corriger
  change des plans : à faire à part, golden recapturé et écarts mesurés.
