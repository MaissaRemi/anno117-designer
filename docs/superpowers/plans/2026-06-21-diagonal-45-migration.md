# 45° SP1 palier 2 — Half-tile (2×) grid migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]` checkboxes. **This plan is PREPARED but execution is gated on user validation of palier 1 (geometry).** Do not start until the user says "go palier 2".

**Goal:** Migrate the live app's grid resolution from 1 cell = 1 tile to **1 cell = ½ tile (2×)**, so 45° diamonds/roads (palier 1 geometry) become representable. Axis-aligned behavior is preserved *physically* (same island, same buildings) but every coordinate/size/range doubles. No diagonal placement yet (that is SP2).

**Architecture:** Introduce a single conversion at the DATA boundary (island/terrain load upscales ×2) and double every length constant in the engines (`def.size` consumed ×2 via `footprintSize`, street ranges ×2, comb steps already derive from sizes, water `MAX_RUN`/radii ×2). Persisted layouts bump to **v8**; a v7 save is upscaled ×2 on load. This is NOT behavior-preserving at the test level — exact-position snapshots/FP regenerate; behavioral thresholds (house counts, coverage %, ratios) must still hold because the *physical* layout is unchanged.

**Tech Stack:** TypeScript, Vitest, Vite, Canvas. ~12 files. Reference: spec `docs/superpowers/specs/2026-06-21-diagonal-45-foundation-design.md` §4.4–4.7.

**Risk:** highest of the whole 45° project — a resolution change ripples to data/persist/render/engines/tests at once. Mitigation = the 3 internal stages below, each fully verified (tsc+lint+tests) before the next; a STAGE-A FP capture taken first so STAGE-C can prove the *physical* layout is unchanged (same shape at 2× coords).

---

## Pre-flight (read before touching code)

- Current grid: `GridShape.w/h` in tiles; `usable/water/rivers: boolean[]` length `w*h`; `slots: {x,y}` tiles; `PlacedBuilding/RoadTile/FieldTile/AqueductTile {x,y}` tiles.
- `footprintSize(def,rot)` (palier 1) returns def.size units; **palier 2 changes its axis branch to ×2** (see Stage C) — this is the pivot that makes the whole app half-tile.
- Engines read ranges from `def.streetRange || def.radius?.range` (in tiles) and BFS on the grid → must ×2.
- Persist key is `anno117-designer:state:v7` (`src/persist/local.ts`).

- [ ] **Stage-0: capture the pre-migration physical fingerprint** (so Stage C can prove equivalence). Create `src/optimizer/_mig_fp.test.ts` printing `console.log("MIG_FP", ...)` of planLattice(medium_01,T4,0.8) + planPacked(100,100) — houses/fullyCovered/roads + a *normalized* building set (positions divided by current scale=1). Run, record the numbers (houses, fullyCovered, roads). Delete the test after recording. These are the **physical invariants** Stage C must reproduce (at 2× coords → divide by 2 to compare).

---

## STAGE A — Geometry pivot to half-tiles (footprintSize ×2)

> This is the keystone: once `footprintSize` axis branch returns ×2, every consumer (occ stamping, BFS, render) is in half-tiles. Do it first, then fix the fallout stage by stage.

**Files:** `src/engine/geometry.ts` · `src/engine/geometry.test.ts`

- [ ] **Step 1: Update the axis branch of `footprintSize` to ×2 (half-tiles).**

```ts
export function footprintSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  const w = def.size.w * 2, h = def.size.h * 2; // tuiles -> demi-tuiles
  if (isDiagonal(rot)) {
    const side = Math.ceil((w + h) / Math.SQRT2); // bbox du diamant en demi-tuiles
    return { w: side, h: side };
  }
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}
```

- [ ] **Step 2: Update the diagonal branch of `footprintCells`** — half-widths are now `def.size.w*1`... NO: with the rectangle now `2w × 2h` HT, half-widths are `def.size.w` and `def.size.h` HT *only if* we keep `a=def.size.w`. Re-derive: rectangle full = `2*def.size.w` HT → half = `def.size.w` HT. So `a = def.size.w, b = def.size.h` STILL hold (they are half-widths in HT). The diagonal branch is UNCHANGED — only `side` grew (via footprintSize). Verify the 1×1 diamond test still passes but now `side = ceil(4/√2)=3` (same) — actually for def 1×1: w=h=2 HT, side=ceil(4/√2)=3, a=b=1. Identical to palier 1. **So footprintCells diagonal needs NO change; only the axis tests change (×2).**

