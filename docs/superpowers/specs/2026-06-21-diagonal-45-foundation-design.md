# Système de construction 45° — Design (SP1 : fondation géométrique)

Date : 2026-06-21 · Branche : `feature/diagonal-45` · Statut : design validé, spec à relire.

## 1. Contexte & objectif

Anno 117 permet de construire **routes et bâtiments à 45°** (diagonal). Notre planner
est resté axis-aligned (rotations 0/90/180/270, grille entière, 4-adjacence) pour se
concentrer sur les moteurs. On implémente maintenant le 45°, **optimiseur compris**
(périmètre validé : « tout »). C'est trop gros pour un seul spec → décomposé en 5
sous-projets ; **ce spec couvre SP1 (la fondation)**.

## 2. Le mécanisme du jeu (recherche fichiers + devblogs)

Source : agent de recherche 2026-06-21 (dump dans le transcript). Verdicts [FICHIERS]/[WEB].

- **[FICHIERS+WEB]** 45° **par crans, 8 directions** (4 cardinales + 4 diagonales), pas de
  rotation libre. Toggle global `DiagonalBuildEnabled` (templates.xml, défaut on).
- **[FICHIERS+WEB]** **Sous-tuiles : chaque tuile = 4 sous-tuiles (½-tuile, 2× plus fin/axe).**
  1 tuile = 2 unités-monde (confirmé : `build_catalog.py` fait `round(xf*2)` sur les `.ifo`).
- **[FICHIERS+WEB]** Routes = **graphe + tuiles "wedge"** (triangles diagonaux). Asset
  `Street` GUID 23996 avec `<WedgeConfig>` (`..._diagonal.cfg`). Connexion **au coin =
  8-adjacence**.
- **[WEB+FICHIERS]** Bâtiment à 45° = **diamant**, snappé à l'aire-bloquée la plus proche
  (peut grossir/rétrécir un peu). Le mesh ne change pas, l'emprise oui. Masque diamant `AQ`
  dans `res01.ifo`.
- **[WEB / OUVERT]** Distance-rue diagonale = "path distance" ; **coût 1 vs √2 par pas non
  confirmé** (reste ouvert, à trancher en SP3 / in-game).

## 3. Décomposition (ordre dicté par les dépendances)

1. **SP1 — Fondation géométrique** *(ce spec)* : grille ½-tuile (2×), `Rotation` 8 valeurs,
   `footprintCells` diagonal (diamant), 8-adjacence, migration data/persist/render au 2×,
   moteurs recalibrés. Le 45° n'est PAS encore plaçable.
2. **SP2 — Éditeur + rendu 45°** : pose manuelle 8 directions, rendu routes wedge + diamants,
   validation diagonale.
3. **SP3 — Couverture / distance-rue** : BFS 8-adjacence, graphe routes diagonal,
   `analyzeCoverage`/`streetGrid`/eau adaptés ; trancher coût diagonal (1 vs √2).
4. **SP4 — Optimiseur diagonal** : `planLattice`/`packPlan`/`prodPlan` génèrent des layouts
   diagonaux.
5. **SP5 — Finitions** : PNG/UX, calibrations.

Chaque SP a son propre cycle spec → plan → implémentation.

## 4. SP1 — Design détaillé

### 4.1 Convention de coordonnées
- **1 tuile-jeu = 2 unités-grille (½-tuile, "HT").** Toutes les coordonnées de grille
  (`GridShape.w/h`, `PlacedBuilding.x/y`, `RoadTile`, `FieldTile`, `AqueductTile`, `GridSlot`)
  sont en **½-tuiles**.
- **`def.size` reste en TUILES** (catalogue inchangé, extraction inchangée). La géométrie
  convertit ×2 au besoin. Une résidence 3×3 tuiles occupe 6×6 cellules ½-tuile.
- Helpers : `tileToHT(n) = n * 2`, `htToTile(n) = Math.floor(n / 2)`.

### 4.2 Type `Rotation`
`export type Rotation = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;`
Extension additive : le code existant ne produit que 0/90/180/270 → rétro-compatible.

### 4.3 Géométrie (`src/engine/geometry.ts`)
- `footprintSize(def, rot)` :
  - rot ∈ {0,180} → `{ w: 2*def.size.w, h: 2*def.size.h }` (HT)
  - rot ∈ {90,270} → `{ w: 2*def.size.h, h: 2*def.size.w }`
  - rot ∈ {45,135,225,315} → bbox carrée du diamant : côté = `ceil((2*def.size.w + 2*def.size.h) / Math.SQRT2)` HT (demi-largeur diamant = (w+h)/√2 par axe, ×2 pour le diamètre).
- `footprintCells(def, x, y, rot)` → `Cell[]` (en ½-tuiles) :
  - axis (0/90/180/270) : rectangle plein `footprintSize` à partir de (x,y).
  - **diagonal** : le bâtiment est un rectangle de `2*def.size.w x 2*def.size.h` HT, donc de
    **demi-largeurs `def.size.w` et `def.size.h` HT**, pivoté de `rot` autour de son centre.
    `(x,y)` = coin haut-gauche de la **bbox du diamant** (côté = `footprintSize`) ; centre =
    `(x + side/2, y + side/2)`. **Règle "aire" (packing serré, décision user : densité max,
    symétrie inutile)** : une cellule est **bloquée ssi >= 50 % de son aire est dans le
    rectangle pivoté**, estimé par **sous-échantillonnage 4×4** (16 sous-points, seuil 8).
    Pour chaque sous-point `(x+i+(si+.5)/4, y+j+(sj+.5)/4)`, on calcule `local = R(-rot) .
    (sp - centre)` et on compte `|local.x| <= def.size.w && |local.y| <= def.size.h`. ->
    diamant ~ aire-préservée (3×3 = 37 cases vs 36 axis ; les diamants s'interpénètrent aux
    bords = packing dense). Déterministe, hand-computable (tests).
  - Note : seuls 45 (≡225 par symétrie centrale) et 135 (≡315) donnent des diamants distincts ;
    on les calcule tous via la formule générale (robuste).
