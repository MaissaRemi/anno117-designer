# Refonte UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Refondre l'interface (nav par modes, palette d'outils flottante, diagnostics en panneaux, Plan d'île en mode, multiselect à chips, drill-down multi-îles) sur un design system sombre modernisé — sans toucher la logique moteur (déjà pure).

**Architecture:** 4 sous-projets livrables : SP-1 design system + shell (nav/topbar) ; SP-2 Éditeur (palette + diagnostics panneaux) ; SP-3 Plan d'île (modal→mode + chips + RunPanel) ; SP-4 Multi-îles (party board + chips + drill-down). Vérif UI = tsc + lint + build + smoke navigateur (convention projet). Suite 165 tests reste verte (logique intacte).

**Tech Stack:** React, TypeScript, Zustand, CSS (pas de lib UI). Réf spec : `docs/superpowers/specs/2026-07-04-ui-redesign-design.md`.

---

## File structure
- Modify `src/index.css` — nouveau design system (tokens + classes composants).
- Modify `src/state/store.ts` — `uiMode` + `setUiMode` ; `diagnostic` + `setDiagnostic`.
- Create `src/ui/shell/NavRail.tsx`, `src/ui/shell/AppShell.tsx`.
- Modify `src/App.tsx` — rend `AppShell`.
- Modify `src/ui/TopBar.tsx` — slim + menu fichier.
- Create `src/ui/components/ChipMultiSelect.tsx`, `src/ui/components/RunPanel.tsx`.
- Create `src/ui/ToolPalette.tsx` (remplace l'usage de `Toolbar` dans l'éditeur).
- Modify `src/ui/EditorView.tsx` — palette flottante + diagnostics panneau.
- Modify `src/ui/CoveragePanel.tsx`, `src/ui/RoadAudit.tsx` — variante panneau (pas modal).
- Modify `src/ui/IslandPlanner.tsx` → `IslandPlannerView` (mode) + `ResourceSelector` sur chips.
- Modify `src/ui/MultiIslandPanel.tsx` → `MultiIslandView` (party board + RunPanel + drill-down).
- Modify `src/ui/ResourceSelector.tsx` — réutilise `ChipMultiSelect`.

---

## SP-1 — Design system + shell

### Task 1 : store `uiMode` + `diagnostic`
**Files:** Modify `src/state/store.ts` · Test `src/state/ui-store.test.ts`
- [ ] **Step 1: test**
```ts
// src/state/ui-store.test.ts
import { describe, expect, it } from "vitest";
import { useStore } from "./store";
describe("store — uiMode/diagnostic", () => {
  it("bascule de mode et de diagnostic", () => {
    const s = () => useStore.getState();
    s().setUiMode("multi"); expect(s().uiMode).toBe("multi");
    s().setUiMode("editor"); expect(s().uiMode).toBe("editor");
    s().setDiagnostic("coverage"); expect(s().diagnostic).toBe("coverage");
    s().setDiagnostic("none"); expect(s().diagnostic).toBe("none");
  });
});
```
- [ ] **Step 2: run → FAIL** (`npx vitest run src/state/ui-store.test.ts`).
- [ ] **Step 3: implémenter** — dans `State` : `uiMode: "editor"|"island"|"multi"; diagnostic: "none"|"coverage"|"audit"; setUiMode: (m)=>void; setDiagnostic: (d)=>void;`. Init `uiMode:"editor", diagnostic:"none"`. Actions : `setUiMode:(m)=>set({uiMode:m})`, `setDiagnostic:(d)=>set({diagnostic:d})`. (Session-only, non persisté.)
- [ ] **Step 4: run → PASS** + `npx tsc --noEmit` 0.
- [ ] **Step 5: commit** `SP-1: store uiMode + diagnostic`.

