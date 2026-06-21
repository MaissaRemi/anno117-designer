# Feuille de route — reste à faire (annoDesigner, 2026-06-21)

## ÉTAT D'EXÉCUTION (2026-06-21, branche feature/operational-polish)
Phases attaquées dans l'ordre. **124 tests verts, tsc clean, lint 0, build green.**
- **Phase 0 ✅** — makeBuildingDef spread, ESLint+CI lint, `tsc --noEmit`, chunk-limit,
  worker-guard, .editorconfig, garde river-grid + GAME path + overrides périmés.
- **Phase 1 ✅** — tests geometry/score(+B7)/economy/boundary + fork euclidien/rue ;
  packPlan snapshot ; prodPlan & quality déterministes (seed/maxIters).
- **Phase 2 ✅** — `<Modal>` partagé (+Escape/aria, 5 panels), erreurs inline,
  bannière « aucun plan » + garde Placer, export PNG pleine île.
- **Phase 3 ✅** — gate eau par-bâtiment, I3 coût d'import, I4 productivité FreeArea.
- **Phase 4 §2-B ✅** — `streetGrid.ts` extrait (task #10), **prouvé byte-identique**
  (FP_HASH avant=après). **§2-D : slice sûre ✅** (test vérité-terrain de l'oracle).
- **Phase 6 ✅ (scaffolds)** — Q1 opt `consumptionUnit` (flip prêt), B6 marqueur derate.

**Reportés (motivé) :**
- **§2-D unification BFS complète** — *non fait volontairement* : unifier l'oracle et le
  BFS moteur rendrait l'oracle NON-indépendant (préoccupation du critic) ; le test
  vérité-terrain est la meilleure correction → fait.
- **§2-E découpe planLattice en phases** — readability pure sur une fonction qui marche
  et est gatée par snapshot. La méthode de vérif FP existe (prouvée en §2-B) → faisable
  sans risque, mais c'est un gros refacto dédié. **À greenlighter si voulu.**
- **Phase 5** — calibration MAX_RUN/CLIMB_MARGIN = EN JEU (protocole livré) ; découplage
  double-pente = gaté sur la calibration ; BFS jump-edges = clarté seule (L), reporté.
- **B6 derate** — gaté sur la réponse en jeu (3 branches pré-spécifiées ci-dessous).

---


Issu d'une investigation multi-agents vérifiée contre le code **actuel** (post-simplification +
correctifs B1-B8 / I1-I8). 30 items réels, 0 déjà fait par erreur. Séquencé en 7 phases respectant
les dépendances. Effort S/M/L/XL · Risque low/med/high. Voir [AUDIT-2026-06-21.md](AUDIT-2026-06-21.md).

Rien de tout ceci n'est **bloquant** : l'app marche (1 optimiseur, 93 tests verts). C'est de la
qualité, de la justesse de modèle, et de la dette.

---

## PHASE 0 — Garde-fous & hygiène (indépendants, parallélisables, à poser en 1er pour durcir la CI)

| id | quoi | effort | risque |
|---|---|---|---|
| `makebuildingdef-drops-fields` | **BUG** : `makeBuildingDef` (factories.ts:42-63) ne recopie pas `transporterRange`/`template`/`freeArea`/`unique` → perte silencieuse pour tout def créé par code/test. Fix 1 ligne (`{...defaults, ...partial}`). | S | low |
| `eslint-flat-config` | Aucun ESLint. Ajouter eslint 9 flat + typescript-eslint + react-hooks (la directive `eslint-disable` à GridCanvas.tsx:67 n'est honorée par personne). Bruit attendu faible (0 `as any`, 0 `console.*`). | M | low |
| `chunk-size-raise-limit` | Warning build sur le chunk index (179 KB gz) = faux positif. `build.chunkSizeWarningLimit:700` ; PAS de manualChunks (rien d'autre à splitter, heightmaps déjà lazy). | S | low |
| `build-drop-tsc-b` | `build: "tsc -b"` est un reliquat (pas de project refs) → remplacer par `tsc --noEmit` ; supprime `tsconfig.tsbuildinfo`. CI typecheck 2× actuellement. | S | low |
| `worker-es-format-guard` | `worker.format:'es'` (vite.config:8) est porteur (import dynamique heightmaps) mais aucun test. Test d'assertion de config (échoue si repassé en iife). | S | low |
| `pipeline-game-path-guard` | 4 scripts python hardcodent `GAME = F:\...` → `os.environ.get('ANNO_GAME_DIR', ...)` + assert. | S | low |
| `pipeline-guid-overrides-guard` | `SERVICE_BUILDING_OVERRIDES` (build_economy.py:43) = 4 GUID en dur sans validation → warn stderr si périmé après patch jeu. | S | low |
| `build-terrain-river-grid-mismatch-guard` | **BUG silencieux** : `grid_bits` (build_terrain.py:89-91) renvoie un masque rivière **désaligné** si dims ≠ île (les heights, elles, renvoient None). → marque les mauvaises cases inconstructibles. Fix = `return None` symétrique. | S | low |
| _(oubli critic)_ prettier + `.editorconfig` | Aucun formateur → un reformat futur exploserait les diffs vs golden snapshots. Optionnel, 1 décision. | S | low |

## PHASE 1 — Dette de tests sur les primitives (aucune dép ; sécurise tous les refactos suivants)

| id | quoi | effort | risque |
|---|---|---|---|
| `test-geometry-direct` | **0 test direct** sur `engine/geometry.ts` (footprint/rotation/inBounds/isBuildable). Bug de transposition w/h = panne silencieuse la + grave. | S | low |
| `test-score-direct` | **0 test direct** sur `optimizer/score.ts` (la fonction objectif entière). Un signe de poids inversé passe tous les tests. Garde aussi B7 (exclusion fournisseurs). | M | low |
| `test-economy-units` | `chainFertilities` (récursif, gate la faisabilité d'île) + fallbacks `pickProducer` non testés directement. | M | low |
| `test-data-boundary-typed` | ~10 casts `as unknown as` (seed.ts:13, **economy.ts:72**, **terrain.ts:19** = prod runtime, pas que tests). Option (b) = `boundary.test.ts` structurel (sans dép zod). | M | med |
| _(oubli critic)_ test couverture euclidien/rue | Le fork `useStreet` (rules.ts:279) = sémantique cœur de couverture, jamais testé en direct. | S | low |
| `tighten-quality-anneal-tests` | quality.test.ts a des bandes de tolérance RNG (`*0.9`, `-2`) → seed+maxIters (I1 dispo) pour assertions exactes. | S | low |
| `tighten-prodplan-threshold` | Seuil `>=0.85` dépend de la vitesse machine : `prodPlan` ne passe PAS seed/maxIters à anneal. Les threader → reproductible. | M | med |
| `packplan-position-snapshot` | **GATE du refacto moteur** : packPlan n'a PAS de snapshot exact (planLattice oui). Vérifier d'abord que packPlan est déterministe (sinon = bug à corriger avant). | S→M | low |

## PHASE 2 — Polish UI (indépendant du moteur)

| id | quoi | effort | risque |
|---|---|---|---|
| `shared-modal` (+ a11y fusionné) | Le scaffold modale (backdrop+stopPropagation) est dupliqué dans **5 panels**. Extraire `<Modal>` **avec** Escape-to-close + `role=dialog`/aria + focus dès le départ (1 seul passage). _ATTR_FR n'est PLUS dupliqué (résolu par la simplif)._ | M | low |
| `error-surfacing-inline` | 2 `alert()` bruts (IslandPlanner:87, TopBar:42) → message inline stylé. Garder les `confirm()` destructifs. | S | low |
| `planner-explains-empty-result` | Un plan à 0 maison s'affiche « 0 habitants » avec « Placer » actif. Bannière « Aucun plan — <raison> » + désactiver Placer. Données déjà calculées (`feasible`/`gaps`). | M | low |
| `png-full-island-export` | **I7** : export PNG = viewport visible seulement (crop). Rendu off-screen pleine île via `drawScene` (déjà pur). | M | med |

## PHASE 3 — Justesse économie/eau (sans le refacto moteur ; parallèle à Phase 2)

| id | quoi | effort | risque |
|---|---|---|---|
| `water-partial-connection-optimism` | **BUG** : gate eau **par-def** (islandPlan:163-166) = un service est « vivant » si ≥1 copie raccordée. 30/50 Bains raccordés → maisons servies par les 20 morts comptées au tier. Gate **par-bâtiment** (set `inactiveBuildings` → analyzeCoverage). | M | med |
| `i3-import-cost` | **I3** : un bien brut sans producteur (ou fertilité absente) est traité **gratuit** (solve.ts:209) → `exportNet` surestimé. Comptabiliser `imports` + `importCost = Σ perMin×prix`, soustraire de `exportNet`. | M | med |
| `i4-freearea-gradient` | **I4** : FreeAreaProductivity binaire (réserve ou échec). Aire obtenue < requise → soit + de bâtiments, soit gap quantifié `~X% productivité`. | M | med |

## PHASE 4 — Consolidation moteur (strictement ordonnée, gatée par les snapshots Phase 1)

| id | quoi | effort | risque |
|---|---|---|---|
| `streetgrid-shared-module` | **task #10** : ~190 lignes quasi-identiques entre planLattice/packPlan (`connectRing` octet-pour-octet, `bfsType`, `orthoRoadCells`…). Extraire `streetGrid.ts` ; 2 seules divergences (`bldAdj` guard, `waterGate`) → hooks optionnels. Dépend de `packplan-position-snapshot`. | L | med |
| `unified-street-reach` | **§2-D** : 3 BFS distance-rue (rules.ts oracle string-keyé + 2 moteurs). Une seule `computeStreetReach` → l'oracle redevient un check indépendant (élimine « les tests sont d'accord avec le bug »). Test de caractérisation **+ le fork euclidien/rue**. Dépend de streetgrid. | L | **high** |
| `planlattice-phase-split` | **§2-E** : découper la fonction de 587 lignes en phases (`layComb`/`placeServices`/`densify`/`routeWater`/`placeHouses`/`pruneRoads`). 6 hazards d'ordre implicite à préserver (le golden snapshot les attrape). Dépend de streetgrid. | L | med |

## PHASE 5 — Simplifs eau (gatées par calibration en jeu)

| id | quoi | effort | risque |
|---|---|---|---|
| `water-ingame-calibrate-maxrun-climbmargin` | **IN-GAME** : `MAX_RUN=140` et `CLIMB_MARGIN_Q=2` = devinettes (le modèle B1 est correct, les scalaires non). Mesurer en jeu (conduite plate = MAX_RUN ; montée = MARGIN). **Bloque les 2 suivants.** | M | low |
| `water-collapse-dual-slope-model` | **Q2** : longueur (MAX_RUN) ET hauteur s'empilent quand les heights existent → sous-estime la portée. Découpler (longueur = décroissance pure, hauteur = pente). Dépend de la calibration. | M | med |
| `water-bfs-collapse-road-crossings-to-jump-edges` | Le state `cell×direction` (×4) n'existe que pour les croisements droits. Pré-calculer des arêtes « saut » → BFS sur graphe de cases simple. Clarté surtout. Mieux après streetgrid. | L | med |

## PHASE 6 — Mécaniques économie gatées en jeu (pré-scopées, livrables le jour du test)

| id | quoi | effort | risque |
|---|---|---|---|
| `q1-consumption-unit` | **IN-GAME #4** : conso par MAISON (solve.ts:196) vs par HABITANT. Si par habitant → **tous les comptes** faux d'un facteur capacité. Per-house = S (juste un test) ; per-resident = M (cascade marketValue/workforce/entrepôts). | S→M | **high** |
| `b6-workforce-productivity-mode` | **IN-GAME** : main-d'œuvre manquante = prod proportionnelle ? Le solveur fait monter la pop (solve.ts:251). 3 branches pré-écrites (proportionnel / seuil 10% / confirme l'actuel). Livrer après i3. | M | med |

---

## En jeu d'abord (débloque Phase 5 + 6) — protocoles dans AUDIT §« À VALIDER EN JEU »
1. **Q1** conso maison vs habitant (le + structurant).
2. **B6** main-d'œuvre manquante → prod proportionnelle ?
3. **MAX_RUN** (conduite plate) + **CLIMB_MARGIN_Q** (montée) — calibration eau.

## Ordre conseillé
Phase 0 + 1 (durcir avant de toucher au moteur) → 2 & 3 en parallèle → 4 (moteur, gros morceau) →
5 & 6 quand les tests en jeu sont faits. Les phases 0-3 sont du gain net sans risque sur le moteur
qui marche ; la phase 4 est le seul gros refacto (à faire derrière les golden snapshots).