- `orthoNeighbors(x,y)` (existant, 4-adj) **conservé** + nouveau
  `neighbors8(x,y): Cell[]` (4 ortho + 4 diagonaux).
- Conventions documentées en tête de fichier.

### 4.4 Migration 2× (le gros morceau)
- **`src/data/islands.ts`** : `decodeMask` **upscale ×2** (chaque tuile → bloc 2×2, plus
  proche voisin). Idem rivières. Les masques générés (`islands.generated.json`) restent en
  tuiles ; l'upscale se fait **au chargement** (pas de re-extraction).
- **`src/data/terrain.ts`** : `slotsOf` ×2 (coords), `heightsOf` upscale ×2 (chaque tuile →
  2×2 même q), `riversOf` ×2.
- **`src/state/store.ts` / `model/factories.ts`** : `emptyLayout`/`makeGrid`/`resizeGridShape`
  en ½-tuiles ; `loadIsland` produit des grilles 2× ; bornes UI (resize) ×2.
- **`src/render/draw.ts`** : la `View.cell` représente désormais une ½-tuile → la vue par
  défaut divise `cell` par 2 (l'île physique inchangée à l'écran). `render/exportImage`
  `fitView` recalculé (grille 2× plus grande).
- **`src/persist/local.ts` + `serialize.ts`** : clé **v8**. Migration `loadState` : un état
  v7 (1×) est **multiplié ×2** au chargement (grille, bâtiments, routes, champs, aqueducs).
  `findOrphanRefs` inchangé.
- **Moteurs** (`planLattice`/`packPlan`/`prodPlan`/`streetGrid`/`waterPlan`) : tournent sur
  2×. **Constantes en tuiles → ×2** : `STEPH = 2*rh+1` (rh déjà en HT via def×2), portées
  (`streetRange`/`radius.range` en TUILES → ×2 pour le BFS HT), tailles bâtiments (×2 via
  footprintSize), `MAX_RUN`/rayons eau (×2). **Sorties recalibrées** (grille plus dense) —
  ce n'est PAS behavior-preserving (contrairement à streetGrid). `analyzeCoverage`/
  `computeRadiusCoverage` : portées ×2.

### 4.5 Flux de données
Île (json 1×) → chargement upscale ×2 → `GridShape` HT → moteurs/coverage en HT (portées ×2)
→ rendu (cell px ÷2) → persistance v8 (HT). Un save v7 est migré ×2 à l'ouverture.

### 4.6 Découpage interne SP1 (paliers testables)
1. **Types + géométrie + tests purs** : `Rotation` 8 valeurs, `footprintSize`/`footprintCells`
   diagonal, `neighbors8`, conversions. Tests vérité-terrain (diamants calculés à la main).
   N'altère PAS encore les consommateurs (additif).
2. **Migration data/persist/render ×2** : islands/terrain upscale, factories/store, draw,
   persist v8 + migration v7→v8. App fonctionne (axis-aligned) au 2×.
3. **Recalibrage moteurs/coverage** : portées/constantes ×2 ; re-vert tests moteurs (FP/
   snapshots régénérés au 2×, seuils comportementaux conservés).

### 4.7 Tests
- **Géométrie** : `footprintSize` aux 8 rotations (3×12 asymétrique) ; `footprintCells`
  diamant **calculé à la main** pour 1×1, 2×2, 3×3 (nb de cellules + cellules-clés) ;
  `neighbors8` ; `tileToHT`/`htToTile`.
- **Migration** : `decodeMask` upscale (1 tuile terre → 4 HT) ; persist round-trip v8 ;
  migration v7→v8 (un layout 1× chargé devient 2×, positions ×2).
- **Moteurs/coverage** : suites existantes re-vertes au 2× (snapshots planLattice/packPlan
  régénérés ; FP recalculé ; seuils houses/ratio/coverage conservés car layout physique ~idem).
- Cibles : tsc clean, lint 0, build green, suite verte au nouveau scale.

### 4.8 Risques
- **Migration tentaculaire** : touche data/persist/render/moteurs/tests. Mitigation : 3
  paliers internes, chacun vérifié (tsc+lint+tests) avant le suivant.
- **Recalibrage moteurs** : les snapshots exacts changent (×2) — régénérés, pas un bug. Les
  seuils comportementaux (houses>50, coverage>=90, ratio) doivent tenir (layout physique
  ~inchangé). Si un seuil casse nettement → investiguer (constante oubliée ×2).
- **Perf** : grille 4× plus de cellules (occ/BFS) → mémoire/CPU ×4. Acceptable (le lazy-greedy
  et l'epoch-scratch existants tiennent ; à surveiller sur continental 768²→1536²).
- **Coût diagonal distance** non tranché → repoussé en SP3 (SP1 ne fait pas de couverture
  diagonale).

### 4.9 Hors-périmètre SP1 (sous-projets suivants)
- Pose diagonale dans l'éditeur + rendu wedge/diamant → **SP2**.
- Couverture/BFS 8-adjacence + graphe routes diagonal + coût √2 → **SP3**.
- Génération de layouts diagonaux par les moteurs → **SP4**.

## 5. Critères de succès SP1
Grille 2× en place, app fonctionnelle (axis-aligned) au nouveau scale, géométrie diagonale
(`footprintCells` diamant + `neighbors8`) implémentée et testée vérité-terrain, persist v8 +
migration v7→v8, suite verte (snapshots régénérés). Prêt pour SP2 (pose diagonale).