### Task 2 : design system CSS
**Files:** Modify `src/index.css`
- [ ] **Step 1:** réécrire `index.css` avec : tokens (`--s0:#12161b; --s1:#1b2129; --s2:#232c36; --line:#2b3views…` → surfaces/texte/accent/rôles ; espacement `--sp-1..6` (4/8/12/16/24/32) ; rayons `--r-sm:6px --r-md:9px --r-lg:12px` ; hauteur contrôle 30px) ; base `button`/`input`/`select` raffinés ; classes : `.app`(flex row) ; `.nav-rail`,`.nav-item`,`.nav-item.active` ; `.topbar`(slim),`.tb-title`,`.tb-actions`,`.menu`,`.menu-pop` ; `.mode-content`(flex1,overflow) ; `.panel`,`.panel-head`,`.panel-body` ; `.tool-palette`,`.tool`,`.tool.active`,`.tool-sep` ; `.chip-input`,`.chip`,`.chip-x`,`.chip-search` ; `.btn`,`.btn-primary`,`.btn-ghost`,`.btn-danger`,`.btn-row` ; `.card`,`.metric`,`.metric-val`,`.result`,`.warn`,`.gap-list` ; `.catalog-*`,`.ci-*`,`.inspector-*` restylés ; `.island-picker-grid`,`.island-tile` ; `.party-card`. Conserver les classes encore référencées (`.modal*`,`.canvas-wrap`,`.canvas-hint`,`.island-grid`/`.island-card`/`.island-thumb`,`.audit-*`,`.bilan`,`.slider`,`.filters`,`.search`,`.opt-*`) tant qu'un composant les utilise. Zéro `!important`.
- [ ] **Step 2:** `npx vite build` vert (CSS valide).
- [ ] **Step 3: commit** `SP-1: modernized dark design system (index.css)`.

### Task 3 : `NavRail`
**Files:** Create `src/ui/shell/NavRail.tsx`
- [ ] **Step 1:**
```tsx
import { useStore } from "../../state/store";
const ITEMS = [
  { id: "editor", label: "Éditeur", icon: "🗺" },
  { id: "island", label: "Plan d'île", icon: "🏛" },
  { id: "multi", label: "Multi-îles", icon: "🏝" },
] as const;
export function NavRail() {
  const uiMode = useStore((s) => s.uiMode);
  const setUiMode = useStore((s) => s.setUiMode);
  return (
    <nav className="nav-rail">
      {ITEMS.map((it) => (
        <button key={it.id} className={"nav-item" + (uiMode === it.id ? " active" : "")}
          onClick={() => setUiMode(it.id)}>
          <span className="nav-ico" aria-hidden>{it.icon}</span>
          <span className="nav-lbl">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
```
- [ ] **Step 2:** tsc 0. **Commit** `SP-1: NavRail`.

