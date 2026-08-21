# Panier de blueprints — plan d'implémentation (phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre `src/prodlayout/` capable de planifier un **panier libre** de bâtiments — le plus petit plan entièrement fonctionnel, avec une sortie de route sur le bord choisi, dans une boîte automatique, imposée, ou de forme imposée.

**Architecture:** Le module est étendu, pas dupliqué : `frontiere.test.ts` couvre `./*.ts` par glob, donc tout nouveau fichier hérite de l'interdiction d'importer le moteur d'île et de l'interdiction d'aléa. `planProductionLayout` devient un appel de `planFromBasket` — un seul chemin de placement. L'objectif du placeur bascule de « efficace » à « servi, puis petit ».

**Tech Stack:** TypeScript strict, Vitest, aucune dépendance nouvelle. Boucle de dev : `pnpm test:fast` (21 s).

**Spec:** `docs/superpowers/specs/2026-08-22-panier-de-blueprints-design.md`

---

## Structure des fichiers

| fichier | responsabilité | état |
|---|---|---|
| `src/prodlayout/frac.ts` | arithmétique rationnelle | + `subF` |
| `src/prodlayout/occupancy.ts` | grille d'occupation | + `BLOCKED`, masque, `usableArea` |
| `src/prodlayout/basket.ts` | panier normalisé + bilan des biens | **créer** |
| `src/prodlayout/complete.ts` | point fixe « compléter le panier » | **créer** |
| `src/prodlayout/roads.ts` | squelette + distance-rue | branches intérieures, axe |
| `src/prodlayout/exit.ts` | sortie de route garantie | **créer** |
| `src/prodlayout/unmet.ts` | types du refus chiffré | **créer** |
| `src/prodlayout/pack.ts` | poser dans UNE boîte donnée | `served`/`unmet`, plus de recherche |
| `src/prodlayout/search.ts` | choisir la boîte (3 modes) + descente | **créer** |
| `src/prodlayout/index.ts` | portes du module | + `planFromBasket` |

**Référence mesurée à ne pas dégrader** (relevée avant tout changement) :

```
pain ×1 : 18×18 = 324 cases | bât 92  champs 140 routes 69 | bords N3 S3 O18 E18
pain ×2 : 23×23 = 529 cases | bât 124 champs 280 routes 83 | bords N3 S3 O23 E23
```

**GUIDs vérifiés dans les données** (débits exacts, unités par minute) :

| defId | nom | taille | production |
|---|---|---|---|
| `g3174` | Boulangerie | 4×5 | out `2137` Pain @1 · in `2119` Farine @1 |
| `g3075` | Moulin à grains | 4×6 | out `2119` Farine @2 · in `2069` Blé @2 |
| `g2693` | Ferme de céréales | 4×3 | out `2069` Blé @1 · `field.tiles` 140 · `transporterRange` 40 |
| `g2786` | Élevage ovin | 3×3 | out `2073` Moutons @2 · `field.tiles` 3 · `transporterRange` 30 |
| `g2878` | Bûcheron | 4×4 | `freeArea {radius:8, area:80}` · `slotType` forest |
| `g3310` | Entrepôt | 6×6 | `roadRoot` |

Le **lot parfait du pain** est donc `2 × g3174 + 1 × g3075 + 2 × g2693` : 2 farine produites contre 2 consommées, 2 blé produits contre 2 consommés.

---

## Task 1 : `occupancy.ts` — l'état BLOQUÉ et le masque de forme

