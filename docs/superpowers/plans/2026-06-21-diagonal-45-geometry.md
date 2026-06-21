# 45° Geometry Foundation (SP1, palier 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure geometry primitives for 8-direction (45°) construction on a half-tile grid, as an ADDITIVE change that breaks nothing (existing axis-aligned callers keep working).

**Architecture:** Extend `Rotation` to 8 values. Treat all grid coordinates as **half-tiles** (HT); `def.size` stays in tiles and is converted ×2 by the geometry. `footprintCells` returns axis-aligned rectangles for 0/90/180/270 (unchanged behavior, but now in HT once the grid migrates) and rasterizes a rotated-rectangle **diamond** for 45/135/225/315. Add `neighbors8` (8-adjacency) and tile↔HT helpers. Pure functions, hand-computable, fully unit-tested.

**Tech Stack:** TypeScript, Vitest. Files: `src/model/types.ts`, `src/engine/geometry.ts`, `src/engine/geometry.test.ts`.

**Scope note:** This palier is ADDITIVE — it does not yet change the live grid resolution (that is the 2× migration, palier 2, a separate plan). Existing code only ever passes rotations 0/90/180/270, so extending the type + adding the diagonal branch is backward-compatible. The new diagonal functions are exercised only by the new tests until SP2 wires placement.

**Reference:** spec `docs/superpowers/specs/2026-06-21-diagonal-45-foundation-design.md` §4.1–4.3, 4.7.

---

## Current state (read before starting)

`src/model/types.ts:3` — `export type Rotation = 0 | 90 | 180 | 270;`
`src/engine/geometry.ts` — `footprintSize(def, rot)` swaps w/h at 90/270; `footprintCells(def, x, y, rot)` builds an axis-aligned rect of `footprintSize` cells; `orthoNeighbors(x,y)` returns the 4 ortho neighbors; `Cell = {x,y}` from `model/types`.
`src/engine/geometry.test.ts` already exists (Phase 1) with footprint/rotation/grid tests — ADD to it, don't replace.

**Key convention this plan introduces:** geometry output is in **half-tiles**. A `def.size` of `{w:3,h:3}` tiles → a `6×6` HT axis-aligned footprint. Until the grid migrates (palier 2), the live app still calls these with tile-sized grids, so to stay additive **we keep the axis-aligned branch returning `def.size.w × def.size.h` cells (NOT ×2) for now** and gate the ×2 behind a later migration. The diagonal branch is the only NEW behavior and works in whatever unit the caller's grid uses. See Task 2 note.

> DECISION (locks the additive property): in THIS palier, `footprintSize`/`footprintCells` keep returning **tile-unit** sizes for axis rotations (unchanged), and the diagonal branch computes the diamond in the SAME unit as `def.size` (treating `def.size.w/h` as the half-extents directly). The ×2 half-tile reinterpretation happens in palier 2 by changing `def.size` consumption, not here. This keeps Task 2's axis tests identical to today.

---

## Task 1: Extend the Rotation type to 8 values

**Files:**
- Modify: `src/model/types.ts:3`
- Test: `src/engine/geometry.test.ts`

- [ ] **Step 1: Write the failing test** (append to `geometry.test.ts`)

```ts
import { footprintSize } from "./geometry";
// ... existing imports stay ...

describe("geometry 45° — rotations diagonales", () => {
  it("footprintSize accepte les 8 rotations (type)", () => {
    const def = makeBuildingDef({ id: "d", size: { w: 3, h: 12 } });
    // les 4 diagonales renvoient une bbox carrée (diamant)
    for (const rot of [45, 135, 225, 315] as const) {
      const s = footprintSize(def, rot);
      expect(s.w).toBe(s.h); // diamant = bbox carrée
      expect(s.w).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run src/engine/geometry.test.ts`
Expected: FAIL — `Type '45' is not assignable to parameter of type 'Rotation'` (tsc/vitest) OR the diagonal branch is missing.

- [ ] **Step 3: Extend the type**

In `src/model/types.ts:3`:
```ts
export type Rotation = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;
```

- [ ] **Step 4: Run `npx tsc --noEmit`** — expect 0 errors (additive union; existing code only emits 0/90/180/270). The test still fails on the missing diagonal branch — that's Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/model/types.ts src/engine/geometry.test.ts
git commit -m "45deg: extend Rotation type to 8 values + failing diagonal test"
```

---

## Task 2: footprintSize for diagonal rotations (diamond bbox)

**Files:**
- Modify: `src/engine/geometry.ts:4-7`
- Test: `src/engine/geometry.test.ts` (the Task 1 test now must pass for footprintSize)

- [ ] **Step 1: The failing test already exists** (Task 1, Step 1). Add an exact-value assertion:

```ts
  it("footprintSize diamant : côté = ceil((w+h)/√2) en unités def.size", () => {
    const def = makeBuildingDef({ id: "d", size: { w: 3, h: 3 } });
    // demi-largeurs a=b=3 ; bbox demi = (3+3)/√2 = 4.243 ; côté = ceil(2*4.243)=ceil(8.49)=9
    expect(footprintSize(def, 45)).toEqual({ w: 9, h: 9 });
    expect(footprintSize(def, 135)).toEqual({ w: 9, h: 9 });
  });
