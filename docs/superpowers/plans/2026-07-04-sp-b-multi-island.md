# SP-B — Mode multi-îles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (ou subagent-driven-development). Steps use `- [ ]` checkboxes.

**Goal:** Un mode multi-îles (onglet dédié) qui, à partir d'un ensemble d'îles + leurs ressources, assigne les rôles (population/production) et dimensionne (ou place) — en RÉUTILISANT le planner mono-île, `resources.ts` et les composants UI de SP-A (zéro duplication).

**Architecture:** `multiIslandPlan` (pur) appelle `planIsland` comme sous-routine + `resources.canProduce` comme gate. Un worker l'exécute. `MultiIslandPanel` (nouvel onglet) réutilise `IslandPicker`, `ResourceSelector`, le store slice party (SP-A). `buildIslandGrid` extrait de `store.loadIsland` (réutilisé éditeur + multi-îles).

**Tech Stack:** TypeScript, Vitest, React, Zustand, Web Worker. Réf : spec §4.1, §6. SP-A DÉJÀ FAIT (resources.ts, party store, ResourceSelector).

---

## File structure
- Create `src/data/islandGrid.ts` — `buildIslandGrid(islandId): GridShape` (extrait de loadIsland).
- Modify `src/state/store.ts` — `loadIsland` réutilise `buildIslandGrid`.
- Create `src/optimizer/multiIslandPlan.ts` + `.test.ts` — méta-optimiseur pur.
- Create `src/optimizer/runMultiIslandPlan.ts` — lanceur worker (pattern `runIslandPlan`).
- Create `src/optimizer/multiIslandPlanWorker.ts` — shim worker (pattern `islandPlanWorker`).
- Create `src/ui/MultiIslandPanel.tsx` — la vue onglet.
- Create `src/ui/EditorView.tsx` — JSX éditeur extrait d'`App.tsx`.
- Modify `src/App.tsx` — bascule d'onglets `Éditeur | Multi-îles`.

---

## Task 1 : extraire `buildIslandGrid` (réutilisable, anti-duplication)

**Files:** Create `src/data/islandGrid.ts` · Modify `src/state/store.ts` · Test `src/data/islandGrid.test.ts`

- [ ] **Step 1: test qui échoue**
```ts
// src/data/islandGrid.test.ts
import { describe, expect, it } from "vitest";
import { buildIslandGrid } from "./islandGrid";
import { islandById } from "./islands";

describe("buildIslandGrid", () => {
  it("produit une grille ½-tuile (cellsPerTile=2) aux dims 2× de l'île", () => {
    const anyId = "roman_island_small_01";
    const isl = islandById(anyId)!;
    const g = buildIslandGrid(anyId)!;
    expect(g.cellsPerTile).toBe(2);
    expect(g.w).toBe(isl.size.w * 2);
    expect(g.h).toBe(isl.size.h * 2);
    expect(g.islandId).toBe(anyId);
    expect(g.usable.length).toBe(g.w * g.h);
  });
  it("île inconnue → undefined", () => {
    expect(buildIslandGrid("nope")).toBeUndefined();
  });
});
```
- [ ] **Step 2: run → échec** — `npx vitest run src/data/islandGrid.test.ts` → FAIL (module absent).
- [ ] **Step 3: implémenter** — déplacer la construction de grille de `store.loadIsland` :
```ts
// src/data/islandGrid.ts
import type { GridShape } from "../model/types";
import { decodeMask, islandById, upscale2x } from "./islands";
import { riversOf, slotsOf } from "./terrain";

/** Construit la grille VIVANTE ½-tuile (cellsPerTile=2) d'une île. Pur, réutilisable
 *  (éditeur ET multi-îles). undefined si l'île est inconnue. */
export function buildIslandGrid(id: string): GridShape | undefined {
  const isl = islandById(id);
  if (!isl) return undefined;
  const tw = isl.size.w, th = isl.size.h;
  const usableT = decodeMask(isl.mask, tw, th);
  const riversT = riversOf(id, tw, th);
  if (riversT) for (let i = 0; i < riversT.length; i++) if (riversT[i]) usableT[i] = false;
  const usable = upscale2x(usableT, tw, th);
  const water = usable.map((land) => !land);
  const rivers = riversT ? upscale2x(riversT, tw, th) : undefined;
  const slots = slotsOf(id).map((s) => ({ type: s.type, x: Math.round(s.x) * 2, y: Math.round(s.y) * 2 }));
  return { w: tw * 2, h: th * 2, usable, water, rivers, slots: slots.length ? slots : undefined, islandId: id, cellsPerTile: 2 };
}
```
Puis dans `store.loadIsland`, remplacer tout le corps de construction par :
```ts
    loadIsland: (id) => {
      const grid = buildIslandGrid(id);
      if (!grid) return;
      set({ layout: { grid, buildings: [], fields: [], roads: [] }, past: [], future: [], selectedUid: null });
      persist();
    },
```
et importer `buildIslandGrid` (retirer les imports devenus inutiles : `decodeMask`, `upscale2x`, `riversOf`, `slotsOf`, `islandById` si plus utilisés ailleurs dans store — vérifier avec tsc).
- [ ] **Step 4: run → succès** — `npx vitest run src/data/islandGrid.test.ts` PASS ; `npx tsc --noEmit` 0 ; `npx vitest run` tout vert (loadIsland inchangé fonctionnellement).
- [ ] **Step 5: commit** — `git commit -m "SP-B: extract buildIslandGrid (reused by editor + multi-island)"`