- [ ] **Step 3: Update geometry.test.ts axis expectations to ×2.** The Phase-1 axis tests assert tile-sized footprints; double them. Example: `footprintCells(def3x12, 5,7, 0).length` 36 → **144** (6×24 HT). `footprintSize(def, 0)` for 3×12 → `{w:6,h:24}`. Diagonal tests UNCHANGED (palier 1 numbers stand).

- [ ] **Step 4:** `npx vitest run src/engine/geometry.test.ts` → green. `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** `git commit -m "45deg palier 2A: footprintSize axis branch -> half-tiles (x2)"`

---

## STAGE B — Data + persistence + render migration

**Files:** `src/data/islands.ts` · `src/data/terrain.ts` · `src/model/factories.ts` · `src/state/store.ts` · `src/persist/local.ts` · `src/persist/serialize.ts` · `src/render/draw.ts` · `src/render/exportImage.ts`

- [ ] **B1 — islands upscale ×2 at load.** In `src/data/islands.ts`, `decodeMask(mask,w,h)` currently returns a `w*h` boolean array at 1×. Add `decodeMaskHT` (or upscale in `decodeMask`): produce a `(2w)*(2h)` array where `out[(2y+dy)*(2w)+(2x+dx)] = src[y*w+x]` for dy,dx∈{0,1}. Update `islandById`/consumers so an island of declared size `S` exposes a grid of `2S`. TEST: a 2×2 land mask upscales to a 4×4 all-true block (1 land tile → 4 HT cells).

```ts
export function upscale2x(mask: boolean[], w: number, h: number): boolean[] {
  const W = w * 2, out = new Array(W * h * 2).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = mask[y * w + x];
    out[(2 * y) * W + 2 * x] = v; out[(2 * y) * W + 2 * x + 1] = v;
    out[(2 * y + 1) * W + 2 * x] = v; out[(2 * y + 1) * W + 2 * x + 1] = v;
  }
  return out;
}
```

- [ ] **B2 — terrain ×2.** `src/data/terrain.ts`: `slotsOf` returns `{x:2*s.x, y:2*s.y}` (and round); `riversOf` upscales ×2 (reuse `upscale2x`); `heightsOf` upscales ×2 (each tile q → 2×2 block, `Int8Array` of `(2w)(2h)`). TEST: a slot at tile (10,5) → HT (20,10).

- [ ] **B3 — store/factories in HT.** `src/state/store.ts` `loadIsland`: build the grid from upscaled mask/water/rivers/slots (all ×2), `grid.w=2*isl.size.w` etc. `model/factories.ts`: `emptyLayout(40,40)` default stays a tile-count argument but produces a 2×-larger grid? DECISION: keep `emptyLayout(w,h)` meaning HALF-TILE dimensions (so callers pass already-doubled or small grids); audit the 3 call sites (`store` initial 40→ keep 40 HT = small; islands set explicit sizes). `resizeGridShape` unchanged (operates on whatever units). TopBar resize min/max ×2 (10..400).

- [ ] **B4 — persist v8 + migration.** `src/persist/local.ts`: `const KEY = "...:v8"`. On `loadState`, if the v8 key is absent, try the v7 key and **upscale ×2** (multiply grid.w/h, every building/road/field/aqueduct/slot x,y by 2; upscale usable/water/rivers via `upscale2x`), then return the migrated state and save under v8. `serialize.ts` round-trip unchanged. TEST: a v7 layout with a building at (5,7) loads as (10,14) on a doubled grid.

- [ ] **B5 — render ÷2.** `src/render/draw.ts`: the default `View.cell` represents a HALF-tile now → the island looks the same on screen only if the per-cell px halves. In `GridCanvas` the initial `View` (`cell:22`) → `11` (or compute from grid size). `src/render/exportImage.ts` `fitView` already derives cell from grid w/h, so it auto-adapts (grid is 2× bigger → cell auto-halves) — verify the fitView test still passes (it's unit-math, scale-agnostic).

- [ ] **B6:** after B1–B5, `npx tsc --noEmit` → 0; `npm run lint` → 0; `npx vitest run` — data/persist/render tests green; **engine tests will FAIL here** (ranges still 1× on a 2× grid) — that is expected, fixed in Stage C. Commit `45deg palier 2B: data/terrain/persist v8/render to half-tiles`.

---

## ×2 SITE INVENTORY (confirmé par grep — ~70 occurrences code, hors tests)

L'invasivité réelle : les moteurs lisent `def.size` ET les portées DIRECTEMENT (pas
seulement via footprintSize). Chaque site doit être classé : **TAILLE/PORTÉE (×2)** vs
**indice/comparaison neutre (inchangé)**. Comptage `.size./streetRange/radius.range/
rangeOf/DEFAULT_RANGE/MAX_RUN/...` :
- `packPlan.ts` (25) — `rangeOf` ×2 ; `rw=resDef.size.w`/`rh` ×2 ; `def.size.w/h` dans
  fitsBld/coverType/stamp/SAT ×2 ; STEPH/STEPV dérivent de rh (auto si rh ×2).
- `planLattice.ts` (15) — `rangeOf` ×2 ; `rw/rh` ×2 ; `effR` (via rangeOf) ; placeAt/
  stamp `def.size` ×2 ; densif `worst.range` (via rangeOf).
- `waterPlan.ts` (16) — `MAX_RUN` ×2, `MOUNTAIN_BLOCK_RADIUS`/zone ×2, `footprintOf`
  (footprintSize→×2 auto), consommations INCHANGÉES (unités, pas longueurs), `CLIMB_MARGIN_Q`
  INCHANGÉ (hauteurs, pas grille).
- `prodPlan.ts` (11) — `transporterRange ?? DEFAULT_RANGE` ×2 ; `def.size`/footprint mines/
  warehouses/freeArea ×2 ; `MOUNTAIN_ZONE` (via waterPlan const) ×2.
- `greedy.ts` (2), `score.ts` (1), `anneal.ts` (1) — `def.size`/area : ×2 (ou via footprint).
- `engine/rules.ts` — `streetCoverage` limit (def.streetRange) ×2 ; `computeRadiusCoverage`
  euclidien radius ×2.
- `economy/coverage.ts` — via computeRadiusCoverage (rules) — auto si rules ×2.
**Risque : un seul site neutre doublé par erreur (ou un site portée oublié) → layout
faux qui passe les seuils lâches.** D'où la garde Stage-0/C2 (293 maisons / 235 pleines)
qui DOIT retomber juste, sinon un ×2 est faux.

## STAGE C — Engine recalibration (ranges & constants ×2)

**Files:** `src/optimizer/streetGrid.ts` · `planLattice.ts` · `packPlan.ts` · `prodPlan.ts` · `waterPlan.ts` · `economy/coverage.ts` · `engine/rules.ts` · all affected `*.test.ts`

- [ ] **C1 — ranges ×2.** Everywhere a *tile* range feeds a half-tile BFS, double it. Central spots: `planLattice`/`packPlan` `rangeOf(d) = (d.streetRange||d.radius?.range||0)` → `* 2`; `prodPlan` `transporterRange ?? DEFAULT_RANGE` → `* 2`; `engine/rules.ts` `streetCoverage` `limit = def.streetRange` → `* 2` and `computeRadiusCoverage` euclidean radius → `* 2`; `waterPlan` `MAX_RUN` (140 tiles → 280 HT), `MOUNTAIN_BLOCK_RADIUS`/zone ×2, consumption table unchanged (amounts, not lengths). Comb steps (`STEPH=2*rh+1`) already derive from `rh` which is now ×2 via footprintSize — verify they scale automatically (they read `def.size`/footprint, so DOUBLE-CHECK they use footprintSize HT, not raw def.size).
- [ ] **C2 — recompute Stage-0 invariants.** Re-add a temp FP test; run planLattice/packPlan; the *physical* layout (positions ÷2, houses, fullyCovered, roads) must match Stage-0's recorded numbers within a small tolerance (rasterization at 2× can shift a few). Houses count should be ~equal; coverage % equal; ratio equal.
- [ ] **C3 — regenerate snapshots & thresholds.** `planLattice.test`/`packPlan.test` exact-position fingerprints (`@x,y,rot`) regenerate (coords ×2) — update them. Behavioral asserts (houses>50→ still >50, coverage>=90, ratio>=2.5/4) should hold; if a threshold breaks badly, a length constant was missed in C1 — find it. `waterPlan.test`/`waterFeasible.test` grids/ranges ×2. `optimizer.test`/`quality.test` grids ×2.
- [ ] **C4:** `npx tsc --noEmit` 0; `npm run lint` 0; `npx vitest run` ALL green; `npx vite build` green; preview smoke (load an island, run Plan d'île, confirm a sane layout at the new scale). Delete the temp FP test.
- [ ] **C5 — Commit** `45deg palier 2C: recalibrate engines/coverage/water to half-tile ranges; regenerate snapshots`.

---

## Self-review
- **Spec §4.4 coverage:** islands upscale (B1), terrain ×2 (B2), store/factories (B3), persist v8+migration (B4), render (B5), engine ranges/constants ×2 (C1). ✓
- **Placeholder scan:** the `upscale2x` + `footprintSize` code is concrete; the ×2 edits are enumerated by file/symbol. The only non-verbatim parts are the mechanical "×2 this constant" edits — each names the exact symbol. ✓
- **Risk gates:** Stage-0 FP capture + C2 equivalence check is the safety net proving the physical layout is unchanged. ✓
- **Type consistency:** `upscale2x(mask,w,h)` signature reused in B1/B2/B4. `footprintSize` HT pivot in Stage A is the single source of the resolution change. ✓

## NOT in this plan
SP2 (editor diagonal placement + wedge/diamond render), SP3 (8-adjacency coverage + diagonal road graph + √2 cost), SP4 (optimizer generates diagonals). Each separate spec+plan.

---

## ACTUAL IMPLEMENTATION (2026-06-22) — deviation from the ×2-engine plan

The plan above proposed making `footprintSize` axis branch ×2 globally and doubling
~70 engine sites (Stage C). **That approach was NOT used.** During execution two flaws
surfaced: (a) mechanically doubling `STEPH=2*rh+1` yields a **½-tile-wide road** → plans
un-buildable in-game; (b) `footprintCells`/`footprintSize` and `rules.ts` are consumed at
BOTH resolutions (live editor + tile-res optimizer & ~5 test suites), so a global ×2 breaks
every tile-res consumer and regenerates all snapshots.

**Implemented instead — scale-on-grid + optimizer boundary adapter (lower risk, buildable
output, snapshots intact):**
- **Geometry** carries a `scale` param (cells/tile, default 1). `GridShape.cellsPerTile`
  (2 = live ½-tile grid, absent/1 = tile/optimiseur). `gridScale(grid)` reads it.
  → commit `45deg palier 2A`.
- **Live layer** (`rules.ts`, `economy/coverage.ts`, `render/draw.ts`, editor) reads scale
  from the grid: footprints ×scale, ranges ×scale, field area ×scale². Half-tile data:
  `islands.upscale2x`, `loadIsland` builds a 2× grid (cellsPerTile=2), persist **v8** +
  v7→v8 ×2 migration. → commit `45deg palier 2B+2C`.
- **Optimizer stays at TILE resolution, untouched.** `islandPlanWorker` **downscales** the
  half-tile grid → tile, runs `planIsland` byte-identically (golden snapshots intact, roads
  stay 1 tile = buildable), then **upscales** the result ×2 (`halfTileAdapter`: buildings ×2,
  roads/fields/aqueducts → 2×2 block). The Stage-0/C2 physical invariant (293 houses) holds
  **by construction** — the engines see the exact same tile grid they always saw.
- **Render culling** added (4× cells) so large islands stay usable.

This honors the user's "grille 2× entière uniforme" (storage/render/editor are uniformly
half-tile) while avoiding the fragile engine ×2. SP2 (45° placement+diamond render), SP3
(8-adjacency road network on the live grid), SP4 (optimizer avoids locked diamonds) built
on top. Commits: `45deg palier 2A`, `2B+2C`, `SP2`, `SP3`, `SP4`.