```

- [ ] **Step 2: Run, expect FAIL** (`footprintSize` returns `{w:3,h:3}` for rot 45 today).

Run: `npx vitest run src/engine/geometry.test.ts -t diamant`

- [ ] **Step 3: Implement** — replace `src/engine/geometry.ts:4-7` `footprintSize`:

```ts
const isDiagonal = (rot: Rotation): boolean => rot === 45 || rot === 135 || rot === 225 || rot === 315;

/** Dimensions effectives après rotation. Diagonale → bbox carrée du diamant. */
export function footprintSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  const { w, h } = def.size;
  if (isDiagonal(rot)) {
    // demi-largeurs (w,h) ; bbox d'un rectangle pivoté 45° : demi = (w+h)/√2 par axe
    const side = Math.ceil((2 * (w + h)) / Math.SQRT2);
    return { w: side, h: side };
  }
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/engine/geometry.test.ts`
Expected: PASS (diamant test) + all existing geometry tests still green (axis rotations unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/geometry.ts src/engine/geometry.test.ts
git commit -m "45deg: footprintSize returns diamond bbox for diagonal rotations"
```

---

## Task 3: footprintCells diamond rasterization

**Files:**
- Modify: `src/engine/geometry.ts:10-19` (`footprintCells`)
- Test: `src/engine/geometry.test.ts`

- [ ] **Step 1: Write the failing test** (hand-computed diamond for a 1×1 building)

```ts
  it("footprintCells diamant 1×1 : losange compact autour de l'ancre", () => {
    const def = makeBuildingDef({ id: "u", size: { w: 1, h: 1 } });
    // demi-largeurs a=b=1 ; côté bbox = ceil(2*2/√2)=ceil(2.83)=3 ; centre (x+1.5,y+1.5)
    // cellule bloquée ssi |lx|<=1 && |ly|<=1 (rotation inverse 45°). Cellules attendues
    // (bbox 3×3 à partir de (0,0)) : la croix centrale — (1,0),(0,1),(1,1),(2,1),(1,2).
    const cells = footprintCells(def, 0, 0, 45).map((c) => `${c.x},${c.y}`).sort();
    expect(cells).toEqual(["1,0", "0,1", "1,1", "2,1", "1,2"].sort());
  });

  it("footprintCells axis inchangé (régression)", () => {
    const def = makeBuildingDef({ id: "r", size: { w: 2, h: 3 } });
    expect(footprintCells(def, 5, 7, 0).length).toBe(6);
    expect(footprintCells(def, 5, 7, 90).length).toBe(6);
  });
```

- [ ] **Step 2: Run, expect FAIL** (no diagonal branch in `footprintCells`).

Run: `npx vitest run src/engine/geometry.test.ts -t diamant`

> If the hand-computed expected set in Step 1 turns out wrong when you implement Step 3, RUN the implementation, read the ACTUAL cells, verify them against a manual diamond drawing (centers within distance), and correct the EXPECTED to the manually-verified truth — do not just paste the code output blindly. The rule is `|lx|<=1 && |ly|<=1` after inverse 45° rotation.

- [ ] **Step 3: Implement** — replace `footprintCells` in `src/engine/geometry.ts`:

```ts
/** Liste des cases occupées par un bâtiment posé en (x,y). Diagonale → diamant rastérisé. */
export function footprintCells(def: BuildingDef, x: number, y: number, rot: Rotation): Cell[] {
  const cells: Cell[] = [];
  if (!isDiagonal(rot)) {
    const { w, h } = footprintSize(def, rot);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.push({ x: x + i, y: y + j });
    return cells;
  }
  // diagonale : rectangle (demi-largeurs a,b) pivoté de rot, rastérisé sur la bbox carrée.
  const side = footprintSize(def, rot).w;
  const a = def.size.w, b = def.size.h;
  const cx = x + side / 2, cy = y + side / 2; // centre du bâtiment
  const rad = (-rot * Math.PI) / 180; // rotation INVERSE pour passer en repère local
  const cos = Math.cos(rad), sin = Math.sin(rad);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const dxp = x + i + 0.5 - cx, dyp = y + j + 0.5 - cy; // centre de cellule - centre
    const lx = dxp * cos - dyp * sin, ly = dxp * sin + dyp * cos;
    if (Math.abs(lx) <= a && Math.abs(ly) <= b) cells.push({ x: x + i, y: y + j });
  }
  return cells;
}
```

- [ ] **Step 4: Run, expect PASS** (correct the expected set per the Step 2 note if needed)

Run: `npx vitest run src/engine/geometry.test.ts`
Expected: PASS (diamant 1×1 + axis regression) and all prior geometry tests green.