**Files:**
- Modify: `src/prodlayout/occupancy.ts`
- Test: `src/prodlayout/occupancy.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à la fin de `src/prodlayout/occupancy.test.ts`, et compléter l'import en tête du fichier avec `BLOCKED` et `usableArea` :

```ts
describe("masque de forme", () => {
  it("sans masque, toutes les cases sont libres et utilisables", () => {
    const o = makeOcc(3, 2);
    expect(count(o, FREE)).toBe(6);
    expect(usableArea(o)).toBe(6);
  });

  it("le masque marque les cases hors forme et les sort de la surface utilisable", () => {
    const o = makeOcc(2, 2, [true, false, true, true]);
    expect(at(o, 1, 0)).toBe(BLOCKED);
    expect(at(o, 0, 0)).toBe(FREE);
    expect(usableArea(o)).toBe(3);
  });

  it("un rectangle qui chevauche une case bloquée ne tient pas", () => {
    const o = makeOcc(3, 1, [true, false, true]);
    expect(fits(o, 0, 0, 2, 1)).toBe(false);
    expect(fits(o, 2, 0, 1, 1)).toBe(true);
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/occupancy.test.ts`
Expected: FAIL — `BLOCKED` et `usableArea` ne sont pas exportés.

- [ ] **Step 3 : implémenter**

Dans `src/prodlayout/occupancy.ts`, ajouter après la constante `RESERVED` :

```ts
/**
 * Case hors de la FORME demandée : ni bâtie, ni traversée, ni comptée.
 *
 * Rien d'autre ne change dans ce fichier, et c'est le point : `fits`, `fillFields`,
 * `paintSkeleton` et `freeAround` testent tous `=== FREE` avant de poser quoi que ce
 * soit. Marquer les cases hors forme à l'initialisation suffit donc à faire respecter le
 * masque par tout le module, sans toucher une seule de ces fonctions.
 */
export const BLOCKED = 5;
```

Remplacer `makeOcc` :

```ts
export const makeOcc = (w: number, h: number, usable?: readonly boolean[]): Occ => {
  const cell = new Uint8Array(w * h);
  if (usable) for (let i = 0; i < cell.length; i++) if (!usable[i]) cell[i] = BLOCKED;
  return { w, h, cell };
};
```

Ajouter à la fin du fichier :

```ts
/** Surface réellement disponible — le dénominateur honnête de l'efficacité. */
export const usableArea = (o: Occ): number => o.w * o.h - count(o, BLOCKED);
```

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/occupancy.test.ts`
Expected: PASS, tous les tests du fichier.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/occupancy.ts src/prodlayout/occupancy.test.ts
git commit -m "feat(prodlayout): un etat BLOQUE, et la forme libre devient possible"
```

---

## Task 2 : `frac.ts` — la soustraction rationnelle

**Files:**
- Modify: `src/prodlayout/frac.ts`
- Test: `src/prodlayout/frac.test.ts`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter dans `src/prodlayout/frac.test.ts` (et `subF` à l'import) :

```ts
it("soustrait sans passer par le flottant", () => {
  expect(subF(frac(1, 3), frac(1, 6))).toEqual({ n: 1, d: 6 });
  expect(subF(frac(2), frac(2))).toEqual({ n: 0, d: 1 });
  expect(subF(frac(1), frac(3))).toEqual({ n: -2, d: 1 });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/frac.test.ts`
Expected: FAIL — `subF` n'existe pas.

- [ ] **Step 3 : implémenter**

Dans `src/prodlayout/frac.ts`, après `mulF` :

```ts
export const subF = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
```

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/frac.test.ts`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/frac.ts src/prodlayout/frac.test.ts
git commit -m "feat(prodlayout): soustraction rationnelle, pour le bilan du panier"
```

---

## Task 3 : `basket.ts` — le panier normalisé et le bilan des biens

**Files:**
- Create: `src/prodlayout/basket.ts`
- Test: `src/prodlayout/basket.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `src/prodlayout/basket.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { balanceBasket, normalizeBasket } from "./basket";
import { toNumber } from "./frac";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("normalizeBasket", () => {
  it("fusionne les doublons et écarte les comptes nuls ou négatifs", () => {
    const b = normalizeBasket([
      { defId: "g3174", count: 2 },
      { defId: "g3075", count: 0 },
      { defId: "g3174", count: 3 },
      { defId: "g2693", count: -1 },
    ]);
    expect(b.lines).toEqual([{ defId: "g3174", count: 5 }]);
  });

  it("range par defId — un ordre total, donc un plan reproductible", () => {
    const a = normalizeBasket([{ defId: "g3174", count: 1 }, { defId: "g2693", count: 1 }]);
    const b = normalizeBasket([{ defId: "g2693", count: 1 }, { defId: "g3174", count: 1 }]);
    expect(a).toEqual(b);
    expect(a.lines.map((l) => l.defId)).toEqual(["g2693", "g3174"]);
  });

  it("tronque les comptes fractionnaires — on ne pose pas un demi-moulin", () => {
    expect(normalizeBasket([{ defId: "g3075", count: 2.7 }]).lines).toEqual([
      { defId: "g3075", count: 2 },
    ]);
  });
});

describe("balanceBasket", () => {
  it("une boulangerie seule produit du pain et manque de farine", () => {
    const bal = balanceBasket(normalizeBasket([{ defId: "g3174", count: 1 }]), lookup);
    expect(bal.surplus.map((f) => f.good)).toEqual(["2137"]);
    expect(toNumber(bal.surplus[0].ratePerMin)).toBe(1);
    expect(bal.deficits.map((f) => f.good)).toEqual(["2119"]);
    expect(toNumber(bal.deficits[0].ratePerMin)).toBe(1);
  });

  it("le lot parfait du pain n'a plus aucun déficit", () => {
    const bal = balanceBasket(
      normalizeBasket([
        { defId: "g3174", count: 2 },
        { defId: "g3075", count: 1 },
        { defId: "g2693", count: 2 },
      ]),
      lookup,
    );
    expect(bal.deficits).toEqual([]);
    expect(bal.surplus.map((f) => f.good)).toEqual(["2137"]);
    expect(toNumber(bal.surplus[0].ratePerMin)).toBe(2);
  });

  it("un moulin de trop laisse un surplus de farine, pas un déficit", () => {
    const bal = balanceBasket(
      normalizeBasket([{ defId: "g3174", count: 1 }, { defId: "g3075", count: 1 }]),
      lookup,
    );
    expect(bal.deficits.map((f) => f.good)).toEqual(["2069"]);
    expect(bal.surplus.map((f) => f.good).sort()).toEqual(["2119", "2137"]);
  });

  it("un bâtiment à slotType passe en AVIS, pas en refus", () => {
    const bal = balanceBasket(normalizeBasket([{ defId: "g2878", count: 1 }]), lookup);
    expect(bal.advisories).toEqual([{ defId: "g2878", slotType: "forest" }]);
  });

  it("les biens portent leur nom lisible", () => {
    const bal = balanceBasket(normalizeBasket([{ defId: "g2786", count: 1 }]), lookup);
    expect(bal.surplus[0].name).toBe("Moutons");
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/basket.test.ts`
Expected: FAIL — `./basket` n'existe pas.

- [ ] **Step 3 : implémenter**

Créer `src/prodlayout/basket.ts` :

```ts
import { eco, goodName, type Lookup } from "./chain";
import { addF, frac, mulF, subF, type Frac } from "./frac";

/**
 * LE PANIER — ce que l'utilisateur a choisi, littéralement.
 *
 * À la différence de `chain.ts`, rien n'est déduit : le panier ne remonte aucun arbre et
 * n'ajoute aucun producteur. Il constate. C'est `complete.ts` qui propose les ajouts, et
 * c'est un geste explicite de l'utilisateur, jamais un effet de bord du plan.
 */

export interface BasketLine {
  defId: string;
  count: number;
}

export interface Basket {
  lines: BasketLine[];
}

/** Un débit de bien, en unités par minute, exact. */
export interface GoodFlow {
  good: string;
  name: string;
  ratePerMin: Frac;
}

/** Ce que le module ne peut pas vérifier hors terrain — signalé, jamais bloquant. */
export interface Advisory {
  defId: string;
  slotType: string;
}

export interface Balance {
  produced: GoodFlow[];
  consumed: GoodFlow[];
  surplus: GoodFlow[];
  deficits: GoodFlow[];
  advisories: Advisory[];
}

/**
 * Panier canonique : doublons fusionnés, comptes tronqués à l'entier, comptes ≤ 0
 * écartés, ordre total par defId. L'ordre total n'est pas cosmétique — c'est lui qui rend
 * deux paniers saisis dans un ordre différent rigoureusement identiques, donc leurs plans
 * comparables.
 */
export function normalizeBasket(lines: readonly BasketLine[]): Basket {
  const acc = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isFinite(l.count)) continue;
    acc.set(l.defId, (acc.get(l.defId) ?? 0) + Math.trunc(l.count));
  }
  return {
    lines: [...acc.entries()]
      .filter(([, n]) => n > 0)
      .map(([defId, count]) => ({ defId, count }))
      .sort((a, b) => a.defId.localeCompare(b.defId)),
  };
}

const flowsOf = (m: Map<string, Frac>): GoodFlow[] =>
  [...m.entries()]
    .map(([good, ratePerMin]) => ({ good, name: goodName(good), ratePerMin }))
    .sort((a, b) => a.good.localeCompare(b.good));

/** Production moins consommation, bien par bien, en rationnels exacts. */
export function balanceBasket(basket: Basket, lookup: Lookup): Balance {
  const prod = new Map<string, Frac>();
  const cons = new Map<string, Frac>();
  const advisories: Advisory[] = [];

  const bump = (m: Map<string, Frac>, good: string, f: Frac) =>
    m.set(good, addF(m.get(good) ?? frac(0), f));

  for (const line of basket.lines) {
    const slotType = lookup(line.defId)?.slotType;
    if (slotType) advisories.push({ defId: line.defId, slotType });
    const p = eco.buildingProd[line.defId];
    if (!p?.cycleTime) continue;
    const n = frac(line.count);
    for (const o of p.outputs) bump(prod, o.good, mulF(n, frac(o.amount * 60, p.cycleTime)));
    for (const i of p.inputs) bump(cons, i.good, mulF(n, frac(i.amount * 60, p.cycleTime)));
  }

  const surplus = new Map<string, Frac>();
  const deficits = new Map<string, Frac>();
  for (const g of new Set([...prod.keys(), ...cons.keys()])) {
    const d = subF(prod.get(g) ?? frac(0), cons.get(g) ?? frac(0));
    if (d.n > 0) surplus.set(g, d);
    else if (d.n < 0) deficits.set(g, mulF(d, frac(-1)));
  }

  return {
    produced: flowsOf(prod),
    consumed: flowsOf(cons),
    surplus: flowsOf(surplus),
    deficits: flowsOf(deficits),
    advisories: advisories.sort((a, b) => a.defId.localeCompare(b.defId)),
  };
}
```

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/basket.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/basket.ts src/prodlayout/basket.test.ts
git commit -m "feat(prodlayout): le panier constate, il ne deduit rien"
```

---

## Task 4 : `complete.ts` — le point fixe « compléter »

**Files:**
- Create: `src/prodlayout/complete.ts`
- Test: `src/prodlayout/complete.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `src/prodlayout/complete.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { balanceBasket, normalizeBasket } from "./basket";
import { completeBasket } from "./complete";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("completeBasket", () => {
  it("une boulangerie seule fait remonter le moulin ET la ferme", () => {
    const done = completeBasket(normalizeBasket([{ defId: "g3174", count: 1 }]), lookup);
    const ids = done.lines.map((l) => l.defId);
    expect(ids).toContain("g3075");
    expect(ids).toContain("g2693");
    expect(balanceBasket(done, lookup).deficits).toEqual([]);
  });

  it("le point fixe est idempotent", () => {
    const once = completeBasket(normalizeBasket([{ defId: "g3174", count: 1 }]), lookup);
    expect(completeBasket(once, lookup)).toEqual(once);
  });

  it("un panier déjà complet n'est pas touché", () => {
    const parfait = normalizeBasket([
      { defId: "g3174", count: 2 },
      { defId: "g3075", count: 1 },
      { defId: "g2693", count: 2 },
    ]);
    expect(completeBasket(parfait, lookup)).toEqual(parfait);
  });

  it("un bien déclaré importé n'appelle aucun producteur", () => {
    const done = completeBasket(
      normalizeBasket([{ defId: "g3174", count: 1 }]),
      lookup,
      new Set(["2119"]),
    );
    expect(done.lines.map((l) => l.defId)).toEqual(["g3174"]);
  });

  it("un panier vide reste vide", () => {
    expect(completeBasket(normalizeBasket([]), lookup).lines).toEqual([]);
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/complete.test.ts`
Expected: FAIL — `./complete` n'existe pas.

- [ ] **Step 3 : implémenter**

Créer `src/prodlayout/complete.ts` :

```ts
import { balanceBasket, normalizeBasket, type Basket, type BasketLine } from "./basket";
import { eco, pickProducer, ratePerMin, type Lookup } from "./chain";
import { divF, toNumber } from "./frac";

/**
 * COMPLÉTER LE PANIER — un geste explicite, jamais un effet de bord.
 *
 * Point fixe et non passe unique : ajouter un moulin crée un besoin de blé, qui appelle
 * une ferme, qui n'appelle plus rien. La boucle s'arrête sur trois conditions — plus de
 * déficit, plus rien à ajouter, ou le panier ne bouge plus — et un plafond de passes
 * borne les chaînes cycliques, que `chain.ts` connaît déjà et traite en imports.
 */

const PASSES_MAX = 24;

/** Région dominante du panier, pour choisir un producteur du bon monde. */
function regionOf(basket: Basket, lookup: Lookup): string | undefined {
  const n = new Map<string, number>();
  for (const l of basket.lines) {
    const r = lookup(l.defId)?.region;
    if (r) n.set(r, (n.get(r) ?? 0) + l.count);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function completeBasket(
  basket: Basket,
  lookup: Lookup,
  imported: ReadonlySet<string> = new Set(),
): Basket {
  let cur = normalizeBasket(basket.lines);
  for (let pass = 0; pass < PASSES_MAX; pass++) {
    const ouverts = balanceBasket(cur, lookup).deficits.filter((d) => !imported.has(d.good));
    if (!ouverts.length) return cur;

    const region = regionOf(cur, lookup);
    const ajouts: BasketLine[] = [];
    for (const d of ouverts) {
      const src = pickProducer(d.good, region);
      if (!src) continue; // aucun producteur : le bien s'importera, rien à ajouter
      const r = ratePerMin(eco.buildingProd[src], d.good);
      if (r.n <= 0) continue;
      ajouts.push({ defId: src, count: Math.ceil(toNumber(divF(d.ratePerMin, r))) });
    }
    if (!ajouts.length) return cur;

    const suivant = normalizeBasket([...cur.lines, ...ajouts]);
    if (JSON.stringify(suivant) === JSON.stringify(cur)) return cur;
    cur = suivant;
  }
  return cur;
}
```

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/complete.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/complete.ts src/prodlayout/complete.test.ts
git commit -m "feat(prodlayout): completer le panier, par point fixe et sur demande"
```

---

## Task 5 : `roads.ts` — branches intérieures et axe de l'épine

**Files:**
- Modify: `src/prodlayout/roads.ts`
- Test: `src/prodlayout/roads.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter dans `src/prodlayout/roads.test.ts`, en complétant les imports avec `BLOCKED`, `at`, `FREE`, `makeOcc`, `ROAD` depuis `./occupancy` et `paintSkeleton` depuis `./roads` :

```ts
describe("le squelette ne gaspille plus les colonnes de bord", () => {
  it("axe horizontal : aucune colonne de bord peinte hors l'épine", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    for (let y = 0; y < 5; y++) {
      if (y === 2) continue; // l'épine traverse toute la largeur, bords compris
      expect(at(o, 0, y)).toBe(FREE);
      expect(at(o, 8, y)).toBe(FREE);
    }
  });

  it("axe horizontal : au moins une branche intérieure existe", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 1, 0)).toBe(ROAD);
  });

  it("axe vertical : le rôle des lignes et des colonnes s'échange", () => {
    const o = makeOcc(5, 9);
    paintSkeleton(o, 2, 3, "v");
    for (let x = 0; x < 5; x++) {
      if (x === 2) continue;
      expect(at(o, x, 0)).toBe(FREE);
      expect(at(o, x, 8)).toBe(FREE);
    }
    expect(at(o, 0, 1)).toBe(ROAD);
  });

  it("une case bloquée n'est jamais peinte", () => {
    const usable = new Array(9 * 5).fill(true);
    usable[2 * 9 + 4] = false;
    const o = makeOcc(9, 5, usable);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 4, 2)).toBe(BLOCKED);
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/roads.test.ts`
Expected: FAIL — `paintSkeleton` n'accepte pas de 4ᵉ argument, et peint encore les colonnes de bord.

- [ ] **Step 3 : implémenter**

Dans `src/prodlayout/roads.ts`, remplacer entièrement `paintSkeleton` :

```ts
export type SpineAxis = "h" | "v";

/**
 * Épine dorsale à `spinePos` et branches perpendiculaires tous les `pitch`.
 *
 * Les branches sont INTÉRIEURES : jamais la première ni la dernière ligne de l'axe
 * transverse. Une route de bord ne dessert que d'un côté, et la mesure était sévère — sur
 * le pain ×2 en 23×23, les deux colonnes de bord faisaient 46 des 83 cases de route du
 * plan. Le prix à payer est que le squelette n'atteint plus le bord tout seul : c'est
 * désormais `exit.ts` qui garantit le débouché, par contrat plutôt que par accident.
 *
 * Ne peint que les cases LIBRES. L'entrepôt est déjà posé quand cette fonction s'exécute,
 * et une branche qui le rencontre s'arrête contre lui — l'accès route dont il a besoin.
 * Les cases hors forme (BLOCKED) sont épargnées par la même garde.
 */
export function paintSkeleton(o: Occ, spinePos: number, pitch: number, axis: SpineAxis = "h"): void {
  const step = Math.max(2, pitch);
  if (axis === "h") {
    for (let x = 0; x < o.w; x++) if (at(o, x, spinePos) === FREE) setAt(o, x, spinePos, ROAD);
    for (let x = 1; x <= o.w - 2; x += step) {
      for (let y = 0; y < o.h; y++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
    }
  } else {
    for (let y = 0; y < o.h; y++) if (at(o, spinePos, y) === FREE) setAt(o, spinePos, y, ROAD);
    for (let y = 1; y <= o.h - 2; y += step) {
      for (let x = 0; x < o.w; x++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
    }
  }
}
```

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/roads.test.ts`
Expected: PASS pour les nouveaux tests. Les anciens tests de `roads.test.ts` qui supposaient une colonne de bord peinte doivent être **corrigés dans le même geste**, en remplaçant l'attente « la dernière colonne est en route » par « une branche intérieure existe à `w-2` ou avant ». Ne pas les supprimer.

- [ ] **Step 5 : mesurer l'effet sur la référence**

Run: `pnpm vitest run src/prodlayout/__tmpref.test.ts`
Noter les nouvelles lignes. Attendu : moins de cases de route, bords O et E proches de 0. Si la boîte grandit au lieu de rétrécir, **s'arrêter et le dire** — le pitch des branches ne convient plus et il faut le mesurer avant d'aller plus loin.

- [ ] **Step 6 : commit**

```bash
git add src/prodlayout/roads.ts src/prodlayout/roads.test.ts
git commit -m "feat(prodlayout): branches interieures et axe d'epine, 46 cases de route rendues"
```

---

## Task 6 : `unmet.ts` et `exit.ts` — le refus chiffré et la sortie garantie

**Files:**
- Create: `src/prodlayout/unmet.ts`
- Create: `src/prodlayout/exit.ts`
- Test: `src/prodlayout/exit.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `src/prodlayout/exit.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { ensureExit } from "./exit";
import { at, BLOCKED, count, FREE, makeOcc, ROAD, setAt } from "./occupancy";
import { paintSkeleton, roadDistances } from "./roads";

/** Une graine : la case route d'où part la distance-rue (l'entrepôt, en vrai). */
const seedsOf = (w: number, x: number, y: number) => [y * w + x];

describe("ensureExit", () => {
  it("prend le débouché existant quand l'épine touche déjà le bord", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h"); // l'épine traverse en y=2, donc touche ouest et est
    const avant = count(o, ROAD);
    const exit = ensureExit(o, "ouest", seedsOf(9, 1, 0));
    expect(exit).toEqual({ x: 0, y: 2, side: "ouest" });
    expect(count(o, ROAD)).toBe(avant); // aucune case peinte en plus
  });

  it("creuse un couloir quand le bord n'a aucun débouché", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    // on bouche les branches sur la moitié sud pour isoler le bord sud
    for (let x = 0; x < 9; x++) for (let y = 3; y < 5; y++) if (at(o, x, y) === ROAD) setAt(o, x, y, FREE);
    const avant = count(o, ROAD);
    const exit = ensureExit(o, "sud", seedsOf(9, 1, 2));
    expect(exit).not.toBeNull();
    expect(exit!.side).toBe("sud");
    expect(exit!.y).toBe(4);
    expect(count(o, ROAD)).toBeGreaterThan(avant); // un couloir a été peint
  });

  it("le couloir creusé est bien relié aux graines", () => {
    const o = makeOcc(9, 5);
    paintSkeleton(o, 2, 3, "h");
    for (let x = 0; x < 9; x++) for (let y = 3; y < 5; y++) if (at(o, x, y) === ROAD) setAt(o, x, y, FREE);
    const exit = ensureExit(o, "sud", seedsOf(9, 1, 2))!;
    // relié = la distance-rue depuis la sortie atteint la graine
    const dist = roadDistances(o, [exit.y * o.w + exit.x]);
    expect(dist[2 * 9 + 1]).toBeGreaterThan(0);
  });

  it("rend null quand le bord entier est hors forme", () => {
    const usable = new Array(9 * 5).fill(true);
    for (let x = 0; x < 9; x++) usable[4 * 9 + x] = false; // toute la ligne sud bloquée
    const o = makeOcc(9, 5, usable);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 0, 4)).toBe(BLOCKED);
    expect(ensureExit(o, "sud", seedsOf(9, 1, 2))).toBeNull();
  });

  it("est déterministe — deux appels sur la même grille rendent le même point", () => {
    const build = () => {
      const o = makeOcc(9, 5);
      paintSkeleton(o, 2, 3, "h");
      return o;
    };
    expect(ensureExit(build(), "est", seedsOf(9, 1, 0))).toEqual(
      ensureExit(build(), "est", seedsOf(9, 1, 0)),
    );
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/exit.test.ts`
Expected: FAIL — `./exit` n'existe pas.

- [ ] **Step 3 : créer `unmet.ts`**

```ts
import type { ExitSide } from "./exit";

/**
 * CE QUI MANQUE, CHIFFRÉ.
 *
 * Le refus n'est pas une exception à message vague. En boîte imposée il n'y a plus de
 * rattrapage par agrandissement : le refus est la sortie NORMALE d'une contrainte trop
 * serrée, et il doit dire quoi ajouter et de combien. Un refus qui ne se lit pas rend le
 * mode inutilisable.
 */
export type Unmet =
  | { kind: "champ"; defId: string; uid: string; obtenu: number; requis: number }
  | { kind: "aire-libre"; defId: string; uid: string; obtenu: number; requis: number }
  | { kind: "route"; defId: string; uid: string }
  | { kind: "portee"; defId: string; uid: string; distance: number; portee: number }
  | { kind: "non-pose"; defId: string; manque: number }
  | { kind: "sortie"; side: ExitSide };

export interface PlanRefus {
  refuse: true;
  raison: string;
  nonServis: Unmet[];
}

/** Phrase lisible pour un manque — l'interface l'affiche telle quelle. */
export function direUnmet(u: Unmet, nom: (defId: string) => string): string {
  switch (u.kind) {
    case "champ":
      return `${nom(u.defId)} : ${u.obtenu} cases de champ sur ${u.requis}`;
    case "aire-libre":
      return `${nom(u.defId)} : ${u.obtenu} cases libres autour sur ${u.requis} exigées`;
    case "route":
      return `${nom(u.defId)} : aucun accès route`;
    case "portee":
      return `${nom(u.defId)} : entrepôt à ${u.distance} en distance-rue, portée ${u.portee}`;
    case "non-pose":
      return `${nom(u.defId)} : ${u.manque} exemplaire(s) sans place`;
    case "sortie":
      return `Aucune sortie de route possible sur le bord ${u.side}`;
  }
}
```

- [ ] **Step 4 : créer `exit.ts`**

```ts
import { FREE, ROAD, setAt, type Occ } from "./occupancy";
import { roadDistances } from "./roads";

/**
 * LA SORTIE DE ROUTE — la seule règle qui ne vienne pas du catalogue.
 *
 * Un blueprint recopié sur une île se branche au comptoir général par UNE case de route
 * qui sort du plan. Sans elle, l'entrepôt n'expédie rien et tout le plan est décoratif.
 * Le squelette ne peignant plus les colonnes de bord, ce débouché ne peut plus arriver
 * par accident : il est garanti ici, ou il n'existe pas et le plan est refusé.
 */

export type ExitSide = "nord" | "sud" | "est" | "ouest";

export interface ExitPoint {
  x: number;
  y: number;
  side: ExitSide;
}

/** Cases du bord demandé, dans un ordre total — donc un résultat reproductible. */
function borderCells(o: Occ, side: ExitSide): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (side === "nord") for (let x = 0; x < o.w; x++) out.push({ x, y: 0 });
  else if (side === "sud") for (let x = 0; x < o.w; x++) out.push({ x, y: o.h - 1 });
  else if (side === "ouest") for (let y = 0; y < o.h; y++) out.push({ x: 0, y });
  else for (let y = 0; y < o.h; y++) out.push({ x: o.w - 1, y });
  return out;
}

/** Pas vers l'intérieur, depuis le bord demandé. */
const inward = (side: ExitSide): [number, number] =>
  side === "nord" ? [0, 1] : side === "sud" ? [0, -1] : side === "ouest" ? [1, 0] : [-1, 0];

/**
 * Garantit une case de route sur le bord `side`, reliée aux `seeds` en distance-rue.
 * Peint le couloir le plus court si aucun débouché n'existe. Rend `null` si le bord est
 * inatteignable — bord entièrement hors forme, ou couloir barré par du bâti.
 */
export function ensureExit(o: Occ, side: ExitSide, seeds: number[]): ExitPoint | null {
  const dist = roadDistances(o, seeds);
  const cells = borderCells(o, side);

  // 1. un débouché existe déjà : le plus proche des graines, à égalité le premier de l'ordre
  let best: { x: number; y: number; d: number } | null = null;
  for (const c of cells) {
    const i = c.y * o.w + c.x;
    if (o.cell[i] !== ROAD || dist[i] < 0) continue;
    if (!best || dist[i] < best.d) best = { x: c.x, y: c.y, d: dist[i] };
  }
  if (best) return { x: best.x, y: best.y, side };

  // 2. creuser : le couloir libre le plus court jusqu'à une route reliée
  const [dx, dy] = inward(side);
  let bestRun: { x: number; y: number; run: { x: number; y: number }[] } | null = null;
  for (const c of cells) {
    const run: { x: number; y: number }[] = [];
    let x = c.x;
    let y = c.y;
    let touche = false;
    while (x >= 0 && y >= 0 && x < o.w && y < o.h) {
      const i = y * o.w + x;
      if (o.cell[i] === ROAD) {
        touche = dist[i] >= 0;
        break;
      }
      if (o.cell[i] !== FREE) break; // bâti, champ, réservé ou hors forme : couloir barré
      run.push({ x, y });
      x += dx;
      y += dy;
    }
    if (!touche || !run.length) continue;
    if (!bestRun || run.length < bestRun.run.length) bestRun = { x: c.x, y: c.y, run };
  }
  if (!bestRun) return null;

  for (const r of bestRun.run) setAt(o, r.x, r.y, ROAD);
  return { x: bestRun.x, y: bestRun.y, side };
}
```

- [ ] **Step 5 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/exit.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6 : commit**

```bash
git add src/prodlayout/unmet.ts src/prodlayout/exit.ts src/prodlayout/exit.test.ts
git commit -m "feat(prodlayout): la sortie de route par contrat, et le refus qui se chiffre"
```

---

## Task 7 : `pack.ts` — servi d'abord, petit ensuite

**Files:**
- Modify: `src/prodlayout/pack.ts`
- Test: `src/prodlayout/pack.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter dans `src/prodlayout/pack.test.ts` :

```ts
describe("l'objectif : servi d'abord, petit ensuite", () => {
  const items = [{ defId: "g3174", count: 2 }, { defId: "g3075", count: 1 }, { defId: "g2693", count: 2 }];

  it("une boîte assez grande sert tout et sort par le bord demandé", () => {
    const r = tryBox({ items, warehouseDefId: "g3310", lookup }, 30, 30, "sud");
    expect(r.unmet).toEqual([]);
    expect(r.served).toBe(true);
    expect(r.exit).not.toBeNull();
    expect(r.exit!.side).toBe("sud");
    expect(r.exit!.y).toBe(r.h - 1);
  });

  it("une boîte trop petite REFUSE en chiffrant, au lieu de livrer un plan dégradé", () => {
    const r = tryBox({ items, warehouseDefId: "g3310", lookup }, 12, 12, "sud");
    expect(r.served).toBe(false);
    expect(r.unmet.length).toBeGreaterThan(0);
    // et le manque désigne un bâtiment réel, pas une chaîne vague
    for (const u of r.unmet) {
      if ("defId" in u) expect(lookup(u.defId)).toBeDefined();
    }
  });

  it("l'efficacité se mesure sur la surface UTILISABLE, pas sur w×h", () => {
    const usable = new Array(30 * 30).fill(true);
    for (let x = 0; x < 30; x++) usable[x] = false; // toute la ligne nord hors forme
    const r = tryBox({ items, warehouseDefId: "g3310", lookup }, 30, 30, "sud", usable);
    expect(r.efficiency).toBeLessThanOrEqual(1);
  });

  it("tout bâtiment sur route est dans la MÊME composante que la sortie", () => {
    const r = tryBox({ items, warehouseDefId: "g3310", lookup }, 30, 30, "sud");
    expect(r.served).toBe(true);
    // aucun unmet de type route ne subsiste : la vérification de connexité les produit
    expect(r.unmet.filter((u) => u.kind === "route")).toEqual([]);
  });
});
```

Compléter les imports du fichier avec `tryBox` depuis `./pack`, `rawCatalog`, et le `lookup` local si le fichier n'en a pas déjà un.

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/pack.test.ts`
Expected: FAIL — `tryBox` n'est pas exporté et n'a pas cette signature.

- [ ] **Step 3 : implémenter**

Dans `src/prodlayout/pack.ts` :

1. Importer `ensureExit`, `type ExitPoint`, `type ExitSide` depuis `./exit`, `type Unmet` depuis `./unmet`, `type Advisory` depuis `./basket`, et `BLOCKED`, `usableArea` depuis `./occupancy`.

2. Remplacer `PackResult` :

```ts
export interface PackResult {
  w: number;
  h: number;
  placements: Placement[];
  roads: { x: number; y: number }[];
  fields: FieldCell[];
  usable: boolean[];
  tiles: { buildings: number; fields: number; roads: number };
  /** Mesure affichée, dénominateur = surface UTILISABLE. Ne décide plus de rien. */
  efficiency: number;
  exit: ExitPoint | null;
  unmet: Unmet[];
  advisories: Advisory[];
  served: boolean;
}
```

3. Exporter `tryBox` avec la signature `(input: PackInput, w: number, h: number, exitSide: ExitSide, usable?: readonly boolean[]): PackResult`. Il construit `expandCopies(input)` lui-même, appelle `makeOcc(w, h, usable)`, garde les étapes 1 à 5 actuelles, et remplace la fin par :

```ts
  // 6. la sortie de route, AVANT le bilan de portée : le couloir creusé compte
  const exit = ensureExit(occ, exitSide, warehouseSeeds(occ, placements, input.lookup));
  if (!exit) unmet.push({ kind: "sortie", side: exitSide });

  // 7. portée d'entrepôt ; un second entrepôt si des producteurs sont trop loin
  //    (comportement conservé : c'est lui qui rend les grands paniers plaçables)
  let bad = outOfRange(occ, placements, input.lookup);
  if (bad.length) {
    const cx = Math.round(bad.reduce((s, p) => s + p.x, 0) / bad.length);
    const cy = Math.round(bad.reduce((s, p) => s + p.y, 0) / bad.length);
    const spot = findNear(occ, wh, cx, cy);
    if (spot) {
      fill(occ, spot.x, spot.y, wh.size.w, wh.size.h, BUILDING);
      placements.push({ uid: `b${nextUid++}`, defId: wh.id, x: spot.x, y: spot.y, rot: 0 });
      bad = outOfRange(occ, placements, input.lookup);
    }
  }
  for (const p of bad) {
    const d = input.lookup(p.defId)!;
    const portee = d.transporterRange ?? DEFAULT_RANGE;
    unmet.push({ kind: "portee", defId: p.defId, uid: p.uid, distance: -1, portee });
  }

  // 8. accès route ET connexité : être sur UNE route ne suffit pas, il faut être sur
  //    la même que la sortie. Sans ce test, deux îlots de voirie séparés passeraient
  //    tous les autres contrôles en étant injouables — le comptoir ne verrait que l'un.
  const depuisSortie = exit ? roadDistances(occ, [exit.y * occ.w + exit.x]) : null;
  for (const p of placements) {
    const d = input.lookup(p.defId)!;
    if (!d.needsRoad) continue;
    const { w: pw, h: ph } = sizeOf(d, p.rot);
    const voisines = adjacentRoads(occ, p.x, p.y, pw, ph);
    const relie = depuisSortie ? voisines.some((c) => depuisSortie[c] >= 0) : false;
    if (!relie) unmet.push({ kind: "route", defId: p.defId, uid: p.uid });
  }
```

4. Les manques de champ, jusqu'ici poussés dans `gaps`, deviennent :

```ts
      if (got.length < c.def.field.tiles) {
        unmet.push({ kind: "champ", defId: c.defId, uid, obtenu: got.length, requis: c.def.field.tiles });
      }
```

5. Une copie sans emplacement ne fait plus échouer la boîte entière — elle se compte :

```ts
    const spot = findSpot(occ, c.def, c.def.needsRoad);
    if (!spot) {
      nonPoses.set(c.defId, (nonPoses.get(c.defId) ?? 0) + 1);
      continue;
    }
```

et après la boucle :

```ts
  for (const [defId, manque] of [...nonPoses.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    unmet.push({ kind: "non-pose", defId, manque });
  }
```

6. Les avis de `slotType` se relèvent sur ce qui est RÉELLEMENT posé, pas sur la commande —
   une copie sans place ne mérite pas d'avis :

```ts
  const advisories: Advisory[] = [];
  const vus = new Set<string>();
  for (const p of placements) {
    const slotType = input.lookup(p.defId)?.slotType;
    if (!slotType || vus.has(p.defId)) continue;
    vus.add(p.defId);
    advisories.push({ defId: p.defId, slotType });
  }
  advisories.sort((a, b) => a.defId.localeCompare(b.defId));
```

7. Les aires libres se vérifient à l'état FINAL, une fois tout posé :

```ts
  for (const p of placements) {
    const d = input.lookup(p.defId)!;
    if (!d.freeArea) continue;
    const { w: pw, h: ph } = sizeOf(d, p.rot);
    const libre = freeAround(occ, p.x, p.y, pw, ph, d.freeArea.radius)
      + reservedAround(occ, p.x, p.y, pw, ph, d.freeArea.radius);
    if (libre < d.freeArea.area) {
      unmet.push({ kind: "aire-libre", defId: p.defId, uid: p.uid, obtenu: libre, requis: d.freeArea.area });
    }
  }
```

Ajouter dans `fields.ts` la sonde manquante, symétrique de `freeAround` :

```ts
/** Cases DÉJÀ réservées à `radius` du rectangle — elles comptent dans l'aire libre. */
export function reservedAround(
  o: Occ, x: number, y: number, w: number, h: number, radius: number,
): number {
  let n = 0;
  for (let cy = y - radius; cy <= y + h - 1 + radius; cy++) {
    for (let cx = x - radius; cx <= x + w - 1 + radius; cx++) {
      if (distToRect(cx, cy, x, y, w, h) > radius) continue;
      if (at(o, cx, cy) === RESERVED) n++;
    }
  }
  return n;
}
```

8. `trim` exclut `BLOCKED` du calcul de la boîte, produit le masque `usable` final, et calcule l'efficacité sur la surface utilisable :

```ts
  for (let i = 0; i < a.occ.cell.length; i++) {
    if (a.occ.cell[i] !== FREE && a.occ.cell[i] !== BLOCKED) used.push(i);
  }
```

puis, après avoir déterminé `x0, y0, w, h` :

```ts
  const usable: boolean[] = new Array(w * h);
  let dispo = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ok = a.occ.cell[(y + y0) * a.occ.w + (x + x0)] !== BLOCKED;
      usable[y * w + x] = ok;
      if (ok) dispo++;
    }
  }
  const efficiency = dispo > 0 ? (tiles.buildings + tiles.fields + tiles.roads) / dispo : 0;
```

Le point de sortie est translaté comme le reste : `exit: a.exit ? { ...a.exit, x: a.exit.x - x0, y: a.exit.y - y0 } : null`.

9. `better` change d'ordre — c'est le cœur du changement :

```ts
/**
 * ORDRE TOTAL : servi, puis petit, puis carré.
 *
 * L'efficacité a été RETIRÉE du classement, et c'est délibéré. Elle vaut
 * (bâtiments + champs + routes) / surface, donc elle compte les routes au numérateur :
 * mesuré sur le pain ×2, retirer les 46 cases de route de bord — inutiles, elles ne
 * desservaient qu'un côté — FAISAIT BAISSER le score. Un critère qui récompense le
 * gaspillage ne peut pas arbitrer une recherche de compacité.
 */
export function better(a: PackResult, b: PackResult): boolean {
  if (a.served !== b.served) return a.served;
  if (!a.served && a.unmet.length !== b.unmet.length) return a.unmet.length < b.unmet.length;
  if (a.w * a.h !== b.w * b.h) return a.w * a.h < b.w * b.h;
  return Math.abs(a.w - a.h) < Math.abs(b.w - b.h);
}
```

10. `packBlueprint` disparaît de ce fichier — il part dans `search.ts` (Task 8). `pack.ts` n'exporte plus que `tryBox`, `better`, `expandCopies`, `usefulArea` et les types.

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/pack.test.ts`
Expected: PASS. Les anciens tests de `pack.test.ts` qui lisaient `gaps` doivent être portés sur `unmet` dans le même geste.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/pack.ts src/prodlayout/pack.test.ts src/prodlayout/fields.ts
git commit -m "feat(prodlayout): servi d'abord, petit ensuite — l'efficacite sort du critere"
```

---

## Task 8 : `search.ts` — les trois modes de boîte et la descente par pas de 1

**Files:**
- Create: `src/prodlayout/search.ts`
- Test: `src/prodlayout/search.test.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `src/prodlayout/search.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { tryBox } from "./pack";
import { searchBox } from "./search";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);
const input = {
  items: [{ defId: "g3174", count: 2 }, { defId: "g3075", count: 1 }, { defId: "g2693", count: 2 }],
  warehouseDefId: "g3310",
  lookup,
};

describe("searchBox — mode auto", () => {
  const r = searchBox(input, { mode: "auto" }, "sud");

  it("rend un plan servi", () => {
    expect(r.served).toBe(true);
    expect(r.unmet).toEqual([]);
  });

  it("ne dépasse pas la référence mesurée du pain ×2 (23×23 = 529 cases)", () => {
    expect(r.w * r.h).toBeLessThanOrEqual(529);
  });

  it("est MINIMAL au pas de 1 — retirer une ligne ou une colonne casse le service", () => {
    expect(tryBox(input, r.w - 1, r.h, "sud").served).toBe(false);
    expect(tryBox(input, r.w, r.h - 1, "sud").served).toBe(false);
  });

  it("est reproductible à l'identique", () => {
    expect(JSON.stringify(searchBox(input, { mode: "auto" }, "sud"))).toBe(JSON.stringify(r));
  });
});

describe("searchBox — boîte imposée", () => {
  it("mode taille : respecte les dimensions et sert si elles suffisent", () => {
    const r = searchBox(input, { mode: "taille", w: 34, h: 34 }, "est");
    expect(r.served).toBe(true);
    expect(r.exit!.side).toBe("est");
  });

  it("mode taille : refuse en chiffrant quand c'est trop serré", () => {
    const r = searchBox(input, { mode: "taille", w: 12, h: 12 }, "sud");
    expect(r.served).toBe(false);
    expect(r.unmet.length).toBeGreaterThan(0);
  });

  it("mode forme : ne pose jamais rien sur une case hors masque", () => {
    const W = 34;
    const H = 34;
    const usable = new Array(W * H).fill(true);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) usable[y * W + x] = false;
    const r = searchBox(input, { mode: "forme", w: W, h: H, usable }, "sud");
    for (const p of r.placements) expect(p.x >= 6 || p.y >= 6).toBe(true);
    for (const f of r.fields) expect(r.usable[f.y * r.w + f.x]).toBe(true);
    for (const rd of r.roads) expect(r.usable[rd.y * r.w + rd.x]).toBe(true);
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/search.test.ts`
Expected: FAIL — `./search` n'existe pas.

- [ ] **Step 3 : implémenter**

Créer `src/prodlayout/search.ts` :

```ts
import type { ExitSide } from "./exit";
import { better, expandCopies, tryBox, usefulArea, type PackInput, type PackResult } from "./pack";

/**
 * LE CHOIX DE LA BOÎTE.
 *
 * Deux régimes. En boîte imposée il n'y a rien à chercher : une tentative, servie ou
 * refusée en chiffrant. En mode `auto`, un balayage de candidates donne un premier plan
 * servi, puis une DESCENTE PAR PAS DE 1 le rétrécit tant que le service tient. C'est la
 * descente qui rend l'invariant de minimalité vérifiable : « retirer une ligne ou une
 * colonne casse le service » est une phrase que le test peut exécuter, là où « la
 * meilleure des douze candidates » ne dit rien.
 */

export type BoxSpec =
  | { mode: "auto" }
  | { mode: "taille"; w: number; h: number }
  | { mode: "forme"; w: number; h: number; usable: readonly boolean[] };

const RATIOS: [number, number][] = [[1, 1], [4, 3], [3, 2], [2, 1]];
const INFLATIONS = [1.15, 1.3, 1.5, 1.8, 2.2, 2.8];

export function searchBox(input: PackInput, box: BoxSpec, exitSide: ExitSide): PackResult {
  if (box.mode !== "auto") {
    return tryBox(input, box.w, box.h, exitSide, box.mode === "forme" ? box.usable : undefined);
  }

  const wh = input.lookup(input.warehouseDefId);
  if (!wh) throw new Error(`Entrepôt introuvable : ${input.warehouseDefId}`);
  const area = usefulArea(expandCopies(input), wh);

  let best: PackResult | null = null;
  for (const inflation of INFLATIONS) {
    for (const [rw, rh] of RATIOS) {
      const unit = Math.sqrt((area * inflation) / (rw * rh));
      const w = Math.max(wh.size.w + 2, Math.ceil(unit * rw));
      const h = Math.max(wh.size.h + 3, Math.ceil(unit * rh));
      const r = tryBox(input, w, h, exitSide);
      if (!best || better(r, best)) best = r;
    }
  }
  if (!best) throw new Error("Aucune boîte candidate n'a pu être essayée.");
  return best.served ? descendre(input, best, exitSide) : best;
}

/** Rétrécit d'une ligne ou d'une colonne tant que le plan reste servi. */
function descendre(input: PackInput, depart: PackResult, exitSide: ExitSide): PackResult {
  let cur = depart;
  for (let garde = 0; garde < 200; garde++) {
    let avance = false;
    for (const [dw, dh] of [[1, 0], [0, 1]] as const) {
      const w = cur.w - dw;
      const h = cur.h - dh;
      if (w < 1 || h < 1) continue;
      const essai = tryBox(input, w, h, exitSide);
      if (essai.served) {
        cur = essai;
        avance = true;
        break;
      }
    }
    if (!avance) return cur;
  }
  return cur;
}
```

Adapter `usefulArea` dans `pack.ts` pour qu'il prenne `(copies, wh)` — il a déjà cette signature.

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/search.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/search.ts src/prodlayout/search.test.ts src/prodlayout/pack.ts
git commit -m "feat(prodlayout): trois modes de boite, et une minimalite qui se verifie"
```

---

## Task 9 : `index.ts` — la porte du panier, et la chaîne qui devient un cas

**Files:**
- Modify: `src/prodlayout/index.ts`
- Test: `src/prodlayout/index.test.ts`
- Test: `src/prodlayout/basketPlan.test.ts` (créer)

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `src/prodlayout/basketPlan.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { normalizeBasket } from "./basket";
import { planFromBasket } from "./index";

const catalog = rawCatalog as unknown as BuildingDef[];
const pain = normalizeBasket([
  { defId: "g3174", count: 2 },
  { defId: "g3075", count: 1 },
  { defId: "g2693", count: 2 },
]);

describe("planFromBasket", () => {
  it("pose exactement le panier, plus l'entrepôt — rien de plus", () => {
    const p = planFromBasket(catalog, pain, { exitSide: "sud" });
    expect("refuse" in p).toBe(false);
    if ("refuse" in p) return;
    const compte = (id: string) => p.layout.buildings.filter((b) => b.defId === id).length;
    expect(compte("g3174")).toBe(2);
    expect(compte("g3075")).toBe(1);
    expect(compte("g2693")).toBe(2);
    expect(compte("g3310")).toBeGreaterThanOrEqual(1);
  });

  it("la sortie est sur le bord demandé et porte une route", () => {
    for (const side of ["nord", "sud", "est", "ouest"] as const) {
      const p = planFromBasket(catalog, pain, { exitSide: side });
      if ("refuse" in p) throw new Error(`${side} refusé : ${p.raison}`);
      expect(p.exit.side).toBe(side);
      const surBord =
        side === "nord" ? p.exit.y === 0
        : side === "sud" ? p.exit.y === p.box.h - 1
        : side === "ouest" ? p.exit.x === 0
        : p.exit.x === p.box.w - 1;
      expect(surBord).toBe(true);
      expect(p.layout.roads.some((r) => r.x === p.exit.x && r.y === p.exit.y)).toBe(true);
    }
  });

  it("les trois champs de moutons sont posés, tous les trois", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g2786", count: 1 }]), { exitSide: "sud" });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.fields.length).toBe(3);
    expect(p.layout.fields.every((f) => f.fieldType === "moutons")).toBe(true);
  });

  it("les 140 cases de champ d'une ferme de céréales sont complètes", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g2693", count: 1 }]), { exitSide: "sud" });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.fields.length).toBe(140);
  });

  it("une boîte trop serrée REFUSE, en disant quoi manque", () => {
    const p = planFromBasket(catalog, pain, { exitSide: "sud", box: { mode: "taille", w: 12, h: 12 } });
    expect("refuse" in p).toBe(true);
    if (!("refuse" in p)) return;
    expect(p.nonServis.length).toBeGreaterThan(0);
    expect(p.raison).toMatch(/\S/);
  });

  it("un bâtiment à slotType est POSÉ, avec son avis", () => {
    const p = planFromBasket(catalog, normalizeBasket([{ defId: "g2878", count: 1 }]), { exitSide: "sud" });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.advisories).toEqual([{ defId: "g2878", slotType: "forest" }]);
    expect(p.layout.buildings.some((b) => b.defId === "g2878")).toBe(true);
  });

  it("le masque de forme remonte dans le Layout", () => {
    const W = 34;
    const H = 34;
    const usable = new Array(W * H).fill(true);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) usable[y * W + x] = false;
    const p = planFromBasket(catalog, pain, { exitSide: "sud", box: { mode: "forme", w: W, h: H, usable } });
    if ("refuse" in p) throw new Error(p.raison);
    expect(p.layout.grid.usable.length).toBe(p.box.w * p.box.h);
    expect(p.layout.grid.usable.some((u) => !u)).toBe(true);
  });

  it("est reproductible à l'identique", () => {
    const a = planFromBasket(catalog, pain, { exitSide: "sud" });
    const b = planFromBasket(catalog, pain, { exitSide: "sud" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("un panier vide est refusé plutôt que rendu vide", () => {
    const p = planFromBasket(catalog, normalizeBasket([]), { exitSide: "sud" });
    expect("refuse" in p).toBe(true);
  });
});
```

- [ ] **Step 2 : vérifier que ça échoue**

Run: `pnpm vitest run src/prodlayout/basketPlan.test.ts`
Expected: FAIL — `planFromBasket` n'est pas exporté.

- [ ] **Step 3 : implémenter**

Dans `src/prodlayout/index.ts` :

```ts
export interface BasketPlanOptions {
  exitSide: ExitSide;
  box?: BoxSpec;
}

export type BasketPlan = Omit<LayoutPlan, "chain" | "order" | "report"> & {
  basket: Basket;
  balance: Balance;
  served: true;
  exit: ExitPoint;
  advisories: Advisory[];
};

export function planFromBasket(
  catalog: BuildingDef[],
  basket: Basket,
  opts: BasketPlanOptions,
): BasketPlan | PlanRefus {
  if (!basket.lines.length) {
    return { refuse: true, raison: "Le panier est vide.", nonServis: [] };
  }
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const lookup = (id: string) => byId.get(id);
  const region = lookup(basket.lines[0].defId)?.region;
  const warehouse = pickWarehouse(catalog, region);

  const packed = searchBox(
    { items: basket.lines.map((l) => ({ defId: l.defId, count: l.count })), warehouseDefId: warehouse.id, lookup },
    opts.box ?? { mode: "auto" },
    opts.exitSide,
  );

  if (!packed.served || !packed.exit) {
    const nom = (id: string) => lookup(id)?.name ?? id;
    return {
      refuse: true,
      raison: packed.unmet.map((u) => direUnmet(u, nom)).join(" · ") || "Plan non servi.",
      nonServis: packed.unmet,
    };
  }

  const layout: Layout = {
    grid: { w: packed.w, h: packed.h, usable: [...packed.usable] },
    buildings: packed.placements.map((p) => ({
      uid: p.uid, defId: p.defId, x: p.x, y: p.y, rotation: p.rot, locked: false,
    })),
    fields: packed.fields.map((f) => ({ x: f.x, y: f.y, ownerUid: f.ownerUid, fieldType: f.fieldType })),
    roads: packed.roads.map((r) => ({ x: r.x, y: r.y, gen: true })),
  };

  return {
    layout,
    basket,
    balance: balanceBasket(basket, lookup),
    box: { w: packed.w, h: packed.h },
    tiles: packed.tiles,
    efficiency: packed.efficiency,
    gaps: [],
    served: true,
    exit: packed.exit,
    advisories: packed.advisories,
  };
}
```

`planProductionLayout` garde sa signature. Elle construit le panier depuis `buildChain` + `buildOrder`, appelle `planFromBasket` avec `exitSide: "sud"`, et conserve son `Report` bâti par `buildReport` — la chaîne a un bien cible, le panier n'en a pas, donc les deux récapitulatifs restent distincts en phase 1 :

```ts
export function planProductionLayout(
  catalog: BuildingDef[],
  targetDefId: string,
  count: number,
  opts: PlanOptions = {},
): LayoutPlan {
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const lookup = (id: string) => byId.get(id);

  const chain = buildChain(targetDefId, count, lookup, opts.imported);
  const order = buildOrder(chain);
  const basket = normalizeBasket(order.items.map((i) => ({ defId: i.defId, count: i.placed })));

  const planned = planFromBasket(catalog, basket, { exitSide: "sud" });
  if ("refuse" in planned) throw new Error(planned.raison);

  const warehouse = pickWarehouse(catalog, eco.buildingRegion[targetDefId]);
  const extras = planned.layout.buildings.filter((b) => b.defId === warehouse.id);
  return {
    layout: planned.layout,
    chain,
    order,
    report: buildReport(chain, order, lookup, [{ defId: warehouse.id, count: extras.length }]),
    box: planned.box,
    tiles: planned.tiles,
    efficiency: planned.efficiency,
    gaps: chain.gaps,
  };
}
```

- [ ] **Step 4 : vérifier que ça passe**

Run: `pnpm vitest run src/prodlayout/`
Expected: PASS, tout le module. `index.test.ts` peut voir ses chiffres bouger : le test « suggère le lot parfait » et « choisit l'entrepôt de la région » ne dépendent pas du placeur et doivent passer inchangés. Si un test de géométrie bouge, **mesurer et justifier** — ne pas ajuster l'attente sans le chiffre.

- [ ] **Step 5 : commit**

```bash
git add src/prodlayout/index.ts src/prodlayout/index.test.ts src/prodlayout/basketPlan.test.ts
git commit -m "feat(prodlayout): planFromBasket, et la chaine devient un cas du panier"
```

---

## Task 10 : mesure de non-régression et consignation

**Files:**
- Modify: `src/prodlayout/__tmpref.test.ts` (sonde jetable, gitignorée)
- Modify: `docs/ETAT-ET-SUITE.md`

- [ ] **Step 1 : relever la mesure finale**

Run: `pnpm vitest run src/prodlayout/__tmpref.test.ts`
Comparer aux lignes de référence :

```
pain ×1 : 18×18 = 324 cases | bât 92  champs 140 routes 69 | bords N3 S3 O18 E18
pain ×2 : 23×23 = 529 cases | bât 124 champs 280 routes 83 | bords N3 S3 O23 E23
```

Attendu : surface **≤** la référence, cases de route nettement en baisse. Si une surface augmente, c'est un défaut — chercher la cause avant de consigner.

- [ ] **Step 2 : suite complète et contrôles**

Run: `pnpm test`
Expected: PASS, aucun test en échec.

Run: `pnpm typecheck` puis `pnpm lint`
Expected: aucune sortie.

- [ ] **Step 3 : retirer la sonde**

```bash
rm src/prodlayout/__tmpref.test.ts
```

- [ ] **Step 4 : consigner dans l'état du projet**

Ajouter dans `docs/ETAT-ET-SUITE.md`, à la suite de la section « 1 bis. Le module de blueprints de production », un paragraphe portant : la porte `planFromBasket`, les trois modes de boîte, la règle de sortie de route, le passage de l'objectif à « servi d'abord », **les chiffres avant/après mesurés au Step 1**, et le fait que les bâtiments à `slotType` sont posés avec un avis plutôt que refusés — avec la raison, à savoir que les 12 bâtiments à `freeArea` en portent tous un.

- [ ] **Step 5 : commit**

```bash
git add docs/ETAT-ET-SUITE.md
git commit -m "docs: le panier de blueprints, mesure avant et apres"
```

---

## Ce que la phase 1 ne fait pas

L'interface. L'onglet Production continue d'appeler `planProductionLayout` et ne montre ni panier, ni bouton « compléter », ni choix de bord. C'est la phase 2, et elle se chiffre à part.