### Task 4 : `TopBar` slim + menu fichier
**Files:** Modify `src/ui/TopBar.tsx`
- [ ] **Step 1:** réécrire le rendu : `<div className="topbar">` = titre (`<span className="tb-title">Anno 117 · Designer</span>` + nom d'île si `layout.grid.islandId`), `spacer`, undo/redo (icônes), et un bouton `⋯` qui ouvre `.menu-pop` avec : Charger une île (→ `IslandPicker` modal, conservé), Nouveau, Importer JSON, Exporter JSON, PNG. Conserver toute la logique existante (`onImport`, `onPng`, `newLayout`, `resizeGrid` via un petit champ dans le menu). Garder `IslandPicker` monté (state `islOpen`). RETIRER les boutons Plan d'île/Couverture/Audit du TopBar (ils passent en mode/panneau — Plan d'île via NavRail, diagnostics via l'éditeur en SP-2). Pendant la transition (avant SP-2/3), garder `CoveragePanel`/`RoadAudit`/`IslandPlanner` accessibles via des items de menu temporaires marqués (fonctionnels).
- [ ] **Step 2:** tsc + build. **Commit** `SP-1: slim TopBar + file menu`.

### Task 5 : `AppShell` + `App`
**Files:** Create `src/ui/shell/AppShell.tsx` · Modify `src/App.tsx`
- [ ] **Step 1:** `AppShell` = `<div className="app"><NavRail/><div className="app-col"><TopBar/><div className="mode-content">{content}</div></div></div>` où `content` dépend de `uiMode` : `editor`→`<EditorView/>`, `multi`→`<MultiIslandPanel/>`, `island`→`<IslandPlanner asView onClose={()=>setUiMode("editor")}/>` (ajouter un prop `asView` à IslandPlanner qui rend sans `<Modal>` — wrapper conditionnel). `App` garde le `useEffect` clavier intact et rend `<AppShell/>`. Supprimer l'ancien `.tabs`.
- [ ] **Step 2:** ajouter le prop `asView?: boolean` à `IslandPlanner` : si `asView`, rend le contenu dans `<div className="mode-pane">` au lieu de `<Modal>`.
- [ ] **Step 3:** tsc + lint + build. **Smoke** : les 3 modes s'affichent depuis la nav, thème appliqué, onglets remplacés. **Commit** `SP-1: AppShell (nav-rail modes, tabs replaced)`.

---

## SP-2 — Éditeur (palette + diagnostics panneaux)

### Task 6 : `ToolPalette`
**Files:** Create `src/ui/ToolPalette.tsx` · Modify `src/ui/EditorView.tsx`
- [ ] **Step 1:** `ToolPalette` = palette flottante verticale rendant les mêmes actions que `Toolbar` (tools via `setMode`, `◇45°` via `toggleDiagonalBuild`, `⟳`+rotation via `rotateCurrent`, `◎` via `toggleRadius`), groupées par `.tool-sep`. Réutilise le store (aucune nouvelle logique). `EditorView` : rendre `<div className="canvas-wrap">` avec `<GridCanvas/>` + `<ToolPalette/>` en overlay ; `Catalog` (gauche `.panel`), `Inspector` (droite `.panel`). Retirer `<Toolbar/>` de l'éditeur.
- [ ] **Step 2:** tsc + build + smoke (outils fonctionnent, 45°/rotation OK). **Commit** `SP-2: floating ToolPalette`.

### Task 7 : diagnostics en panneaux
**Files:** Modify `src/ui/CoveragePanel.tsx`, `src/ui/RoadAudit.tsx`, `src/ui/EditorView.tsx`
- [ ] **Step 1:** ajouter à `EditorView` deux boutons (dans un bandeau ou coin canvas) reliés à `store.diagnostic` (`setDiagnostic("coverage"|"audit"|"none")`). Quand `diagnostic!=="none"`, afficher un panneau latéral droit (`.panel`) rendant le contenu de couverture/audit. Adapter `CoveragePanel`/`RoadAudit` : accepter un prop `asPanel` → rendre sans `<Modal>` (contenu direct dans `.panel-body`), `onClose`→`setDiagnostic("none")`. Réutilise `analyzeCoverage`/`setCoverageHighlight`/`updateDef` existants.
- [ ] **Step 2:** retirer les items de menu temporaires Couverture/Audit du TopBar (Task 4). tsc + build + smoke. **Commit** `SP-2: coverage/audit as in-editor panels`.

---

## SP-3 — Plan d'île (mode + chips + RunPanel)

### Task 8 : `ChipMultiSelect` + `ResourceSelector` sur chips
**Files:** Create `src/ui/components/ChipMultiSelect.tsx` · Modify `src/ui/ResourceSelector.tsx`
- [ ] **Step 1: test du filtre pur**
```ts
// src/ui/components/chipFilter.test.ts
import { describe, expect, it } from "vitest";
import { filterOptions } from "./ChipMultiSelect";
describe("filterOptions", () => {
  const opts = [{ value: "a", label: "Vigne" }, { value: "b", label: "Fer" }, { value: "c", label: "Olives" }];
  it("filtre par label, insensible casse/accents, exclut déjà sélectionnés", () => {
    expect(filterOptions(opts, "vig", []).map((o) => o.value)).toEqual(["a"]);
    expect(filterOptions(opts, "", ["a"]).map((o) => o.value)).toEqual(["b", "c"]);
    expect(filterOptions(opts, "OLIV", []).map((o) => o.value)).toEqual(["c"]);
  });
});
```
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implémenter** `ChipMultiSelect` (composant contrôlé `{options, selected, onChange, placeholder}` : puces des sélectionnés avec `×`, champ de recherche filtrant `filterOptions`, liste déroulante d'ajout) + exporter la fonction pure `filterOptions(options, query, selected)` (normalise accents/casse, exclut selected). `ResourceSelector` : rendre `<ChipMultiSelect options={fertilités} selected={value.fertilities} onChange=...>` + le champ `mountainSlots` à côté.
- [ ] **Step 4: run → PASS** + tsc + build. **Smoke** : chips ajout/retrait, recherche. **Commit** `SP-3: ChipMultiSelect + ResourceSelector on chips`.

### Task 9 : `RunPanel` partagé
**Files:** Create `src/ui/components/RunPanel.tsx`
- [ ] **Step 1:** `RunPanel` = props `{running, progress?, error?, actions: {label, primary?, onClick, disabled?}[]}` → rangée de boutons + barre de progression + message d'erreur. Utilisé Plan d'île ET Multi-îles.
- [ ] **Step 2:** tsc. **Commit** `SP-3: shared RunPanel`.

### Task 10 : `IslandPlanner` → mode 2-panneaux
**Files:** Modify `src/ui/IslandPlanner.tsx`
- [ ] **Step 1:** quand `asView`, rendre en 2 panneaux `.mode-pane` : gauche = config (archetype, tier, besoins, slider, `ResourceSelector` chips en production, bien+débit) ; droite = résultat (métriques en `.metric`, bilan, gaps, `Placer sur l'île`). Remplacer les boutons Calculer/Placer par `<RunPanel>`. Conserver toute la logique (`run`, `place`, `runIslandPlan`). Le mode modal (`asView=false`) peut être retiré (plus utilisé) une fois le mode en place.
- [ ] **Step 2:** tsc + lint + build + smoke (calcul + placer marchent en mode). **Commit** `SP-3: Island planner as full 2-pane mode`.

---

## SP-4 — Multi-îles (party board + drill-down)

### Task 11 : `MultiIslandPanel` refondu + RunPanel + chips
**Files:** Modify `src/ui/MultiIslandPanel.tsx`
- [ ] **Step 1:** restyler en party board (`.party-card` par île : nom, taille, rôle épinglé, `ResourceSelector` chips), paramètres globaux, `<RunPanel actions=[Dimensionner, Placer tout]>`, résultat (tableau rôles + population + bilan + gaps en classes `.result`/`.metric`/`.gap-list`).
- [ ] **Step 2:** tsc + build + smoke. **Commit** `SP-4: multi-island party board (chips + RunPanel)`.

### Task 12 : drill-down « voir le layout »
**Files:** Modify `src/ui/MultiIslandPanel.tsx` · `src/optimizer/multiIslandPlan.ts` (si besoin d'exposer le plan)
- [ ] **Step 1:** dans le tableau résultat, ajouter par ligne un bouton `Voir le layout` (visible si `assignment.plan` présent, càd mode `place`, ou relancer `place` pour cette île). Au clic : `loadIsland(islandId)` puis `applyOptimization(planVersOptimizeResult(assignment.plan))` puis `setUiMode("editor")`. Écrire l'adaptateur `planToOptimizeResult(plan)` (mappe `IslandPlanResult`/`ProdPlanResult` → `OptimizeResult` : buildings/roads/fields/aqueducts, comme `IslandPlanner.place`). Réutilise `applyOptimization` + `buildIslandGrid` (via `loadIsland`).
- [ ] **Step 2:** tsc + build + smoke (drill-down charge l'île + layout dans l'éditeur). **Commit** `SP-4: multi-island drill-down (view layout in editor)`.

---

## Self-review
- **Spec §3 design system** → Task 2. **§4 shell** → Task 1/3/4/5. **§5 éditeur** → Task 6/7.
  **§6 Plan d'île mode** → Task 10. **§7 multi + drill-down** → Task 11/12. **§8 composants
  partagés** : `ChipMultiSelect`(8), `RunPanel`(9), `NavRail`(3), `ToolPalette`(6). ✓
- **Placeholders** : les steps CSS/JSX nomment les classes/props exactes ; le corps CSS complet
  est écrit à l'exécution (rewrite volumineux, tokens+liste de classes spécifiés). Interfaces de
  composants données en toutes lettres. ✓
- **Cohérence types** : `uiMode`/`diagnostic` (Task 1) consommés Task 3/5/7 ; `ChipMultiSelect`
  props + `filterOptions` (Task 8) réutilisés Task 10/11 ; `RunPanel` props (Task 9) Task 10/11 ;
  `asView`/`asPanel` cohérents. ✓
- **Logique intacte** : aucun fichier moteur/économie/optimiseur modifié sauf exposer un plan
  (Task 12), donc suite 165 reste verte. ✓

## NOT in this plan
Fret inter-îles, multi-bien par île de prod, heights par île (backlog). Icônes : glyphes
actuels harmonisés (pas de webfont ajoutée pour éviter une dépendance/CSP).