- [ ] **Step 5: Add a 2×2 and 3×3 sanity assertion** (area roughly preserved)

```ts
  it("footprintCells diamant : aire ~ préservée (area = w*h ± marge rastérisation)", () => {
    for (const [w, h] of [[2, 2], [3, 3], [2, 4]] as const) {
      const def = makeBuildingDef({ id: `s${w}${h}`, size: { w, h } });
      const n = footprintCells(def, 0, 0, 45).length;
      const area = (2 * w) * (2 * h); // aire axis en "unités²" (a,b sont des demi-largeurs → full 2w×2h)
      expect(n).toBeGreaterThanOrEqual(Math.floor(area * 0.5));
      expect(n).toBeLessThanOrEqual(Math.ceil(area * 1.6));
    }
  });
```

Run: `npx vitest run src/engine/geometry.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geometry.ts src/engine/geometry.test.ts
git commit -m "45deg: footprintCells rasterizes the rotated-rectangle diamond"
```

---

## Task 4: neighbors8 + tile↔half-tile helpers

**Files:**
- Modify: `src/engine/geometry.ts` (append exports)
- Test: `src/engine/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { neighbors8, tileToHT, htToTile } from "./geometry";

describe("geometry 45° — 8-adjacence + conversions", () => {
  it("neighbors8 renvoie 4 ortho + 4 diagonaux", () => {
    const n = neighbors8(5, 5).map((c) => `${c.x},${c.y}`).sort();
    expect(n).toEqual(["4,4", "4,5", "4,6", "5,4", "5,6", "6,4", "6,5", "6,6"].sort());
  });
  it("tileToHT / htToTile", () => {
    expect(tileToHT(3)).toBe(6);
    expect(htToTile(6)).toBe(3);
    expect(htToTile(7)).toBe(3); // floor
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`neighbors8`/`tileToHT`/`htToTile` not exported).

Run: `npx vitest run src/engine/geometry.test.ts -t 8-adjacence`

- [ ] **Step 3: Implement** — append to `src/engine/geometry.ts`:

```ts
/** Voisins 8-connexité (4 ortho + 4 diagonaux) — connexion au coin du jeu 45°. */
export function neighbors8(x: number, y: number): Cell[] {
  return [
    { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
    { x: x + 1, y: y + 1 }, { x: x + 1, y: y - 1 }, { x: x - 1, y: y + 1 }, { x: x - 1, y: y - 1 },
  ];
}

/** 1 tuile-jeu = 2 unités-grille (½-tuile). Conversions de coordonnées. */
export const tileToHT = (n: number): number => n * 2;
export const htToTile = (n: number): number => Math.floor(n / 2);
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/engine/geometry.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/geometry.ts src/engine/geometry.test.ts
git commit -m "45deg: add neighbors8 (8-adjacency) + tile<->half-tile helpers"
```

---

## Task 5: Final verification + doc header

**Files:**
- Modify: `src/engine/geometry.ts` (top-of-file convention comment)

- [ ] **Step 1: Add the convention comment** at the very top of `src/engine/geometry.ts`:

```ts
// Primitives géométriques. CONVENTION 45° (cf. specs/2026-06-21-diagonal-45-foundation) :
//  - les rotations diagonales (45/135/225/315) rastérisent un rectangle pivoté en DIAMANT ;
//  - à terme la grille est en ½-tuiles (1 tuile = 2 unités, tileToHT/htToTile) — la
//    réinterprétation ×2 de def.size arrive en palier 2 (migration). Ici, additif : les
//    rotations axis restent en unités def.size (comportement inchangé).
```

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npm run lint` → 0 problems.
Run: `npx vitest run` → all tests green (124 + the new diagonal tests).

- [ ] **Step 3: Commit**

```bash
git add src/engine/geometry.ts
git commit -m "45deg: document half-tile/diamond convention in geometry"
```

---

## Self-review (done while writing)

- **Spec coverage (§4.2/4.3/4.7):** Rotation 8 values → Task 1. footprintSize diagonal → Task 2. footprintCells diamond → Task 3. neighbors8 + conversions → Task 4. Hand-computed diamond tests → Task 3 Step 1. ✓ (Migration §4.4 and engine recalibration §4.6 palier 2-3 are OUT of this plan by design — separate plan.)
- **Placeholder scan:** none — every step has real code/commands.
- **Type consistency:** `isDiagonal` defined in Task 2, reused in Task 3. `footprintSize().w` used as `side` in Task 3. `tileToHT/htToTile` names consistent across Task 4 + comment. `Cell` is the existing type. ✓
- **Additive guarantee:** axis branches untouched in unit; existing tests must stay green at each Task's Step 4 — explicit verification. ✓

## What this plan deliberately does NOT do (next plans)
- Palier 2 (2× migration: islands/terrain upscale, factories/store, render, persist v8) — separate plan once this lands.
- Palier 3 (engine recalibration ×2) — separate plan.
- SP2 editor placement, SP3 coverage, SP4 optimizer — separate specs+plans.
