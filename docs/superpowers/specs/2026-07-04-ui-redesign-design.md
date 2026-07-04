# Refonte UI complète — Design

Date : 2026-07-04 · Branche : dédiée `feature/ui-redesign` · Statut : design à valider.

## 1. Contexte & objectif

L'UI actuelle est datée : `TopBar` à ~11 boutons en vrac, `Toolbar` horizontale surchargée
(11 contrôles wrap), **5 modals** pour tout (Île, Plan d'île, Couverture, Audit, catalogue),
onglets `Éditeur|Multi-îles` **sans aucun CSS** (`.tabs` absente d'`index.css`). Diagnostic :
**aucun bouton n'est réellement mort** (tous les handlers résolvent vers des actions store
valides) — le ressenti « ça ne marche plus » vient de la présentation (onglets cassés,
surcharge, thème plat). Donc refonte = **présentation + IA**, risque fonctionnel faible.

Objectif : interface **claire, intuitive, moderne**. Thème sombre conservé mais modernisé.

## 2. Décisions (validées)

- Nav latérale gauche **par MODES** : `Éditeur` · `Plan d'île` · `Multi-îles`.
- **Plan d'île** promu de modal → **mode plein écran** (config gauche / résultat droite).
- Diagnostics (Couverture, Audit) → **overlays/panneaux dans l'éditeur** (plus de modals).
- Périmètre : refonte UI **+ backlog v1** : **drill-down « voir le layout d'une île »** en
  multi-îles + **feedback de progression unifié**.
- Ressources = **multiselect à chips** (recherche + puces + nb slots montagne).

## 3. Design system (fondation, `index.css`)

Modernisation des tokens + composants réutilisables (classes CSS, pas de lib) :
- **Tokens** : échelle d'espacement (`--sp-1..6`), rayons (`--r-sm/md/lg`), palette raffinée
  (surfaces `--s0/s1/s2`, texte `--t/--t-muted`, `--accent`, rôles success/warn/danger),
  hauteurs de contrôle cohérentes. Deux graisses (400/500), sentence case partout, zéro emoji
  dans le chrome (icônes = petit set SVG inline ou webfont si dispo ; sinon glyphes actuels
  tolérés mais harmonisés).
- **Composants** (classes) : `.nav-rail` + `.nav-item(.active)` ; `.topbar` slim + `.menu`
  (popover fichier) ; `.tool-palette` (flottante verticale) + `.tool(.active)` ; `.panel`
  (catalogue/inspecteur, en-tête + corps + scroll interne) ; `.chip-input` + `.chip` ;
  `.btn` variants (`.btn-primary/.btn-ghost/.btn-danger`) ; `.card` ; `.metric` ; `.result`.
- **Règle** : plus de `!important`, plus de styles inline éparpillés dans les composants
  denses — tout passe par des classes. Densité confortable (cibles ≥ 28px).

## 4. Shell (`App.tsx` + nouveaux composants)

- `App` : `<AppShell>` = `<NavRail mode ... />` (gauche) + `<TopBar />` (haut, slim) +
  zone de contenu qui rend le mode courant. Le **mode** (`editor|island|multi`) vit dans le
  store (`uiMode`) — persistant en session, accessible partout (pas d'état local perdu).
- `NavRail` : 3 items (icône + label), état actif net. Réutilisable.
- `TopBar` slim : nom d'île (depuis `layout.grid.islandId`) + undo/redo + `Menu` fichier
  (Nouveau, Importer JSON, Exporter JSON, PNG, Charger une île). Le sélecteur de taille de
  grille passe dans le menu ou un petit popover (rarement utilisé).

## 5. Mode Éditeur (`EditorView` refondu)

- Layout : `Catalog` (gauche, `.panel`), canvas (centre), `Inspector` (droite, `.panel`, =
  l'ancien `SidePanel` restylé).
- **`ToolPalette`** flottante sur le canvas (remplace `Toolbar` horizontale) : groupes
  pointeur/déplacer · route/champ/gomme · dessiner/masquer grille · **45°/rotation** ·
  toggles vue. Réutilise les actions store existantes (`setMode`, `toggleDiagonalBuild`,
  `rotateCurrent`, `toggleRadius`).
- **Diagnostics intégrés** : bouton `Couverture` (toggle du surlignage + un panneau latéral
  droit repliable listant les services et % — l'ancien `CoveragePanel` transformé en panneau,
  plus un modal) ; bouton `Audit` (panneau latéral listant les bâtiments sans route, l'ancien
  `RoadAudit` en panneau). Un seul panneau de diagnostic à la fois (onglets internes
  Couverture/Audit). Réutilise `analyzeCoverage`, `setCoverageHighlight`, `updateDef`.

## 6. Mode Plan d'île (`IslandPlannerView`, promu de modal)

- Vue 2 panneaux : **config** (gauche) — archetype (population/production), tier, besoins,
  slider %, et en production le **`ChipMultiSelect` des ressources** (le profil persistant de
  l'île) + bien à produire (filtré par producibilité, SP-A existant) + débit ; **résultat**
  (droite) — métriques (habitants, maisons, couverture, argent), bilan, trous, bouton
  `Placer sur l'île`. Réutilise `runIslandPlan`, `applyOptimization`, `resources.producibleGoods`.
- Le `<RunPanel>` partagé (bouton Calculer + barre de progression + états erreur/vide).

## 7. Mode Multi-îles (`MultiIslandView` refondu)

- **Party board** : cartes d'île propres (nom, taille, rôle épinglé, `ChipMultiSelect` de
  ressources) + ajout/retrait. Réutilise le store party (SP-A) + `ChipMultiSelect`.
- Paramètres globaux + `RunPanel` partagé (`Dimensionner`/`Placer tout`, même progression que
  Plan d'île).
- Résultat : tableau des rôles + population totale + bilan + trous.
- **Drill-down (backlog v1)** : sur une ligne du résultat, `Voir le layout` → charge cette île
  dans le mode Éditeur avec son plan appliqué (réutilise `applyOptimization` + `buildIslandGrid`
  + le rendu existant). Nécessite que le plan de l'île soit dans le résultat (mode `place`, ou
  recalcul à la demande via le planner mono-île pur).

## 8. Composants partagés (réutilisables, zéro duplication)

- **`ChipMultiSelect`** (`src/ui/components/ChipMultiSelect.tsx`) : props `{ options:{value,label}[],
  selected:string[], onChange, placeholder }`. Recherche + puces + retrait. **`ResourceSelector`
  le réutilise** (fertilités = options ; + champ nb slots à côté). Utilisé Plan d'île ET Multi-îles.
- **`RunPanel`** (`components/RunPanel.tsx`) : bouton(s) d'action + progression + erreur/vide.
  Utilisé Plan d'île ET Multi-îles (feedback unifié).
- **`NavRail`**, **`TopBarMenu`**, **`Panel`**, **`ToolPalette`** : composants shell.
- Domaine/optimiseur **inchangés** (déjà purs) : la refonte est UI-only côté logique.

## 9. État & flux
- Store : ajouter `uiMode: "editor"|"island"|"multi"` + `setUiMode` (+ éventuel
  `diagnostic: "none"|"coverage"|"audit"` pour l'éditeur). Le reste des actions inchangé.
- Drill-down : `MultiIslandView` appelle `loadIsland(id)` + `applyOptimization(planDeLîle)` +
  `setUiMode("editor")`.

## 10. Tests
- Logique quasi inchangée → pas de nouveaux tests moteur. `ChipMultiSelect` : test léger de
  filtrage/sélection (fonction pure de filtre extraite si utile). Sinon vérif = **tsc + lint +
  build + smoke navigateur** par mode (convention du projet pour l'UI). Garde la suite 165 verte.

## 11. Décomposition (plans ordonnés)
- **SP-1 Design system + shell** : tokens/classes `index.css`, `store.uiMode`, `AppShell`,
  `NavRail`, `TopBar` slim + menu. (Fonde tout, fixe les onglets.)
- **SP-2 Éditeur** : `ToolPalette`, `Inspector`, diagnostics en panneaux (Couverture/Audit).
- **SP-3 Plan d'île** : `IslandPlannerView` (modal→mode), `ChipMultiSelect`, `RunPanel`,
  `ResourceSelector` sur chips.
- **SP-4 Multi-îles** : `MultiIslandView` (party board + chips + RunPanel) + **drill-down**.
Chaque SP : plan → impl → tsc/lint/build/smoke vert → commit. Les anciens `Modal`-based
`IslandPlanner`/`CoveragePanel`/`RoadAudit` sont remplacés (supprimés une fois portés).

## 12. Risques
- Rewrite UI large → mitigé par la décomposition en 4 SP livrables + la logique intacte
  (aucun moteur touché). `Modal` conservé pour `IslandPicker`/`CatalogEditor` (overlays
  légitimes). Perf rendu canvas inchangée (culling déjà en place).

## Hors périmètre (motivé)
Fret inter-îles, multi-bien optimal par île de prod, heights par île dans le worker multi
(restent au backlog). Refonte = présentation + drill-down + progression ; pas de nouveau moteur.