---

## Task 2 : `multiIslandPlan` — méta-optimiseur (pur)

**Files:** Create `src/optimizer/multiIslandPlan.ts` + `.test.ts`

Algorithme v1 (glouton, contrainte de producibilité ; PAS de tonnage — la capacité fine est validée en mode `place`) :
1. `region(id)` = celtic/roman. Pour chaque île non épinglée `production`/`unused` : `planIslandImport` → `{ residents, demand: importGoods }`.
2. Panier agrégé `basket: good -> perMin` sur ces îles.
3. Pour chaque `good` du panier (perMin desc) : candidats = îles où `canProduce(good, profile, region)` ET non épinglées `population`/`unused`. Aucune → `gaps` (« bien non produisible dans la partie → import externe »). Sinon choisir (épinglé `production` d'abord, sinon plus PETITE aire terre) → cette île devient `production`, `good` ajouté à ses `producedGoods`.
4. Rôles finaux : îles avec `producedGoods` → `production` ; épinglages prioritaires ; candidates-pop restantes avec `residents>0` → `population`, sinon `unused`.
5. Si `mode==='place'` : `planIslandProduction` pour le bien PRIMAIRE (plus forte demande) de chaque île prod → attache `plan`. Les îles pop ont déjà leur `IslandPlanResult`.
6. `totalPopulation` = Σ `residents` des îles pop finales. `balance` = par bien du panier `{good, demand, covered}`.

- [ ] **Step 1: test qui échoue**
```ts
// src/optimizer/multiIslandPlan.test.ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import { makeGrid } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { economy } from "../economy/economy";
import { chainFertilities } from "../economy/economy";
import { multiIslandPlan } from "./multiIslandPlan";

const catalog = rawCatalog as unknown as BuildingDef[];
const tier = economy.tiers.filter((t) => t.residenceId).slice(-1)[0].guid;
const grid = () => makeGrid(60, 60); // grille tuile pleine (multiIslandPlan reçoit des grilles quelconques)

describe("multiIslandPlan", () => {
  it("assigne des rôles, respecte les épinglages, renvoie une population totale", () => {
    const r = multiIslandPlan({
      catalog, tierGuid: tier, mode: "dimension",
      islands: [
        { islandId: "roman_a", grid: grid(), profile: { fertilities: [], mountainSlots: 0 } },
        { islandId: "roman_b", grid: grid(), profile: { fertilities: Object.keys(economy.fertilities), mountainSlots: 5 }, pinnedRole: "production" },
      ],
    });
    expect(r.assignments.length).toBe(2);
    // l'île épinglée production reste production
    expect(r.assignments.find((a) => a.islandId === "roman_b")!.role).toBe("production");
    expect(r.totalPopulation).toBeGreaterThanOrEqual(0);
  });

  it("contrainte ressource : un bien à fertilité n'est jamais assigné à une île sans cette fertilité", () => {
    const gated = Object.keys(economy.producers).find((g) => chainFertilities(g).size > 0)!;
    const r = multiIslandPlan({
      catalog, tierGuid: tier, mode: "dimension",
      islands: [
        { islandId: "pop", grid: grid(), profile: { fertilities: [], mountainSlots: 0 }, pinnedRole: "population" },
        { islandId: "poor", grid: grid(), profile: { fertilities: [], mountainSlots: 0 } }, // aucune fertilité
      ],
    });
    // 'poor' ne peut produire aucun bien à fertilité → aucun bien-à-fertilité dans ses producedGoods
    const poor = r.assignments.find((a) => a.islandId === "poor")!;
    for (const g of poor.producedGoods ?? []) expect(chainFertilities(g).size).toBe(0);
  });
});
```
- [ ] **Step 2: run → échec.**
- [ ] **Step 3: implémenter** `src/optimizer/multiIslandPlan.ts` :
```ts
import type { BuildingDef, GridShape } from "../model/types";
import type { ResourceProfile } from "../economy/resources";
import { canProduce } from "../economy/resources";
import { makeLookup } from "../engine/rules";
import { planIslandImport, type ImportGood, type IslandPlanResult } from "./islandPlan";
import { planIslandProduction, type ProdPlanResult } from "./prodPlan";

export type Role = "population" | "production" | "unused";

export interface IslandInput {
  islandId: string; grid: GridShape; profile: ResourceProfile; pinnedRole?: Role;
}
export interface MultiIslandRequest {
  catalog: BuildingDef[]; islands: IslandInput[]; tierGuid: string;
  needMode?: "all" | "thresholds"; mode: "dimension" | "place";
}
export interface Assignment {
  islandId: string; role: Role;
  residents?: number; importGoods?: ImportGood[];
  producedGoods?: string[];
  plan?: IslandPlanResult | ProdPlanResult;
}
export interface MultiIslandResult {
  assignments: Assignment[];
  balance: { good: string; demand: number; covered: boolean }[];
  totalPopulation: number; gaps: string[];
}

const regionOf = (id: string) => (id.includes("celtic") ? "Celtic" : "Roman");
const landOf = (g: GridShape) => { let n = 0; for (const u of g.usable) if (u) n++; return n; };

export function multiIslandPlan(req: MultiIslandRequest): MultiIslandResult {
  const gaps: string[] = [];
  const role: Record<string, Role> = {};
  const producedGoods: Record<string, string[]> = {};
  const popResult: Record<string, IslandPlanResult> = {};
  const prodPrimaryPlan: Record<string, ProdPlanResult> = {};

  // 1. analyse pop (îles non épinglées prod/unused)
  const popCandidates = req.islands.filter((i) => i.pinnedRole !== "production" && i.pinnedRole !== "unused");
  for (const isl of popCandidates) {
    popResult[isl.islandId] = planIslandImport({
      catalog: req.catalog, grid: isl.grid, tierGuid: req.tierGuid, needMode: req.needMode,
    });
  }
  // 2. panier de demande agrégé
  const basket: Record<string, number> = {};
  for (const isl of popCandidates) for (const g of popResult[isl.islandId].importGoods) basket[g.good] = (basket[g.good] || 0) + g.perMin;

  // 3. assigner chaque bien du panier à une île productrice (contrainte ressource)
  const goodsDesc = Object.keys(basket).sort((a, b) => basket[b] - basket[a]);
  for (const good of goodsDesc) {
    const candidates = req.islands.filter(
      (i) => i.pinnedRole !== "population" && i.pinnedRole !== "unused" && canProduce(good, i.profile, regionOf(i.islandId)),
    );
    if (!candidates.length) { gaps.push(`${good} : non produisible dans la partie → import externe`); continue; }
    candidates.sort((a, b) =>
      (b.pinnedRole === "production" ? 1 : 0) - (a.pinnedRole === "production" ? 1 : 0)
      || landOf(a.grid) - landOf(b.grid));
    const pick = candidates[0].islandId;
    (producedGoods[pick] ||= []).push(good);
    role[pick] = "production";
  }
  // 4. rôles finaux
  for (const isl of req.islands) {
    const id = isl.islandId;
    if (isl.pinnedRole) role[id] = isl.pinnedRole;
    else if (role[id] === "production") { /* gardé */ }
    else role[id] = (popResult[id]?.residents ?? 0) > 0 ? "population" : "unused";
  }
  // 5. placement optionnel (bien primaire par île prod)
  if (req.mode === "place") {
    for (const isl of req.islands) {
      if (role[isl.islandId] !== "production") continue;
      const goods = producedGoods[isl.islandId];
      if (!goods?.length) continue;
      const primary = goods[0];
      prodPrimaryPlan[isl.islandId] = planIslandProduction(
        req.catalog, isl.grid, makeLookup(req.catalog), primary, basket[primary] || 10,
        { islandFertilities: isl.profile.fertilities },
      );
    }
  }
  // 6. sortie
  const assignments: Assignment[] = req.islands.map((isl) => {
    const id = isl.islandId, r = role[id];
    return {
      islandId: id, role: r,
      residents: r === "population" ? popResult[id]?.residents : undefined,
      importGoods: r === "population" ? popResult[id]?.importGoods : undefined,
      producedGoods: r === "production" ? (producedGoods[id] ?? []) : undefined,
      plan: r === "population" ? popResult[id] : prodPrimaryPlan[id],
    };
  });
  const totalPopulation = assignments.filter((a) => a.role === "population").reduce((s, a) => s + (a.residents ?? 0), 0);
  const covered = new Set(Object.keys(producedGoods).flatMap((k) => producedGoods[k]));
  const balance = goodsDesc.map((good) => ({ good, demand: basket[good], covered: covered.has(good) }));
  return { assignments, balance, totalPopulation, gaps };
}
```
- [ ] **Step 4: run → succès** — `npx vitest run src/optimizer/multiIslandPlan.test.ts` PASS ; `npx tsc --noEmit` 0.
- [ ] **Step 5: commit** — `git commit -m "SP-B: pure multiIslandPlan meta-optimizer (role assignment, resource-gated)"`

---

## Task 3 : worker + lanceur

**Files:** Create `src/optimizer/multiIslandPlanWorker.ts` · Create `src/optimizer/runMultiIslandPlan.ts`

Suivre exactement le pattern de `islandPlanWorker.ts` / `runIslandPlan.ts`.

- [ ] **Step 1: worker**
```ts
// src/optimizer/multiIslandPlanWorker.ts
import { multiIslandPlan, type MultiIslandRequest, type MultiIslandResult } from "./multiIslandPlan";

export type MultiMsg = { type: "done"; result: MultiIslandResult } | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<MultiIslandRequest>) => {
  const post = (m: MultiMsg) => (self as unknown as Worker).postMessage(m);
  try { post({ type: "done", result: multiIslandPlan(e.data) }); }
  catch (err) { post({ type: "error", message: (err as Error).message }); }
};
export {};
```
- [ ] **Step 2: lanceur**
```ts
// src/optimizer/runMultiIslandPlan.ts
import type { MultiIslandRequest, MultiIslandResult } from "./multiIslandPlan";
import type { MultiMsg } from "./multiIslandPlanWorker";

export function runMultiIslandPlan(req: MultiIslandRequest): { promise: Promise<MultiIslandResult>; cancel: () => void } {
  const worker = new Worker(new URL("./multiIslandPlanWorker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<MultiIslandResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<MultiMsg>) => {
      const m = e.data;
      if (m.type === "error") reject(new Error(m.message)); else resolve(m.result);
      worker.terminate();
    };
    worker.onerror = (e) => { reject(new Error(e.message || "Erreur multi-îles")); worker.terminate(); };
    worker.postMessage(req);
  });
  return { promise, cancel: () => worker.terminate() };
}
```
- [ ] **Step 3: vérifier** — `npx tsc --noEmit` 0.
- [ ] **Step 4: commit** — `git commit -m "SP-B: multi-island worker + launcher"`

---

## Task 4 : bascule d'onglets (extraire `EditorView`, ne rien casser)

**Files:** Create `src/ui/EditorView.tsx` · Modify `src/App.tsx`

- [ ] **Step 1: extraire** le JSX éditeur d'`App.tsx` dans `EditorView` (déplacement pur, aucune logique changée) :
```tsx
// src/ui/EditorView.tsx
import { Catalog } from "./Catalog";
import { GridCanvas } from "./GridCanvas";
import { SidePanel } from "./SidePanel";
import { Toolbar } from "./Toolbar";

export function EditorView() {
  return (
    <>
      <Toolbar />
      <div className="main">
        <aside className="left"><Catalog /></aside>
        <GridCanvas />
        <aside className="right"><SidePanel /></aside>
      </div>
    </>
  );
}
```
- [ ] **Step 2: onglets dans `App.tsx`** — garder le `useEffect` clavier ; ajouter un état d'onglet local + un bandeau d'onglets ; rendre `EditorView` ou `MultiIslandPanel` :
```tsx
import { useEffect, useState } from "react";
import { TopBar } from "./ui/TopBar";
import { EditorView } from "./ui/EditorView";
import { MultiIslandPanel } from "./ui/MultiIslandPanel";
import { useStore } from "./state/store";

export default function App() {
  const [tab, setTab] = useState<"editor" | "multi">("editor");
  useEffect(() => { /* … garder le handler clavier existant à l'identique … */ }, []);
  return (
    <div className="app">
      <TopBar />
      <div className="tabs">
        <button className={tab === "editor" ? "active" : ""} onClick={() => setTab("editor")}>🗺 Éditeur</button>
        <button className={tab === "multi" ? "active" : ""} onClick={() => setTab("multi")}>🏝🏝 Multi-îles</button>
      </div>
      {tab === "editor" ? <EditorView /> : <MultiIslandPanel />}
    </div>
  );
}
```
(NB : conserver le corps exact du `useEffect` clavier actuel — ne pas le réécrire.)
- [ ] **Step 3: build** — `npx tsc --noEmit && npx vite build` (MultiIslandPanel encore vide temporairement → créer un stub `export function MultiIslandPanel(){ return <div className="multi-island" />; }` d'abord pour compiler).
- [ ] **Step 4: commit** — `git commit -m "SP-B: tab shell (EditorView extracted, Multi-island tab)"`

---

## Task 5 : `MultiIslandPanel` (la vue)

**Files:** Create `src/ui/MultiIslandPanel.tsx` (remplace le stub)

Réutilise : store slice party (`partyIslands`, `islandProfiles`, actions), `ResourceSelector`, `buildIslandGrid`, `runMultiIslandPlan`, `islands` (catalogue).

- [ ] **Step 1: implémenter** — sections : (a) ajout d'îles à la partie (liste des `islands`, bouton +), (b) par île de la partie : nom + `ResourceSelector` (lié à `islandProfiles[id]` via `setIslandProfile`) + sélecteur de rôle épinglé (auto/pop/prod/unused), (c) tier-cible + boutons `Dimensionner`/`Placer tout`, (d) résultat : tableau par île (rôle, population/biens), bilan `balance`, `gaps`.
```tsx
// src/ui/MultiIslandPanel.tsx
import { useMemo, useState } from "react";
import { islands } from "../data/islands";
import { buildIslandGrid } from "../data/islandGrid";
import { useStore } from "../state/store";
import { tiers } from "../economy/economy";
import { ResourceSelector } from "./ResourceSelector";
import { runMultiIslandPlan } from "../optimizer/runMultiIslandPlan";
import type { MultiIslandResult, Role } from "../optimizer/multiIslandPlan";
import { emptyProfile } from "../economy/resources";

const targetTiers = tiers.filter((t) => t.residenceId);

export function MultiIslandPanel() {
  const catalog = useStore((s) => s.catalog);
  const partyIslands = useStore((s) => s.partyIslands);
  const islandProfiles = useStore((s) => s.islandProfiles);
  const addPartyIsland = useStore((s) => s.addPartyIsland);
  const removePartyIsland = useStore((s) => s.removePartyIsland);
  const setIslandProfile = useStore((s) => s.setIslandProfile);
  const [tierGuid, setTierGuid] = useState(targetTiers.at(-1)?.guid ?? "");
  const [pins, setPins] = useState<Record<string, Role | "auto">>({});
  const [result, setResult] = useState<MultiIslandResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(() => islands.filter((i) => !partyIslands.includes(i.id)), [partyIslands]);
  const nameOf = (id: string) => islands.find((i) => i.id === id)?.name ?? id;

  const run = (mode: "dimension" | "place") => {
    setRunning(true); setError(null); setResult(null);
    const req = {
      catalog, tierGuid, mode,
      islands: partyIslands.map((id) => ({
        islandId: id, grid: buildIslandGrid(id)!, profile: islandProfiles[id] ?? emptyProfile(),
        ...(pins[id] && pins[id] !== "auto" ? { pinnedRole: pins[id] as Role } : {}),
      })).filter((i) => i.grid),
    };
    runMultiIslandPlan(req).promise
      .then(setResult).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRunning(false));
  };

  return (
    <div className="multi-island" style={{ padding: 16, overflow: "auto" }}>
      <h3>🏝🏝 Multi-îles</h3>
      <div className="row">
        <label>Ajouter une île
          <select value="" onChange={(e) => e.target.value && addPartyIsland(e.target.value)}>
            <option value="">— choisir —</option>
            {available.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label>Tier-cible
          <select value={tierGuid} onChange={(e) => setTierGuid(e.target.value)}>
            {targetTiers.map((t) => <option key={t.guid} value={t.guid}>{t.name}</option>)}
          </select>
        </label>
      </div>

      {partyIslands.map((id) => (
        <div key={id} className="island-card" style={{ border: "1px solid var(--border,#333)", borderRadius: 8, padding: 8, margin: "8px 0" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{nameOf(id)}</b>
            <span>
              <select value={pins[id] ?? "auto"} onChange={(e) => setPins((p) => ({ ...p, [id]: e.target.value as Role | "auto" }))}>
                <option value="auto">rôle auto</option>
                <option value="population">forcer population</option>
                <option value="production">forcer production</option>
                <option value="unused">exclure</option>
              </select>
              <button onClick={() => removePartyIsland(id)}>✕</button>
            </span>
          </div>
          <ResourceSelector value={islandProfiles[id] ?? emptyProfile()} onChange={(pr) => setIslandProfile(id, pr)} />
        </div>
      ))}

      <div className="modal-actions">
        <button onClick={() => run("dimension")} disabled={running || !partyIslands.length}>Dimensionner</button>
        <button className="primary" onClick={() => run("place")} disabled={running || !partyIslands.length}>Placer tout</button>
      </div>

      {running && <div className="opt-progress">Calcul multi-îles…</div>}
      {error && <div className="warn">⚠ {error}</div>}
      {result && (
        <div className="opt-result">
          <b>Population totale : {result.totalPopulation.toLocaleString("fr")}</b>
          <table>
            <thead><tr><th>Île</th><th>Rôle</th><th>Détail</th></tr></thead>
            <tbody>
              {result.assignments.map((a) => (
                <tr key={a.islandId}>
                  <td>{nameOf(a.islandId)}</td><td>{a.role}</td>
                  <td>{a.role === "population" ? `${a.residents ?? 0} hab.` : (a.producedGoods ?? []).length + " bien(s)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.gaps.length > 0 && <div className="warn">⚠ {result.gaps.join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}
```
- [ ] **Step 2: build** — `npx tsc --noEmit && npm run lint && npx vite build` verts.
- [ ] **Step 3: smoke navigateur** — onglet Multi-îles : ajouter 2 îles, cocher des ressources, `Dimensionner` → tableau de rôles + population ; les ressources persistent au reload. Console propre.
- [ ] **Step 4: commit** — `git commit -m "SP-B: MultiIslandPanel (party mgmt + roles + dimension/place, reuses SP-A)"`

---

## Self-review
- **Spec §6.1 algo** : Task 2 (assignation gloutonne contrainte-ressource, épinglages, place optionnel). ✓
- **§6.2 UI** : Task 5 (party via store, `ResourceSelector` réutilisé, `Dimensionner`/`Placer tout`, tableau+bilan+gaps). ✓
- **§4 réutilisation** : `planIsland`/`planIslandProduction` appelés (Task 2), `resources.canProduce` gate, `ResourceSelector`+`buildIslandGrid` partagés — zéro duplication de placement/producibilité. ✓
- **Placeholders** : code réel partout (le corps du `useEffect` clavier d'App est « conserver l'existant » = pas de réécriture, référence explicite). ✓
- **Types cohérents** : `MultiIslandRequest`/`Assignment`/`Role` définis Task 2, consommés Task 3/5 à l'identique. `IslandInput.grid` = `GridShape` de `buildIslandGrid`. ✓
- **YAGNI** : pas de fret, pas de drill-down rendu (v1 = tableau ; le rendu par île reste l'éditeur mono-île). Le drill-down « voir layout » est repoussé (non bloquant).

## NOT in this plan (post-v1, motivé)
Drill-down rendu par île dans l'onglet, fret inter-îles, multi-bien optimal par île de prod (v1 = 1 layout primaire), heights par île dans le worker (v1 = undefined → eau approximative au niveau parti).
