# Blueprints de production — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — utiliser `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les
> étapes utilisent la syntaxe case à cocher (`- [ ]`).

**But :** un module indépendant qui, à partir d'un bâtiment terminal (« une boulangerie »),
calcule la chaîne de production complète au bon ratio et la pose en blueprint compact — routes,
entrepôt, champs — dans un onglet dédié, exportable et enregistrable.

**Architecture :** nouveau dossier `src/prodlayout/`, sans aucun import depuis `src/optimizer/`
ni `src/economy/`. Ratios en arithmétique rationnelle exacte, placeur glouton **entièrement
déterministe** (aucun aléa, aucune horloge), sortie sous forme de `Layout` standard pour que
`src/render/draw.ts` la dessine sans adaptateur.

**Stack :** TypeScript strict, React 18, Zustand, Vitest. `pnpm` uniquement — un hook bloque
npm, npx et yarn.

**Spec :** `docs/superpowers/specs/2026-08-10-blueprints-de-production-design.md`

---

## Structure des fichiers

| fichier | responsabilité |
|---|---|
| `src/prodlayout/frac.ts` | arithmétique rationnelle (créer, ajouter, multiplier, diviser, PPCM) |
| `src/prodlayout/chain.ts` | accès aux données `economy.generated.json` + arbre de chaîne |
| `src/prodlayout/lot.ts` | arrondis, taux d'utilisation, multiplicateur du lot parfait |
| `src/prodlayout/occupancy.ts` | grille d'occupation (libre / bâtiment / route / champ / réservé) |
| `src/prodlayout/roads.ts` | squelette en peigne, adjacence de route, BFS de distance-rue |
| `src/prodlayout/fields.ts` | remplissage des champs, réservation d'aire libre |
| `src/prodlayout/pack.ts` | boîtes candidates, ordre de pose, entrepôt, compaction |
| `src/prodlayout/report.ts` | récapitulatif chiffré |
| `src/prodlayout/index.ts` | `planProductionLayout()` — la seule porte d'entrée |
| `src/persist/blueprints.ts` | bibliothèque locale de blueprints nommés |
| `src/ui/ProdLayoutView.tsx` | la vue à trois colonnes |
| `src/ui/components/BlueprintCanvas.tsx` | rendu du plan via `drawScene` |

`occupancy.ts` est séparé de `roads.ts` (la spec les fusionnait) : la grille d'occupation sert
aussi à `fields.ts` et `pack.ts`, et un module de bas niveau partagé par trois consommateurs
mérite son fichier.

## Trois règles qui traversent tout le plan

1. **Aucun appel à `uid()`** (`src/model/factories.ts`) : il repose sur `Date.now()`, ce qui
   rendrait le test de déterminisme ininstallable. Les identifiants sont `b0`, `b1`, … dans
   l'ordre de pose.
2. **Aucun `Math.random()`, aucune horloge.** Tout balayage a un ordre total explicite.
3. **`pnpm` uniquement.** Tests : `pnpm vitest run <chemin>`. Suite complète : `pnpm test`.

---

### Task 1 : Arithmétique rationnelle

**Fichiers :**
- Créer : `src/prodlayout/frac.ts`
- Test : `src/prodlayout/frac.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/frac.test.ts
import { describe, expect, it } from "vitest";
import { addF, commonMultiplier, divF, frac, mulF, toNumber } from "./frac";

describe("frac — rationnels réduits", () => {
  it("réduit à la création", () => {
    expect(frac(60, 30)).toEqual({ n: 2, d: 1 });
    expect(frac(2, 4)).toEqual({ n: 1, d: 2 });
    expect(frac(0, 5)).toEqual({ n: 0, d: 1 });
  });

  it("refuse un dénominateur nul", () => {
    expect(() => frac(1, 0)).toThrow(/dénominateur/);
  });

  it("ajoute, multiplie et divise sans perte", () => {
    expect(addF(frac(1, 3), frac(1, 6))).toEqual({ n: 1, d: 2 });
    expect(mulF(frac(1, 2), frac(2, 3))).toEqual({ n: 1, d: 3 });
    expect(divF(frac(1, 1), frac(2, 1))).toEqual({ n: 1, d: 2 });
  });

  it("refuse la division par zéro", () => {
    expect(() => divF(frac(1), frac(0))).toThrow(/division/);
  });

  it("convertit en nombre", () => {
    expect(toNumber(frac(1, 4))).toBe(0.25);
  });

  it("commonMultiplier rend le plus petit entier qui rend tout entier", () => {
    // c'est le lot parfait du pain : 1, 1/2, 1 -> ×2
    expect(commonMultiplier([frac(1), frac(1, 2), frac(1)])).toBe(2);
    expect(commonMultiplier([frac(1, 3), frac(1, 4)])).toBe(12);
    expect(commonMultiplier([])).toBe(1);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/frac.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./frac"`.

- [ ] **Étape 3 : écrire l'implémentation minimale**

```ts
// src/prodlayout/frac.ts
/**
 * Arithmétique rationnelle exacte.
 *
 * POURQUOI : les ratios de chaîne se calculent en divisant des entiers (`amount`,
 * `cycleTime`). En virgule flottante, une boulangerie sur trois moulins donne 0,333… et le
 * lot parfait — qui est le PPCM des dénominateurs — devient inatteignable. En rationnel il
 * est exact.
 */

/** Rationnel réduit. `d` est toujours strictement positif. */
export interface Frac {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function frac(n: number, d = 1): Frac {
  if (d === 0) throw new Error("Frac : dénominateur nul");
  const sign = d < 0 ? -1 : 1;
  const g = gcd(Math.abs(n), Math.abs(d)) || 1;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

export const addF = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const mulF = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);

export const divF = (a: Frac, b: Frac): Frac => {
  if (b.n === 0) throw new Error("Frac : division par zéro");
  return frac(a.n * b.d, a.d * b.n);
};

export const toNumber = (a: Frac): number => a.n / a.d;

const lcm = (a: number, b: number): number => (a / (gcd(a, b) || 1)) * b;

/** Plus petit entier k ≥ 1 tel que k·f soit entier pour tout f — le lot parfait. */
export const commonMultiplier = (fs: Frac[]): number =>
  fs.reduce((m, f) => lcm(m, f.d), 1);
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/frac.test.ts`
Attendu : PASS, 6 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/frac.ts src/prodlayout/frac.test.ts && git commit -m "feat(prodlayout): arithmetique rationnelle exacte pour les ratios de chaine"
```

---

### Task 2 : L'arbre de chaîne

**Fichiers :**
- Créer : `src/prodlayout/chain.ts`
- Test : `src/prodlayout/chain.test.ts`

Rappel des données vérifiées : `g3174` Boulangerie romaine (4×5, cycle 60, 1 Pain `2137`,
consomme 1 Farine `2119`), `g3075` Moulin à grains (cycle 30, 1 Farine, consomme 1 Blé `2069`),
`g2693` Ferme de céréales (cycle 60, 1 Blé, 140 cases de champ). Les 151 entrées de
`buildingProd` ont **exactement une sortie et un `cycleTime` non nul** — vérifié.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/chain.test.ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildChain, pickProducer } from "./chain";
import { frac } from "./frac";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("buildChain — le pain romain", () => {
  it("rend 1 boulangerie : 1/2 moulin : 1 ferme", () => {
    const c = buildChain("g3174", 1, lookup);
    expect(c.nodes.map((n) => n.defId)).toEqual(["g3174", "g3075", "g2693"]);
    expect(c.nodes[0].exact).toEqual(frac(1));
    expect(c.nodes[1].exact).toEqual(frac(1, 2));
    expect(c.nodes[2].exact).toEqual(frac(1, 1));
    expect(c.imports).toEqual([]);
    expect(c.gaps).toEqual([]);
  });

  it("met la chaîne à l'échelle linéairement", () => {
    const c = buildChain("g3174", 4, lookup);
    expect(c.nodes[1].exact).toEqual(frac(2));
    expect(c.nodes[2].exact).toEqual(frac(4));
  });

  it("une boulangerie romaine ne tire pas la ferme celtique", () => {
    const ids = buildChain("g3174", 1, lookup).nodes.map((n) => n.defId);
    expect(ids).not.toContain("g5972"); // ferme de céréales celtique
    expect(ids).not.toContain("g5967"); // moulin à âne celtique
  });

  it("un intrant marqué importé sort des comptes et entre au manifeste", () => {
    const c = buildChain("g3174", 1, lookup, new Set(["2119"])); // Farine importée
    expect(c.nodes.map((n) => n.defId)).toEqual(["g3174"]);
    expect(c.imports).toEqual([{ good: "2119", ratePerMin: 1, reason: "demandé" }]);
  });

  it("signale les producteurs qui exigent un emplacement de terrain", () => {
    const mine = catalog.find((d) => d.slotType === "mountain" && d.production);
    expect(mine).toBeDefined();
    const c = buildChain(mine!.id, 1, lookup);
    expect(c.blocked.map((b) => b.defId)).toContain(mine!.id);
    expect(c.gaps.join(" ")).toMatch(/emplacement/);
  });
});

describe("pickProducer", () => {
  it("préfère la région demandée", () => {
    expect(pickProducer("2069", "Roman")).toBe("g2693");
    expect(pickProducer("2069", "Celtic")).toBe("g5972");
  });

  it("rend undefined pour un bien sans producteur", () => {
    expect(pickProducer("bien-inexistant")).toBeUndefined();
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/chain.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./chain"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/chain.ts
import rawEconomy from "../data/economy.generated.json";
import type { BuildingDef } from "../model/types";
import { addF, divF, frac, mulF, toNumber, type Frac } from "./frac";

/**
 * ARBRE DE CHAÎNE — la seule porte de ce module vers les données économiques.
 *
 * Deux indexations coexistent dans le projet et ne doivent jamais se croiser :
 * `economy.buildingProd` désigne les biens par GUID (`2137` = Pain), le catalogue par nom
 * d'affichage. Ici c'est le GUID qui fait foi ; le catalogue n'est consulté que pour la
 * géométrie et le `slotType`.
 */

interface RawProd {
  cycleTime: number;
  inputs: { good: string; amount: number }[];
  outputs: { good: string; amount: number }[];
}

interface RawEconomy {
  producers: Record<string, string[]>;
  buildingProd: Record<string, RawProd>;
  buildingWorkforce: Record<string, { tier: string; amount: number }[]>;
  buildingUpkeep: Record<string, number>;
  buildingRegion: Record<string, string>;
  goodNames: Record<string, string>;
  goodPrices: Record<string, number>;
  tiers: { guid: string; name: string }[];
}

export const eco = rawEconomy as unknown as RawEconomy;

export type Lookup = (id: string) => BuildingDef | undefined;

export interface ChainNode {
  defId: string;
  /** GUID du bien que ce bâtiment fournit à la chaîne. */
  good: string;
  /** Compte EXACT, en rationnel. Jamais arrondi avant l'affichage. */
  exact: Frac;
  /** Débit d'UNE copie, en unités par minute. */
  ratePerMin: Frac;
  /** Profondeur dans l'arbre (0 = bâtiment cible). */
  depth: number;
}

export type ImportReason = "demandé" | "sans-producteur" | "cycle";

export interface ChainImport {
  good: string;
  ratePerMin: number;
  reason: ImportReason;
}

export interface ChainBlocked {
  defId: string;
  slotType: string;
  good: string;
}

export interface ChainResult {
  targetDefId: string;
  targetGood: string;
  nodes: ChainNode[];
  imports: ChainImport[];
  /** Producteurs exigeant un emplacement de terrain — non posables hors terrain. */
  blocked: ChainBlocked[];
  gaps: string[];
}

/** Débit d'un bâtiment pour un bien, en unités par minute. */
export const ratePerMin = (p: RawProd, good: string): Frac => {
  const out = p.outputs.find((o) => o.good === good);
  if (!out || !p.cycleTime) return frac(0);
  return frac(out.amount * 60, p.cycleTime);
};

/** Producteur d'un bien, en préférant la région demandée. */
export function pickProducer(good: string, region?: string): string | undefined {
  const list = eco.producers[good] ?? [];
  if (!list.length) return undefined;
  return (region ? list.find((id) => eco.buildingRegion[id] === region) : undefined) ?? list[0];
}

export const goodName = (good: string): string => eco.goodNames[good] ?? good;

export function buildChain(
  targetDefId: string,
  count: number,
  lookup: Lookup,
  imported: ReadonlySet<string> = new Set(),
): ChainResult {
  const targetProd = eco.buildingProd[targetDefId];
  if (!targetProd) throw new Error(`${targetDefId} ne produit rien.`);
  const targetGood = targetProd.outputs[0].good;
  const region = eco.buildingRegion[targetDefId];

  const gaps: string[] = [];
  const blocked: ChainBlocked[] = [];
  const order: string[] = [];
  const acc = new Map<string, ChainNode>();
  const impAcc = new Map<string, ChainImport>();

  const addImport = (good: string, rate: number, reason: ImportReason) => {
    const cur = impAcc.get(good);
    if (cur) cur.ratePerMin += rate;
    else impAcc.set(good, { good, ratePerMin: rate, reason });
  };

  const visit = (defId: string, good: string, copies: Frac, depth: number, stack: Set<string>) => {
    const p = eco.buildingProd[defId];
    if (!p) return;
    const seen = acc.get(defId);
    if (seen) {
      seen.exact = addF(seen.exact, copies);
      seen.depth = Math.max(seen.depth, depth);
    } else {
      acc.set(defId, { defId, good, exact: copies, ratePerMin: ratePerMin(p, good), depth });
      order.push(defId);
      const def = lookup(defId);
      if (def?.slotType) {
        blocked.push({ defId, slotType: def.slotType, good });
        gaps.push(
          `${def.name} : exige un emplacement « ${def.slotType} », impossible hors terrain — `
          + `marquer « ${goodName(good)} » comme importé`,
        );
      }
    }
    stack.add(defId);
    for (const inp of p.inputs) {
      const need = mulF(copies, frac(inp.amount * 60, p.cycleTime));
      const rate = toNumber(need);
      if (rate <= 0) continue;
      if (imported.has(inp.good)) {
        addImport(inp.good, rate, "demandé");
        continue;
      }
      const src = pickProducer(inp.good, region);
      if (!src) {
        addImport(inp.good, rate, "sans-producteur");
        continue;
      }
      if (stack.has(src)) {
        addImport(inp.good, rate, "cycle");
        gaps.push(`Cycle de production sur ${goodName(inp.good)} — intrant traité comme importé`);
        continue;
      }
      const r = ratePerMin(eco.buildingProd[src], inp.good);
      if (r.n <= 0) {
        addImport(inp.good, rate, "sans-producteur");
        continue;
      }
      visit(src, inp.good, divF(need, r), depth + 1, stack);
    }
    stack.delete(defId);
  };

  visit(targetDefId, targetGood, frac(count), 0, new Set());

  return {
    targetDefId,
    targetGood,
    nodes: order.map((id) => acc.get(id)!),
    imports: [...impAcc.values()],
    blocked,
    gaps,
  };
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/chain.test.ts`
Attendu : PASS, 7 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/chain.ts src/prodlayout/chain.test.ts && git commit -m "feat(prodlayout): arbre de chaine en ratios exacts, region respectee"
```

---

### Task 3 : Arrondis et lot parfait

**Fichiers :**
- Créer : `src/prodlayout/lot.ts`
- Test : `src/prodlayout/lot.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/lot.test.ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildChain } from "./chain";
import { buildOrder } from "./lot";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("buildOrder — arrondis et lot parfait", () => {
  it("arrondit au supérieur et chiffre la sous-utilisation", () => {
    const o = buildOrder(buildChain("g3174", 1, lookup));
    const mill = o.items.find((i) => i.defId === "g3075")!;
    expect(mill.placed).toBe(1);
    expect(mill.utilisation).toBe(0.5);
  });

  it("le lot parfait du pain vaut 2", () => {
    expect(buildOrder(buildChain("g3174", 1, lookup)).perfectMultiplier).toBe(2);
  });

  it("un lot déjà parfait rend un multiplicateur de 1 et aucun gaspillage", () => {
    const o = buildOrder(buildChain("g3174", 2, lookup));
    expect(o.perfectMultiplier).toBe(1);
    for (const i of o.items) expect(i.utilisation).toBe(1);
  });

  it("le total de copies posées est celui de la commande", () => {
    const o = buildOrder(buildChain("g3174", 2, lookup));
    expect(o.items.map((i) => [i.defId, i.placed])).toEqual([
      ["g3174", 2], ["g3075", 1], ["g2693", 2],
    ]);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/lot.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./lot"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/lot.ts
import type { ChainResult } from "./chain";
import { commonMultiplier, toNumber, type Frac } from "./frac";

/**
 * DU RATIO EXACT AU PLAN POSABLE.
 *
 * On ne pose pas un demi-moulin : le compte exact s'arrondit au supérieur, et l'écart
 * devient une SOUS-UTILISATION qu'il faut afficher. Le lot parfait — le PPCM des
 * dénominateurs — est le plus petit multiple de la commande où cet écart disparaît.
 */

export interface OrderItem {
  defId: string;
  exact: Frac;
  /** Copies effectivement posées : `ceil(exact)`. */
  placed: number;
  /** Part de la capacité posée réellement employée, dans ]0..1]. */
  utilisation: number;
}

export interface Order {
  items: OrderItem[];
  /** Multiplicateur de la commande annulant tout gaspillage. 1 = déjà parfait. */
  perfectMultiplier: number;
}

export function buildOrder(chain: ChainResult): Order {
  const items = chain.nodes.map((n) => {
    const exactN = toNumber(n.exact);
    const placed = Math.ceil(exactN);
    return { defId: n.defId, exact: n.exact, placed, utilisation: placed > 0 ? exactN / placed : 0 };
  });
  return { items, perfectMultiplier: commonMultiplier(chain.nodes.map((n) => n.exact)) };
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/lot.test.ts`
Attendu : PASS, 4 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/lot.ts src/prodlayout/lot.test.ts && git commit -m "feat(prodlayout): arrondis, sous-utilisation et lot parfait"
```

---

### Task 4 : Grille d'occupation

**Fichiers :**
- Créer : `src/prodlayout/occupancy.ts`
- Test : `src/prodlayout/occupancy.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/occupancy.test.ts
import { describe, expect, it } from "vitest";
import { at, BUILDING, fill, fits, FREE, makeOcc, ROAD, setAt } from "./occupancy";

describe("occupancy", () => {
  it("naît entièrement libre", () => {
    const o = makeOcc(4, 3);
    expect(o.cell.length).toBe(12);
    expect(at(o, 0, 0)).toBe(FREE);
  });

  it("rend -1 hors limites", () => {
    const o = makeOcc(4, 3);
    expect(at(o, -1, 0)).toBe(-1);
    expect(at(o, 4, 0)).toBe(-1);
    expect(at(o, 0, 3)).toBe(-1);
  });

  it("fits refuse le débordement et le chevauchement", () => {
    const o = makeOcc(4, 4);
    expect(fits(o, 0, 0, 4, 4)).toBe(true);
    expect(fits(o, 1, 0, 4, 4)).toBe(false);
    setAt(o, 2, 2, BUILDING);
    expect(fits(o, 0, 0, 4, 4)).toBe(false);
    expect(fits(o, 0, 0, 2, 2)).toBe(true);
  });

  it("fill marque tout le rectangle", () => {
    const o = makeOcc(4, 4);
    fill(o, 1, 1, 2, 2, ROAD);
    expect(at(o, 1, 1)).toBe(ROAD);
    expect(at(o, 2, 2)).toBe(ROAD);
    expect(at(o, 3, 3)).toBe(FREE);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/occupancy.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./occupancy"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/occupancy.ts
/**
 * Grille d'occupation du blueprint. Un octet par case, pas de structure par case : le
 * placeur essaie une douzaine de boîtes et rejoue chacune entièrement, donc l'allocation
 * doit rester triviale.
 */

export const FREE = 0;
export const BUILDING = 1;
export const ROAD = 2;
export const FIELD = 3;
/** Aire libre réservée autour d'un bâtiment à `freeArea` : traversable, jamais bâtie. */
export const RESERVED = 4;

export interface Occ {
  w: number;
  h: number;
  cell: Uint8Array;
}

export const makeOcc = (w: number, h: number): Occ => ({ w, h, cell: new Uint8Array(w * h) });

export const inBox = (o: Occ, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < o.w && y < o.h;

/** Contenu d'une case, ou -1 hors limites. */
export const at = (o: Occ, x: number, y: number): number =>
  inBox(o, x, y) ? o.cell[y * o.w + x] : -1;

export const setAt = (o: Occ, x: number, y: number, v: number): void => {
  if (inBox(o, x, y)) o.cell[y * o.w + x] = v;
};

/** Le rectangle tient-il entièrement dans la boîte, sur des cases libres ? */
export function fits(o: Occ, x: number, y: number, w: number, h: number): boolean {
  if (x < 0 || y < 0 || x + w > o.w || y + h > o.h) return false;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) if (o.cell[(y + j) * o.w + x + i] !== FREE) return false;
  }
  return true;
}

export function fill(o: Occ, x: number, y: number, w: number, h: number, v: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setAt(o, x + i, y + j, v);
}

/** Nombre de cases portant une valeur donnée. */
export function count(o: Occ, v: number): number {
  let n = 0;
  for (let i = 0; i < o.cell.length; i++) if (o.cell[i] === v) n++;
  return n;
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/occupancy.test.ts`
Attendu : PASS, 4 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/occupancy.ts src/prodlayout/occupancy.test.ts && git commit -m "feat(prodlayout): grille d'occupation du blueprint"
```

---

### Task 5 : Squelette routier et distance-rue

**Fichiers :**
- Créer : `src/prodlayout/roads.ts`
- Test : `src/prodlayout/roads.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/roads.test.ts
import { describe, expect, it } from "vitest";
import { at, BUILDING, fill, makeOcc, ROAD } from "./occupancy";
import { adjacentRoads, paintSkeleton, roadDistances, touchesRoad } from "./roads";

describe("paintSkeleton", () => {
  it("trace une épine continue et des branches au pas donné", () => {
    const o = makeOcc(11, 9);
    paintSkeleton(o, 4, 5);
    for (let x = 0; x < 11; x++) expect(at(o, x, 4)).toBe(ROAD);
    for (let y = 0; y < 9; y++) {
      expect(at(o, 0, y)).toBe(ROAD);
      expect(at(o, 5, y)).toBe(ROAD);
      expect(at(o, 10, y)).toBe(ROAD);
    }
    expect(at(o, 3, 0)).toBe(0);
  });

  it("n'écrase jamais une case déjà occupée", () => {
    const o = makeOcc(11, 9);
    fill(o, 4, 3, 3, 3, BUILDING);
    paintSkeleton(o, 4, 5);
    expect(at(o, 5, 4)).toBe(BUILDING);
    expect(at(o, 3, 4)).toBe(ROAD);
  });
});

describe("adjacence et distance-rue", () => {
  it("touchesRoad ne voit que les quatre côtés, pas les diagonales", () => {
    const o = makeOcc(6, 6);
    fill(o, 0, 0, 1, 1, ROAD);
    expect(touchesRoad(o, 1, 1, 2, 2)).toBe(false); // en diagonale de la route
    expect(touchesRoad(o, 1, 0, 2, 2)).toBe(true);
  });

  it("adjacentRoads rend les indices des routes contiguës", () => {
    const o = makeOcc(6, 6);
    fill(o, 0, 0, 6, 1, ROAD);
    expect(adjacentRoads(o, 2, 1, 2, 2).sort()).toEqual([2, 3]);
  });

  it("le BFS compte LE LONG des routes, pas à vol d'oiseau", () => {
    // U de routes : (0,0)->(0,4)->(4,4)->(4,0). Les deux extrémités sont à 4 cases
    // à vol d'oiseau mais à 12 pas le long de la voirie.
    const o = makeOcc(5, 5);
    fill(o, 0, 0, 1, 5, ROAD);
    fill(o, 0, 4, 5, 1, ROAD);
    fill(o, 4, 0, 1, 5, ROAD);
    const d = roadDistances(o, [0]); // graine : (0,0), distance 1
    expect(d[0]).toBe(1);
    expect(d[4 * 5 + 0]).toBe(5);
    expect(d[0 * 5 + 4]).toBe(13);
  });

  it("laisse -1 sur ce que la voirie n'atteint pas", () => {
    const o = makeOcc(5, 5);
    fill(o, 0, 0, 1, 2, ROAD);
    fill(o, 4, 4, 1, 1, ROAD);
    const d = roadDistances(o, [0]);
    expect(d[4 * 5 + 4]).toBe(-1);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/roads.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./roads"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/roads.ts
import { at, FREE, ROAD, setAt, type Occ } from "./occupancy";

/**
 * SQUELETTE ET PORTÉE.
 *
 * En jeu, un producteur n'expédie rien si aucun entrepôt n'est à `transporterRange` en
 * DISTANCE-RUE — le long de la voirie, pas à vol d'oiseau. Un plan qui ignore cette
 * distinction produit un joli tas de bâtiments qui ne rapporte rien.
 */

/**
 * Épine dorsale horizontale à `spineY` + branches verticales tous les `pitch`, en
 * commençant à `x0`. Ne peint que les cases LIBRES : l'entrepôt est déjà posé quand cette
 * fonction s'exécute, et une branche qui le rencontre s'arrête contre lui — ce qui est
 * exactement l'accès route dont il a besoin.
 */
export function paintSkeleton(o: Occ, spineY: number, pitch: number, x0 = 0): void {
  const step = Math.max(2, pitch);
  for (let x = 0; x < o.w; x++) if (at(o, x, spineY) === FREE) setAt(o, x, spineY, ROAD);
  for (let x = x0; x < o.w; x += step) {
    for (let y = 0; y < o.h; y++) if (at(o, x, y) === FREE) setAt(o, x, y, ROAD);
  }
  // la dernière colonne, si le pas ne tombe pas dessus : sans elle, la bande de droite
  // n'a de route que d'un côté et les bâtiments profonds n'y accèdent plus.
  const last = o.w - 1;
  if ((last - x0) % step !== 0) {
    for (let y = 0; y < o.h; y++) if (at(o, last, y) === FREE) setAt(o, last, y, ROAD);
  }
}

/** Indices des cases ROUTE contiguës aux quatre côtés d'un rectangle. */
export function adjacentRoads(o: Occ, x: number, y: number, w: number, h: number): number[] {
  const out = new Set<number>();
  const test = (cx: number, cy: number) => {
    if (at(o, cx, cy) === ROAD) out.add(cy * o.w + cx);
  };
  for (let i = 0; i < w; i++) {
    test(x + i, y - 1);
    test(x + i, y + h);
  }
  for (let j = 0; j < h; j++) {
    test(x - 1, y + j);
    test(x + w, y + j);
  }
  return [...out];
}

export const touchesRoad = (o: Occ, x: number, y: number, w: number, h: number): boolean =>
  adjacentRoads(o, x, y, w, h).length > 0;

/**
 * Distance-rue depuis un ensemble de graines. Les graines sont à **1**, comme la
 * convention du reste du projet (une case de route contiguë à l'entrepôt est à un pas).
 * Les cases non-route et les inatteignables restent à -1.
 */
export function roadDistances(o: Occ, seeds: number[]): Int32Array {
  const dist = new Int32Array(o.w * o.h).fill(-1);
  let frontier: number[] = [];
  for (const s of seeds) {
    if (o.cell[s] !== ROAD || dist[s] !== -1) continue;
    dist[s] = 1;
    frontier.push(s);
  }
  let d = 1;
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) {
      const x = c % o.w;
      const y = (c / o.w) | 0;
      const nbs = [
        x > 0 ? c - 1 : -1,
        x < o.w - 1 ? c + 1 : -1,
        y > 0 ? c - o.w : -1,
        y < o.h - 1 ? c + o.w : -1,
      ];
      for (const nb of nbs) {
        if (nb < 0 || o.cell[nb] !== ROAD || dist[nb] !== -1) continue;
        dist[nb] = d + 1;
        next.push(nb);
      }
    }
    frontier = next;
    d++;
  }
  return dist;
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/roads.test.ts`
Attendu : PASS, 5 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/roads.ts src/prodlayout/roads.test.ts && git commit -m "feat(prodlayout): squelette en peigne et BFS de distance-rue"
```

---

### Task 6 : Champs et aires libres

**Fichiers :**
- Créer : `src/prodlayout/fields.ts`
- Test : `src/prodlayout/fields.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/fields.test.ts
import { describe, expect, it } from "vitest";
import { at, BUILDING, fill, FIELD, makeOcc, RESERVED } from "./occupancy";
import { fillFields, reserveFreeArea } from "./fields";

describe("fillFields", () => {
  it("atteint le quota et marque les cases", () => {
    const o = makeOcc(20, 20);
    fill(o, 8, 8, 4, 3, BUILDING);
    const tiles = fillFields(o, { x: 8, y: 8, w: 4, h: 3, radius: 6, tiles: 30, fieldType: "bl", ownerUid: "b0" });
    expect(tiles.length).toBe(30);
    expect(at(o, tiles[0].x, tiles[0].y)).toBe(FIELD);
    for (const t of tiles) expect(t.ownerUid).toBe("b0");
  });

  it("ne dépasse jamais le rayon", () => {
    const o = makeOcc(40, 40);
    fill(o, 20, 20, 4, 3, BUILDING);
    const tiles = fillFields(o, { x: 20, y: 20, w: 4, h: 3, radius: 3, tiles: 999, fieldType: "bl", ownerUid: "b0" });
    for (const t of tiles) {
      const dx = Math.max(20 - t.x, 0, t.x - 23);
      const dy = Math.max(20 - t.y, 0, t.y - 22);
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(3);
    }
  });

  it("deux fermes serrées ne se volent pas leurs champs", () => {
    const o = makeOcc(20, 20);
    fill(o, 2, 2, 4, 3, BUILDING);
    fill(o, 8, 2, 4, 3, BUILDING);
    const a = fillFields(o, { x: 2, y: 2, w: 4, h: 3, radius: 8, tiles: 40, fieldType: "bl", ownerUid: "b0" });
    const b = fillFields(o, { x: 8, y: 2, w: 4, h: 3, radius: 8, tiles: 40, fieldType: "bl", ownerUid: "b1" });
    const keys = new Set([...a, ...b].map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(a.length + b.length);
  });

  it("rend moins que le quota quand la place manque, sans boucler", () => {
    const o = makeOcc(6, 6);
    fill(o, 0, 0, 4, 3, BUILDING);
    const tiles = fillFields(o, { x: 0, y: 0, w: 4, h: 3, radius: 20, tiles: 999, fieldType: "bl", ownerUid: "b0" });
    expect(tiles.length).toBe(36 - 12);
  });
});

describe("reserveFreeArea", () => {
  it("réserve les cases libres du rayon et rend leur compte", () => {
    const o = makeOcc(20, 20);
    fill(o, 9, 9, 2, 2, BUILDING);
    const n = reserveFreeArea(o, 9, 9, 2, 2, 3);
    expect(n).toBeGreaterThan(0);
    expect(at(o, 9, 6)).toBe(RESERVED);
    expect(at(o, 9, 9)).toBe(BUILDING);
    expect(at(o, 0, 0)).toBe(0);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/fields.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./fields"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/fields.ts
import { at, FIELD, FREE, RESERVED, setAt, type Occ } from "./occupancy";

/**
 * CHAMPS ET AIRES LIBRES — les deux exigences de surface que le catalogue déclare.
 *
 * `field.tiles` : une ferme de céréales veut 140 cases de champ dans son rayon, sans quoi
 * elle tourne à rendement partiel. `freeArea` : un bûcheron produit en proportion des cases
 * LIBRES autour de lui, donc le serrer l'étrangle. Ni l'un ni l'autre n'exige de route.
 *
 * La distance est L∞ depuis l'emprise (« à N cases du bâtiment »), et le remplissage se
 * fait en anneaux croissants pour que les cases proches partent en premier — deux fermes
 * voisines se partagent alors le terrain au lieu que la première rafle tout au loin.
 */

export interface FarmClaim {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  tiles: number;
  fieldType: string;
  ownerUid: string;
}

export interface FieldCell {
  x: number;
  y: number;
  ownerUid: string;
  fieldType: string;
}

/** Distance L∞ d'une case au rectangle. 0 si elle est dedans. */
const distToRect = (cx: number, cy: number, x: number, y: number, w: number, h: number): number =>
  Math.max(Math.max(x - cx, 0, cx - (x + w - 1)), Math.max(y - cy, 0, cy - (y + h - 1)));

export function fillFields(o: Occ, c: FarmClaim): FieldCell[] {
  const out: FieldCell[] = [];
  for (let ring = 1; ring <= c.radius && out.length < c.tiles; ring++) {
    const x0 = c.x - ring;
    const y0 = c.y - ring;
    const x1 = c.x + c.w - 1 + ring;
    const y1 = c.y + c.h - 1 + ring;
    for (let cy = y0; cy <= y1 && out.length < c.tiles; cy++) {
      for (let cx = x0; cx <= x1 && out.length < c.tiles; cx++) {
        if (distToRect(cx, cy, c.x, c.y, c.w, c.h) !== ring) continue;
        if (at(o, cx, cy) !== FREE) continue;
        setAt(o, cx, cy, FIELD);
        out.push({ x: cx, y: cy, ownerUid: c.ownerUid, fieldType: c.fieldType });
      }
    }
  }
  return out;
}

/**
 * Réserve les cases libres à `radius` du bâtiment : plus rien ne s'y bâtira. Rend le
 * nombre de cases réservées, pour que l'appelant sache si l'aire exigée est atteinte.
 */
export function reserveFreeArea(
  o: Occ, x: number, y: number, w: number, h: number, radius: number,
): number {
  let n = 0;
  for (let cy = y - radius; cy <= y + h - 1 + radius; cy++) {
    for (let cx = x - radius; cx <= x + w - 1 + radius; cx++) {
      if (distToRect(cx, cy, x, y, w, h) > radius) continue;
      if (at(o, cx, cy) !== FREE) continue;
      setAt(o, cx, cy, RESERVED);
      n++;
    }
  }
  return n;
}

/** Cases libres disponibles à `radius` du rectangle — sonde avant réservation. */
export function freeAround(
  o: Occ, x: number, y: number, w: number, h: number, radius: number,
): number {
  let n = 0;
  for (let cy = y - radius; cy <= y + h - 1 + radius; cy++) {
    for (let cx = x - radius; cx <= x + w - 1 + radius; cx++) {
      if (distToRect(cx, cy, x, y, w, h) > radius) continue;
      if (at(o, cx, cy) === FREE) n++;
    }
  }
  return n;
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/fields.test.ts`
Attendu : PASS, 5 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/fields.ts src/prodlayout/fields.test.ts && git commit -m "feat(prodlayout): remplissage des champs en anneaux, reservation d'aire libre"
```

---

### Task 7 : Le placeur

**Fichiers :**
- Créer : `src/prodlayout/pack.ts`
- Test : `src/prodlayout/pack.test.ts`

C'est le cœur. Quatre invariants sont testés, dont le déterminisme — le plus rentable des
quatre, parce que sans lui aucune comparaison entre deux versions du placeur n'a de sens.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/pack.test.ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { adjacentRoads, roadDistances } from "./roads";
import { at, BUILDING, fill, makeOcc } from "./occupancy";
import { packBlueprint } from "./pack";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

// le lot parfait du pain romain : 2 boulangeries, 1 moulin, 2 fermes
const BREAD = [
  { defId: "g3174", count: 2 },
  { defId: "g3075", count: 1 },
  { defId: "g2693", count: 2 },
];

describe("packBlueprint — invariants", () => {
  const r = packBlueprint({ items: BREAD, warehouseDefId: "g3310", lookup });

  it("pose tout ce qui a été demandé, plus l'entrepôt", () => {
    expect(r.placements.filter((p) => p.defId === "g3174").length).toBe(2);
    expect(r.placements.filter((p) => p.defId === "g3075").length).toBe(1);
    expect(r.placements.filter((p) => p.defId === "g2693").length).toBe(2);
    expect(r.placements.filter((p) => p.defId === "g3310").length).toBeGreaterThanOrEqual(1);
  });

  it("aucun chevauchement entre emprises, champs et routes", () => {
    const o = makeOcc(r.w, r.h);
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      const w = p.rot === 90 ? d.size.h : d.size.w;
      const h = p.rot === 90 ? d.size.w : d.size.h;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          expect(at(o, p.x + i, p.y + j)).toBe(0);
          fill(o, p.x + i, p.y + j, 1, 1, BUILDING);
        }
      }
    }
    for (const f of [...r.fields, ...r.roads]) {
      expect(at(o, f.x, f.y)).toBe(0);
      fill(o, f.x, f.y, 1, 1, BUILDING);
    }
  });

  it("tout bâtiment needsRoad touche une route", () => {
    const o = makeOcc(r.w, r.h);
    for (const road of r.roads) fill(o, road.x, road.y, 1, 1, 2);
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      if (!d.needsRoad) continue;
      const w = p.rot === 90 ? d.size.h : d.size.w;
      const h = p.rot === 90 ? d.size.w : d.size.h;
      expect(adjacentRoads(o, p.x, p.y, w, h).length).toBeGreaterThan(0);
    }
  });

  it("tout producteur est sous son transporterRange en distance-rue", () => {
    const o = makeOcc(r.w, r.h);
    for (const road of r.roads) fill(o, road.x, road.y, 1, 1, 2);
    const seeds: number[] = [];
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      if (!d.roadRoot) continue;
      seeds.push(...adjacentRoads(o, p.x, p.y, d.size.w, d.size.h));
    }
    const dist = roadDistances(o, seeds);
    for (const p of r.placements) {
      const d = lookup(p.defId)!;
      if (!d.production) continue;
      const w = p.rot === 90 ? d.size.h : d.size.w;
      const h = p.rot === 90 ? d.size.w : d.size.h;
      const best = adjacentRoads(o, p.x, p.y, w, h)
        .map((c) => dist[c])
        .filter((v) => v >= 0);
      expect(best.length).toBeGreaterThan(0);
      expect(Math.min(...best)).toBeLessThanOrEqual(d.transporterRange ?? 30);
    }
  });

  it("deux appels identiques rendent un plan identique", () => {
    const a = packBlueprint({ items: BREAD, warehouseDefId: "g3310", lookup });
    const b = packBlueprint({ items: BREAD, warehouseDefId: "g3310", lookup });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("les fermes atteignent leur quota de champ", () => {
    const perFarm = new Map<string, number>();
    for (const f of r.fields) perFarm.set(f.ownerUid, (perFarm.get(f.ownerUid) ?? 0) + 1);
    const quota = lookup("g2693")!.field!.tiles;
    expect([...perFarm.values()].every((n) => n === quota)).toBe(true);
    expect(perFarm.size).toBe(2);
    expect(r.gaps).toEqual([]);
  });

  it("l'efficacité est une fraction crédible de la boîte", () => {
    expect(r.efficiency).toBeGreaterThan(0.5);
    expect(r.efficiency).toBeLessThanOrEqual(1);
    expect(r.tiles.buildings + r.tiles.fields + r.tiles.roads).toBeLessThanOrEqual(r.w * r.h);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/pack.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./pack"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/pack.ts
import type { BuildingDef } from "../model/types";
import type { Lookup } from "./chain";
import { fillFields, freeAround, reserveFreeArea, type FieldCell } from "./fields";
import { BUILDING, count, FIELD, fill, fits, FREE, makeOcc, ROAD, type Occ } from "./occupancy";
import { adjacentRoads, paintSkeleton, roadDistances } from "./roads";

/**
 * LE PLACEUR — glouton, à ordre total, sans une once d'aléa.
 *
 * On essaie une douzaine de boîtes et on rejoue chacune entièrement. Le déterminisme n'est
 * pas une coquetterie : c'est ce qui rend le module MESURABLE. Sans lui, « la version B
 * fait mieux que A » ne serait que du bruit de placement, et le projet a déjà payé pour
 * apprendre à ne pas confondre les deux.
 *
 * Le recuit simulé est écarté : la géométrie plafonne à +3 % sur ce projet quand le choix
 * de la recette vaut ×1,48. Payer l'indéterminisme pour ce gain-là serait un mauvais
 * échange.
 */

export type Rot0or90 = 0 | 90;

export interface Placement {
  uid: string;
  defId: string;
  x: number;
  y: number;
  rot: Rot0or90;
}

export interface PackInput {
  /** Bâtiments à poser, hors entrepôt. */
  items: { defId: string; count: number }[];
  warehouseDefId: string;
  lookup: Lookup;
}

export interface PackResult {
  w: number;
  h: number;
  placements: Placement[];
  roads: { x: number; y: number }[];
  fields: FieldCell[];
  tiles: { buildings: number; fields: number; roads: number };
  efficiency: number;
  gaps: string[];
}

/** Rapports largeur/hauteur essayés, puis gonflements de la surface utile. */
const RATIOS: [number, number][] = [[1, 1], [4, 3], [3, 2], [2, 1]];
const INFLATIONS = [1.15, 1.3, 1.5];
const DEFAULT_RANGE = 30;

const sizeOf = (d: BuildingDef, rot: Rot0or90) =>
  rot === 90 ? { w: d.size.h, h: d.size.w } : { w: d.size.w, h: d.size.h };

/** Groupe de pose : plus le nombre est petit, plus le bâtiment est contraint. */
const groupOf = (d: BuildingDef): number => (d.freeArea ? 0 : d.field ? 1 : 2);

/** Une copie à poser, dans l'ordre total de pose. */
interface Copy {
  defId: string;
  def: BuildingDef;
  group: number;
}

function expandCopies(input: PackInput): Copy[] {
  const copies: Copy[] = [];
  for (const it of input.items) {
    const def = input.lookup(it.defId);
    if (!def) continue;
    for (let i = 0; i < it.count; i++) copies.push({ defId: it.defId, def, group: groupOf(def) });
  }
  // ordre TOTAL : groupe, puis emprise décroissante, puis defId — aucune ambiguïté.
  copies.sort((a, b) =>
    a.group - b.group
    || b.def.size.w * b.def.size.h - a.def.size.w * a.def.size.h
    || a.defId.localeCompare(b.defId));
  return copies;
}

/** Surface utile estimée : emprises + champs + aires libres exigées. */
function usefulArea(copies: Copy[], wh: BuildingDef): number {
  let s = wh.size.w * wh.size.h;
  for (const c of copies) {
    s += c.def.size.w * c.def.size.h;
    s += c.def.field?.tiles ?? 0;
    s += c.def.freeArea?.area ?? 0;
  }
  return s;
}

interface Attempt {
  occ: Occ;
  placements: Placement[];
  fields: FieldCell[];
  gaps: string[];
}

/** Première position valide, en balayage haut-gauche → bas-droite, rotations 0 puis 90. */
function findSpot(
  occ: Occ, def: BuildingDef, needRoad: boolean,
): { x: number; y: number; rot: Rot0or90 } | null {
  const rots: Rot0or90[] = def.rotatable && def.size.w !== def.size.h ? [0, 90] : [0];
  for (let y = 0; y < occ.h; y++) {
    for (let x = 0; x < occ.w; x++) {
      for (const rot of rots) {
        const { w, h } = sizeOf(def, rot);
        if (!fits(occ, x, y, w, h)) continue;
        if (needRoad && adjacentRoads(occ, x, y, w, h).length === 0) continue;
        if (def.freeArea && freeAround(occ, x, y, w, h, def.freeArea.radius) < def.freeArea.area) continue;
        return { x, y, rot };
      }
    }
  }
  return null;
}

/** Cases de route contiguës à tous les entrepôts posés. */
function warehouseSeeds(occ: Occ, placements: Placement[], lookup: Lookup): number[] {
  const seeds: number[] = [];
  for (const p of placements) {
    const d = lookup(p.defId);
    if (!d?.roadRoot) continue;
    const { w, h } = sizeOf(d, p.rot);
    seeds.push(...adjacentRoads(occ, p.x, p.y, w, h));
  }
  return seeds;
}

/** Producteurs hors de portée d'un entrepôt, en distance-rue. */
function outOfRange(occ: Occ, placements: Placement[], lookup: Lookup): Placement[] {
  const dist = roadDistances(occ, warehouseSeeds(occ, placements, lookup));
  const bad: Placement[] = [];
  for (const p of placements) {
    const d = lookup(p.defId);
    if (!d?.production) continue;
    const { w, h } = sizeOf(d, p.rot);
    const reach = adjacentRoads(occ, p.x, p.y, w, h).map((c) => dist[c]).filter((v) => v >= 0);
    const best = reach.length ? Math.min(...reach) : Infinity;
    if (best > (d.transporterRange ?? DEFAULT_RANGE)) bad.push(p);
  }
  return bad;
}

function tryBox(input: PackInput, copies: Copy[], w: number, h: number): Attempt | null {
  const wh = input.lookup(input.warehouseDefId);
  if (!wh) return null;
  const occ = makeOcc(w, h);
  const placements: Placement[] = [];
  const fields: FieldCell[] = [];
  const gaps: string[] = [];
  let nextUid = 0;

  // 1. l'entrepôt, ancre de la portée de charrette
  const wx = Math.floor((w - wh.size.w) / 2);
  const wy = Math.floor((h - wh.size.h) / 2);
  if (wx < 0 || wy < 0 || wy + wh.size.h >= h) return null;
  fill(occ, wx, wy, wh.size.w, wh.size.h, BUILDING);
  placements.push({ uid: `b${nextUid++}`, defId: wh.id, x: wx, y: wy, rot: 0 });

  // 2. le squelette : épine juste sous l'entrepôt, qui le longe donc sans le couper
  const deepest = copies.reduce((m, c) => Math.max(m, c.def.size.w, c.def.size.h), 1);
  paintSkeleton(occ, wy + wh.size.h, 2 * deepest + 1);

  // 3..5. les copies, du plus contraint au plus libre
  for (const c of copies) {
    const spot = findSpot(occ, c.def, c.def.needsRoad);
    if (!spot) return null; // cette boîte ne convient pas — on essaie la suivante
    const { w: cw, h: ch } = sizeOf(c.def, spot.rot);
    fill(occ, spot.x, spot.y, cw, ch, BUILDING);
    const uid = `b${nextUid++}`;
    placements.push({ uid, defId: c.defId, x: spot.x, y: spot.y, rot: spot.rot });
    if (c.def.freeArea) reserveFreeArea(occ, spot.x, spot.y, cw, ch, c.def.freeArea.radius);
    if (c.def.field) {
      const got = fillFields(occ, {
        x: spot.x, y: spot.y, w: cw, h: ch,
        radius: c.def.radius?.range ?? 22,
        tiles: c.def.field.tiles,
        fieldType: c.def.field.fieldType,
        ownerUid: uid,
      });
      fields.push(...got);
      if (got.length < c.def.field.tiles) {
        gaps.push(`${c.def.name} : ${got.length} cases de champ sur ${c.def.field.tiles} — rendement partiel`);
      }
    }
  }

  // 6. portée d'entrepôt ; un second entrepôt si des producteurs sont trop loin
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
    for (const p of bad) {
      const d = input.lookup(p.defId)!;
      gaps.push(`${d.name} en (${p.x},${p.y}) : aucun entrepôt sous ${d.transporterRange ?? DEFAULT_RANGE} en distance-rue`);
    }
  }
  return { occ, placements, fields, gaps };
}

/** Emplacement libre le plus proche d'un point, avec accès route. Balayage par anneaux. */
function findNear(
  occ: Occ, def: BuildingDef, cx: number, cy: number,
): { x: number; y: number } | null {
  const max = Math.max(occ.w, occ.h);
  for (let ring = 0; ring <= max; ring++) {
    for (let y = cy - ring; y <= cy + ring; y++) {
      for (let x = cx - ring; x <= cx + ring; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
        if (!fits(occ, x, y, def.size.w, def.size.h)) continue;
        if (adjacentRoads(occ, x, y, def.size.w, def.size.h).length === 0) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/** Rogne les bandes vides en bordure et décale tout le contenu. */
function trim(a: Attempt): PackResult {
  const used: number[] = [];
  for (let i = 0; i < a.occ.cell.length; i++) if (a.occ.cell[i] !== FREE) used.push(i);
  if (!used.length) {
    return { w: a.occ.w, h: a.occ.h, placements: [], roads: [], fields: [], tiles: { buildings: 0, fields: 0, roads: 0 }, efficiency: 0, gaps: a.gaps };
  }
  let x0 = a.occ.w, y0 = a.occ.h, x1 = 0, y1 = 0;
  for (const i of used) {
    const x = i % a.occ.w;
    const y = (i / a.occ.w) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const roads: { x: number; y: number }[] = [];
  for (const i of used) {
    if (a.occ.cell[i] !== ROAD) continue;
    roads.push({ x: (i % a.occ.w) - x0, y: ((i / a.occ.w) | 0) - y0 });
  }
  const tiles = {
    buildings: count(a.occ, BUILDING),
    fields: count(a.occ, FIELD),
    roads: roads.length,
  };
  return {
    w, h,
    placements: a.placements.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 })),
    roads,
    fields: a.fields.map((f) => ({ ...f, x: f.x - x0, y: f.y - y0 })),
    tiles,
    efficiency: (tiles.buildings + tiles.fields + tiles.roads) / (w * h),
    gaps: a.gaps,
  };
}

export function packBlueprint(input: PackInput): PackResult {
  const wh = input.lookup(input.warehouseDefId);
  if (!wh) throw new Error(`Entrepôt introuvable : ${input.warehouseDefId}`);
  const copies = expandCopies(input);
  const area = usefulArea(copies, wh);

  let best: PackResult | null = null;
  for (const inflation of INFLATIONS) {
    for (const [rw, rh] of RATIOS) {
      const target = area * inflation;
      const unit = Math.sqrt(target / (rw * rh));
      const w = Math.max(wh.size.w + 2, Math.ceil(unit * rw));
      const h = Math.max(wh.size.h + 3, Math.ceil(unit * rh));
      const attempt = tryBox(input, copies, w, h);
      if (!attempt) continue;
      const r = trim(attempt);
      if (!best || better(r, best)) best = r;
    }
  }
  if (!best) throw new Error("Aucune boîte candidate n'a pu accueillir la chaîne.");
  return best;
}

/** Ordre total de comparaison : moins de manques, puis efficacité, puis petitesse, puis carré. */
function better(a: PackResult, b: PackResult): boolean {
  if (a.gaps.length !== b.gaps.length) return a.gaps.length < b.gaps.length;
  if (a.efficiency !== b.efficiency) return a.efficiency > b.efficiency;
  if (a.w * a.h !== b.w * b.h) return a.w * a.h < b.w * b.h;
  return Math.abs(a.w - a.h) < Math.abs(b.w - b.h);
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/pack.test.ts`
Attendu : PASS, 7 tests.

Si `les fermes atteignent leur quota` échoue avec moins de 140 cases : les gonflements
`INFLATIONS` sont trop serrés pour cette chaîne. Ajouter `1.8` et `2.2` à la liste — c'est un
réglage de couverture, pas un changement d'algorithme, et le test de déterminisme continue de
tenir. Ne PAS assouplir l'assertion : une ferme sous quota est un vrai manque.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/pack.ts src/prodlayout/pack.test.ts && git commit -m "feat(prodlayout): placeur glouton deterministe, boites candidates et compaction"
```

---

### Task 8 : Le récapitulatif

**Fichiers :**
- Créer : `src/prodlayout/report.ts`
- Test : `src/prodlayout/report.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/prodlayout/report.test.ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildChain } from "./chain";
import { buildOrder } from "./lot";
import { buildReport } from "./report";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("buildReport", () => {
  const chain = buildChain("g3174", 2, lookup);
  const rep = buildReport(chain, buildOrder(chain), lookup, [
    { defId: "g3310", count: 1 },
  ]);

  it("compte les bâtiments avec leur nom et leur utilisation", () => {
    const bakery = rep.buildings.find((b) => b.defId === "g3174")!;
    expect(bakery.name).toBe("Boulangerie");
    expect(bakery.count).toBe(2);
    expect(bakery.utilisation).toBe(1);
  });

  it("inclut l'entrepôt dans l'entretien mais pas dans la chaîne", () => {
    // upkeep vérifié dans la donnée : boulangerie 14, entrepôt 6
    expect(rep.buildings.find((b) => b.defId === "g3310")!.count).toBe(1);
    expect(rep.upkeep).toBeGreaterThan(0);
  });

  it("chiffre la main-d'œuvre par palier, arrondie au supérieur", () => {
    // 2 boulangeries × 3 Plébéiens (1496) + 2 fermes × 4 Liberti (1499)
    const pleb = rep.workforce.find((w) => w.tier === "1496")!;
    expect(pleb.amount).toBe(6);
    expect(pleb.name).toBe("Plébéiens");
    const lib = rep.workforce.find((w) => w.tier === "1499")!;
    expect(lib.amount).toBe(8);
  });

  it("annonce la production du bien cible", () => {
    expect(rep.production.name).toBe("Pain");
    expect(rep.production.ratePerMin).toBe(2);
  });

  it("rend un manifeste d'import vide quand la chaîne est complète", () => {
    expect(rep.imports).toEqual([]);
    expect(rep.importCostPerMin).toBe(0);
  });

  it("chiffre l'import quand un intrant est coupé", () => {
    const cut = buildChain("g3174", 2, lookup, new Set(["2119"]));
    const r = buildReport(cut, buildOrder(cut), lookup, []);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0].name).toBe("Farine");
    expect(r.imports[0].ratePerMin).toBe(2);
    expect(r.importCostPerMin).toBeGreaterThan(0);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/prodlayout/report.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./report"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/report.ts
import { eco, goodName, ratePerMin, type ChainResult, type Lookup } from "./chain";
import { toNumber } from "./frac";
import type { Order } from "./lot";

/**
 * RÉCAPITULATIF CHIFFRÉ.
 *
 * Pas de ligne « coût de construction » : `economy.generated.json` porte `buildingUpkeep`
 * mais aucun prix de pose. Une case absente vaut mieux qu'un chiffre inventé.
 */

export interface ReportBuilding {
  defId: string;
  name: string;
  count: number;
  /** 1 = pleinement employé. Vaut 1 pour ce qui n'est pas dans la chaîne (entrepôts). */
  utilisation: number;
}

export interface ReportWorkforce {
  tier: string;
  name: string;
  amount: number;
}

export interface ReportImport {
  good: string;
  name: string;
  ratePerMin: number;
  costPerMin: number;
}

export interface Report {
  buildings: ReportBuilding[];
  upkeep: number;
  workforce: ReportWorkforce[];
  production: { good: string; name: string; ratePerMin: number };
  marketValuePerMin: number;
  imports: ReportImport[];
  importCostPerMin: number;
}

const tierName = (guid: string): string =>
  eco.tiers.find((t) => t.guid === guid)?.name ?? guid;

export function buildReport(
  chain: ChainResult,
  order: Order,
  lookup: Lookup,
  extra: { defId: string; count: number }[],
): Report {
  const buildings: ReportBuilding[] = [];
  const counts = new Map<string, number>();

  for (const it of order.items) {
    buildings.push({
      defId: it.defId,
      name: lookup(it.defId)?.name ?? it.defId,
      count: it.placed,
      utilisation: it.utilisation,
    });
    counts.set(it.defId, it.placed);
  }
  for (const e of extra) {
    buildings.push({ defId: e.defId, name: lookup(e.defId)?.name ?? e.defId, count: e.count, utilisation: 1 });
    counts.set(e.defId, (counts.get(e.defId) ?? 0) + e.count);
  }

  let upkeep = 0;
  const wf = new Map<string, number>();
  for (const [defId, n] of counts) {
    upkeep += (eco.buildingUpkeep[defId] ?? 0) * n;
    for (const w of eco.buildingWorkforce[defId] ?? []) {
      wf.set(w.tier, (wf.get(w.tier) ?? 0) + w.amount * n);
    }
  }

  const target = chain.nodes[0];
  const rate = target ? toNumber(target.exact) * toNumber(ratePerMin(eco.buildingProd[target.defId], chain.targetGood)) : 0;

  const imports = chain.imports.map((i) => ({
    good: i.good,
    name: goodName(i.good),
    ratePerMin: i.ratePerMin,
    costPerMin: i.ratePerMin * (eco.goodPrices[i.good] ?? 0),
  }));

  return {
    buildings,
    upkeep: Math.round(upkeep),
    workforce: [...wf.entries()]
      .map(([tier, amount]) => ({ tier, name: tierName(tier), amount: Math.ceil(amount) }))
      .sort((a, b) => a.tier.localeCompare(b.tier)),
    production: { good: chain.targetGood, name: goodName(chain.targetGood), ratePerMin: rate },
    marketValuePerMin: rate * (eco.goodPrices[chain.targetGood] ?? 0),
    imports,
    importCostPerMin: Math.round(imports.reduce((s, i) => s + i.costPerMin, 0)),
  };
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/prodlayout/report.test.ts`
Attendu : PASS, 6 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/report.ts src/prodlayout/report.test.ts && git commit -m "feat(prodlayout): recapitulatif chiffre, sans cout de construction invente"
```

---

### Task 9 : La porte d'entrée, la frontière et le bout en bout

**Fichiers :**
- Créer : `src/prodlayout/index.ts`
- Test : `src/prodlayout/index.test.ts`
- Test : `src/prodlayout/frontiere.test.ts`

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/prodlayout/frontiere.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le module est indépendant PAR CONSTRUCTION, pas par bonne volonté. Ce test est la seule
 * chose qui empêche un import « juste pour cette fois » vers le moteur d'île, qui ferait
 * rentrer par la fenêtre la cascade services/couverture que ce module existe pour tenir
 * à part.
 */
const DIR = join(process.cwd(), "src", "prodlayout");
const INTERDIT = /from\s+["']\.\.\/(optimizer|economy)\//;

describe("frontière du module prodlayout", () => {
  it("n'importe ni src/optimizer/ ni src/economy/", () => {
    const fautifs: string[] = [];
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith(".ts")) continue;
      if (INTERDIT.test(readFileSync(join(DIR, f), "utf8"))) fautifs.push(f);
    }
    expect(fautifs).toEqual([]);
  });

  it("n'utilise ni horloge ni aléa — le déterminisme est structurel", () => {
    const fautifs: string[] = [];
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const src = readFileSync(join(DIR, f), "utf8");
      if (/Math\.random|Date\.now|new Date\(/.test(src)) fautifs.push(f);
    }
    expect(fautifs).toEqual([]);
  });
});
```

```ts
// src/prodlayout/index.test.ts
import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { planProductionLayout } from "./index";

const catalog = rawCatalog as unknown as BuildingDef[];

describe("planProductionLayout — bout en bout sur la boulangerie romaine", () => {
  const plan = planProductionLayout(catalog, "g3174", 1);

  it("rend un Layout que le moteur de rendu sait dessiner", () => {
    expect(plan.layout.grid.w).toBe(plan.box.w);
    expect(plan.layout.grid.h).toBe(plan.box.h);
    expect(plan.layout.grid.usable.every(Boolean)).toBe(true);
    expect(plan.layout.grid.cellsPerTile).toBeUndefined(); // grille TUILE, pas ½-tuile
    expect(plan.layout.buildings.length).toBe(plan.report.buildings.reduce((s, b) => s + b.count, 0));
  });

  it("suggère le lot parfait quand le ratio est incomplet", () => {
    expect(plan.order.perfectMultiplier).toBe(2);
    expect(plan.order.items.find((i) => i.defId === "g3075")!.utilisation).toBe(0.5);
  });

  it("le lot parfait ne gaspille plus rien", () => {
    const perfect = planProductionLayout(catalog, "g3174", 2);
    expect(perfect.order.perfectMultiplier).toBe(1);
    expect(perfect.order.items.every((i) => i.utilisation === 1)).toBe(true);
  });

  it("choisit l'entrepôt de la région du bâtiment cible", () => {
    expect(plan.layout.buildings.some((b) => b.defId === "g3310")).toBe(true);
  });

  it("est reproductible à l'identique", () => {
    const again = planProductionLayout(catalog, "g3174", 1);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });

  it("refuse un bâtiment qui ne produit rien", () => {
    expect(() => planProductionLayout(catalog, "g3310", 1)).toThrow(/ne produit rien/);
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Commande : `pnpm vitest run src/prodlayout/index.test.ts src/prodlayout/frontiere.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./index"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/prodlayout/index.ts
import type { BuildingDef, Layout, PlacedBuilding } from "../model/types";
import { buildChain, eco, type ChainResult } from "./chain";
import { buildOrder, type Order } from "./lot";
import { packBlueprint, type PackResult } from "./pack";
import { buildReport, type Report } from "./report";

/**
 * BLUEPRINTS DE PRODUCTION — la seule porte d'entrée du module.
 *
 * Le résultat porte un `Layout` STANDARD, en grille TUILE (`cellsPerTile` absent) : c'est
 * ce qui permet à `src/render/draw.ts` et `exportImage.ts` de le dessiner sans adaptateur.
 */

export interface LayoutPlan {
  layout: Layout;
  chain: ChainResult;
  order: Order;
  report: Report;
  box: { w: number; h: number };
  tiles: { buildings: number; fields: number; roads: number };
  efficiency: number;
  gaps: string[];
}

export interface PlanOptions {
  /** GUID des biens que l'utilisateur choisit d'importer plutôt que de produire. */
  imported?: ReadonlySet<string>;
}

/** Entrepôt canonique de la région : template `Warehouse`, plus petit GUID. */
export function pickWarehouse(catalog: BuildingDef[], region?: string): BuildingDef {
  const all = catalog
    .filter((d) => d.template === "Warehouse")
    .sort((a, b) => (a.guid ?? 0) - (b.guid ?? 0));
  const found = (region ? all.find((d) => d.region === region) : undefined) ?? all[0];
  if (!found) throw new Error("Aucun entrepôt dans le catalogue.");
  return found;
}

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
  const warehouse = pickWarehouse(catalog, eco.buildingRegion[targetDefId]);

  const packed: PackResult = packBlueprint({
    items: order.items.map((i) => ({ defId: i.defId, count: i.placed })),
    warehouseDefId: warehouse.id,
    lookup,
  });

  const buildings: PlacedBuilding[] = packed.placements.map((p) => ({
    uid: p.uid, defId: p.defId, x: p.x, y: p.y, rotation: p.rot, locked: false,
  }));

  const layout: Layout = {
    grid: { w: packed.w, h: packed.h, usable: new Array(packed.w * packed.h).fill(true) },
    buildings,
    fields: packed.fields.map((f) => ({ x: f.x, y: f.y, ownerUid: f.ownerUid, fieldType: f.fieldType })),
    roads: packed.roads.map((r) => ({ x: r.x, y: r.y, gen: true })),
  };

  const extras = packed.placements.filter((p) => p.defId === warehouse.id);
  const report = buildReport(chain, order, lookup, [{ defId: warehouse.id, count: extras.length }]);

  return {
    layout,
    chain,
    order,
    report,
    box: { w: packed.w, h: packed.h },
    tiles: packed.tiles,
    efficiency: packed.efficiency,
    gaps: [...chain.gaps, ...packed.gaps],
  };
}
```

- [ ] **Étape 4 : relancer les tests, puis la suite complète**

Commande : `pnpm vitest run src/prodlayout/`
Attendu : PASS pour les 8 fichiers du module.

Commande : `pnpm test && pnpm typecheck && pnpm lint`
Attendu : la suite entière au vert, aucune erreur de type, aucun avertissement neuf.

- [ ] **Étape 5 : commit**

```bash
git add src/prodlayout/index.ts src/prodlayout/index.test.ts src/prodlayout/frontiere.test.ts && git commit -m "feat(prodlayout): porte d'entree, test de frontiere et bout en bout"
```

---

### Task 10 : La bibliothèque de blueprints

**Fichiers :**
- Créer : `src/persist/blueprints.ts`
- Test : `src/persist/blueprints.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// src/persist/blueprints.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { deleteBlueprint, listBlueprints, saveBlueprint } from "./blueprints";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const bp = { name: "Pain ×2", targetDefId: "g3174", count: 2, imported: [] };

describe("bibliothèque de blueprints", () => {
  it("part vide", () => {
    expect(listBlueprints()).toEqual([]);
  });

  it("enregistre et relit", () => {
    saveBlueprint(bp);
    expect(listBlueprints()).toEqual([bp]);
  });

  it("un même nom écrase au lieu de doubler", () => {
    saveBlueprint(bp);
    saveBlueprint({ ...bp, count: 4 });
    expect(listBlueprints()).toHaveLength(1);
    expect(listBlueprints()[0].count).toBe(4);
  });

  it("supprime par nom", () => {
    saveBlueprint(bp);
    deleteBlueprint("Pain ×2");
    expect(listBlueprints()).toEqual([]);
  });

  it("ne jette pas sur un contenu corrompu", () => {
    store.set("anno117-designer:blueprints:v1", "{pas du json");
    expect(listBlueprints()).toEqual([]);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm vitest run src/persist/blueprints.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./blueprints"`.

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/persist/blueprints.ts
/**
 * Bibliothèque locale de blueprints. On enregistre la COMMANDE (bâtiment cible, nombre,
 * intrants coupés), pas le plan calculé : le placeur étant déterministe, rejouer la
 * commande rend exactement le même plan, et un plan périmé ne peut donc pas survivre à une
 * amélioration du moteur.
 */

const KEY = "anno117-designer:blueprints:v1";

export interface SavedBlueprint {
  name: string;
  targetDefId: string;
  count: number;
  /** GUID des biens marqués importés. */
  imported: string[];
}

export function listBlueprints(): SavedBlueprint[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedBlueprint[]) : [];
  } catch {
    return []; // contenu corrompu ou stockage indisponible : la bibliothèque est vide
  }
}

function write(list: SavedBlueprint[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota plein / mode privé : on ignore, comme `saveState`
  }
}

export function saveBlueprint(bp: SavedBlueprint): void {
  write([...listBlueprints().filter((b) => b.name !== bp.name), bp]);
}

export function deleteBlueprint(name: string): void {
  write(listBlueprints().filter((b) => b.name !== name));
}
```

- [ ] **Étape 4 : relancer le test**

Commande : `pnpm vitest run src/persist/blueprints.test.ts`
Attendu : PASS, 5 tests.

- [ ] **Étape 5 : commit**

```bash
git add src/persist/blueprints.ts src/persist/blueprints.test.ts && git commit -m "feat(persist): bibliotheque locale de blueprints, la commande plutot que le plan"
```

---

### Task 11 : La vue

**Fichiers :**
- Créer : `src/ui/components/BlueprintCanvas.tsx`
- Créer : `src/ui/ProdLayoutView.tsx`
- Modifier : `src/state/store.ts` (l'union `uiMode`, deux endroits : la déclaration
  d'interface autour de la ligne 82 et le setter autour de la ligne 84)
- Modifier : `src/ui/shell/NavRail.tsx` (la constante `ITEMS`)
- Modifier : `src/ui/shell/AppShell.tsx` (le rendu conditionnel)

Cette tâche est de l'assemblage d'interface : elle n'a pas de test unitaire propre, la
logique testable vivant entièrement dans `src/prodlayout/`. La vérification se fait dans le
navigateur, à l'étape 5.

- [ ] **Étape 1 : élargir le mode d'interface**

Dans `src/state/store.ts`, remplacer les deux occurrences du type :

```ts
  uiMode: "editor" | "island" | "multi" | "prod";
```
```ts
  setUiMode: (m: "editor" | "island" | "multi" | "prod") => void;
```

Dans `src/ui/shell/NavRail.tsx`, ajouter l'entrée à `ITEMS` :

```ts
const ITEMS = [
  { id: "editor", label: "Éditeur", icon: "🗺" },
  { id: "island", label: "Plan d'île", icon: "🏛" },
  { id: "multi", label: "Multi-îles", icon: "🏝" },
  { id: "prod", label: "Production", icon: "🏭" },
] as const;
```

- [ ] **Étape 2 : le canvas**

```tsx
// src/ui/components/BlueprintCanvas.tsx
import { useEffect, useRef } from "react";
import { makeLookup } from "../../engine/rules";
import { drawScene } from "../../render/draw";
import { fitView } from "../../render/exportImage";
import type { BuildingDef, Layout } from "../../model/types";

/**
 * Rendu d'un blueprint. Contrairement à `PlanPreview` (une case = un pixel, taillé pour une
 * île de 640²), un blueprint fait quelques dizaines de cases : on réutilise le rendu de
 * l'ÉDITEUR, qui dessine les icônes, les champs et les emprises lisiblement.
 *
 * `issues` et `coverage` sont vides à dessein : la validation du blueprint est faite par le
 * placeur et remonte dans `gaps`, pas par le moteur de règles de l'éditeur — qui raisonne
 * sur une grille d'île.
 */
export function BlueprintCanvas({
  layout, catalog, maxPx = 900,
}: { layout: Layout; catalog: BuildingDef[]; maxPx?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { view, width, height } = fitView(layout.grid.w, layout.grid.h, maxPx);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, {
      layout,
      lookup: makeLookup(catalog),
      view,
      issues: new Map(),
      coverage: new Map(),
      showRadius: false,
      selectedUid: null,
      hover: null,
    });
  }, [layout, catalog, maxPx]);

  return <canvas ref={ref} className="blueprint-canvas" style={{ maxWidth: "100%" }} />;
}
```

- [ ] **Étape 3 : la vue à trois colonnes**

```tsx
// src/ui/ProdLayoutView.tsx
import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { planProductionLayout } from "../prodlayout";
import { eco, goodName } from "../prodlayout/chain";
import { deleteBlueprint, listBlueprints, saveBlueprint } from "../persist/blueprints";
import { downloadLayoutPng } from "../render/exportImage";
import { BlueprintCanvas } from "./components/BlueprintCanvas";

/**
 * Onglet PRODUCTION : commande à gauche, plan au centre, chiffres à droite.
 *
 * Le plan se recalcule à chaque frappe parce qu'il coûte quelques millisecondes — pas de
 * worker, pas de bouton « calculer », pas d'état intermédiaire à tenir cohérent.
 */
export function ProdLayoutView() {
  const catalog = useStore((s) => s.catalog);
  const world = useStore((s) => s.world);

  const targets = useMemo(
    () => catalog
      .filter((d) => eco.buildingProd[d.id] && (!d.region || d.region === world))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog, world],
  );

  const [targetId, setTargetId] = useState(() => targets[0]?.id ?? "");
  const [count, setCount] = useState(1);
  const [imported, setImported] = useState<string[]>([]);
  const [saved, setSaved] = useState(() => listBlueprints());
  const [name, setName] = useState("");

  const plan = useMemo(() => {
    if (!targetId) return null;
    try {
      return planProductionLayout(catalog, targetId, Math.max(1, count), { imported: new Set(imported) });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  }, [catalog, targetId, count, imported]);

  if (!plan) return <div className="panel">Aucun bâtiment de production dans ce monde.</div>;
  if ("error" in plan) return <div className="panel error">{plan.error}</div>;

  const toggleImport = (good: string) =>
    setImported((cur) => (cur.includes(good) ? cur.filter((g) => g !== good) : [...cur, good]));

  return (
    <div className="prod-layout">
      <aside className="panel prod-command">
        <label>
          Bâtiment
          <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setImported([]); }}>
            {targets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          Nombre
          <input type="number" min={1} value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
        </label>

        <h4>Chaîne</h4>
        <ul className="chain-tree">
          {plan.chain.nodes.map((n) => {
            const item = plan.order.items.find((i) => i.defId === n.defId)!;
            return (
              <li key={n.defId} style={{ marginLeft: n.depth * 12 }}>
                <b>{item.placed}×</b> {catalog.find((d) => d.id === n.defId)?.name ?? n.defId}
                {item.utilisation < 1 && <em> · {Math.round(item.utilisation * 100)} %</em>}
                <button onClick={() => toggleImport(n.good)}>
                  {imported.includes(n.good) ? "produire" : "importer"}
                </button>
              </li>
            );
          })}
        </ul>

        <h4>Bibliothèque</h4>
        <div className="row">
          <input value={name} placeholder="nom" onChange={(e) => setName(e.target.value)} />
          <button
            disabled={!name.trim()}
            onClick={() => {
              saveBlueprint({ name: name.trim(), targetDefId: targetId, count, imported });
              setSaved(listBlueprints());
              setName("");
            }}
          >enregistrer</button>
        </div>
        <ul>
          {saved.map((b) => (
            <li key={b.name}>
              <button onClick={() => { setTargetId(b.targetDefId); setCount(b.count); setImported(b.imported); }}>
                {b.name}
              </button>
              <button onClick={() => { deleteBlueprint(b.name); setSaved(listBlueprints()); }}>✕</button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="prod-plan">
        {plan.order.perfectMultiplier > 1 && (
          <div className="banner">
            Ratio incomplet — à <b>{count * plan.order.perfectMultiplier} {catalog.find((d) => d.id === targetId)?.name}</b>,
            plus aucun gaspillage.
            <button onClick={() => setCount(count * plan.order.perfectMultiplier)}>appliquer</button>
          </div>
        )}
        <BlueprintCanvas layout={plan.layout} catalog={catalog} />
        <div className="row">
          <button onClick={() => downloadLayoutPng(plan.layout, catalog, "blueprint.png")}>
            exporter en PNG
          </button>
        </div>
        {plan.gaps.length > 0 && (
          <ul className="gaps">{plan.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        )}
      </section>

      <aside className="panel prod-report">
        <table>
          <tbody>
            <tr><th>Bâtiments</th><td>
              {plan.report.buildings.map((b) => `${b.count} ${b.name}`).join(" · ")}
            </td></tr>
            <tr><th>Entretien</th><td>−{plan.report.upkeep} /min</td></tr>
            <tr><th>Main-d'œuvre</th><td>
              {plan.report.workforce.map((w) => `${w.amount} ${w.name}`).join(" · ") || "—"}
            </td></tr>
            <tr><th>Taille</th><td>{plan.box.w} × {plan.box.h}</td></tr>
            <tr><th>Cases</th><td>{plan.box.w * plan.box.h}</td></tr>
            <tr><th>Efficacité</th><td>{(plan.efficiency * 100).toFixed(1)} %</td></tr>
            <tr><th>Production</th><td>
              {plan.report.production.ratePerMin.toFixed(2)} {plan.report.production.name} /min
            </td></tr>
            <tr><th>Valeur</th><td>{Math.round(plan.report.marketValuePerMin)} /min</td></tr>
            <tr><th>Imports</th><td>
              {plan.report.imports.map((i) => `${i.ratePerMin.toFixed(2)} ${goodName(i.good)}`).join(" · ") || "aucun"}
            </td></tr>
          </tbody>
        </table>
      </aside>
    </div>
  );
}
```

Dans `src/ui/shell/AppShell.tsx`, importer la vue et ajouter la ligne de rendu :

```tsx
import { ProdLayoutView } from "../ProdLayoutView";
```
```tsx
          {uiMode === "prod" && <ProdLayoutView />}
```

- [ ] **Étape 4 : ajouter la porte d'export PNG**

`src/render/exportImage.ts` n'exporte aujourd'hui que `fitView` et `renderFullCanvas` —
vérifié. Il manque le téléchargement. L'ajouter à la fin du fichier ; les types `Layout` et
`BuildingDef` y sont déjà importés.

```ts
/** Télécharge le rendu plein cadre d'un layout en PNG. */
export function downloadLayoutPng(layout: Layout, catalog: BuildingDef[], filename: string): void {
  const canvas = renderFullCanvas(layout, catalog);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}
```

- [ ] **Étape 5 : vérifier dans le navigateur**

Commande : `pnpm typecheck && pnpm lint && pnpm test`
Attendu : tout au vert.

Puis démarrer l'aperçu et contrôler, dans l'onglet **Production** :
1. la boulangerie est sélectionnable et le plan s'affiche ;
2. à 1 boulangerie, le bandeau propose 2 et le bouton *appliquer* le fait ;
3. à 2 boulangeries, le bandeau disparaît et toutes les utilisations valent 100 % ;
4. le récapitulatif affiche taille, cases, efficacité et production ;
5. l'export PNG télécharge une image non vide ;
6. enregistrer puis recharger un blueprint restitue la même commande.

- [ ] **Étape 6 : commit**

```bash
git add src/ui/ProdLayoutView.tsx src/ui/components/BlueprintCanvas.tsx src/ui/shell/NavRail.tsx src/ui/shell/AppShell.tsx src/state/store.ts src/render/exportImage.ts && git commit -m "feat(ui): onglet Production — commande, blueprint, recapitulatif"
```

---

### Task 12 : Habillage CSS et mise à jour de l'état du projet

**Fichiers :**
- Modifier : `src/index.css`
- Modifier : `docs/ETAT-ET-SUITE.md`

- [ ] **Étape 1 : styler la vue**

Ajouter à la fin de `src/index.css` :

```css
/* --- onglet Production (blueprints de chaîne) --- */
.prod-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 300px;
  gap: 12px;
  padding: 12px;
  align-items: start;
  overflow: auto;
}
.prod-command label { display: block; margin-bottom: 8px; }
.prod-command select, .prod-command input { width: 100%; }
.chain-tree { list-style: none; padding: 0; margin: 0 0 12px; }
.chain-tree li { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; }
.chain-tree em { color: #e8a33d; font-style: normal; }
.prod-plan .banner {
  background: #2a3340; border-left: 3px solid #e8c547;
  padding: 8px 10px; margin-bottom: 8px; display: flex; gap: 8px; align-items: center;
}
.prod-plan .gaps { color: #e08a7a; margin-top: 8px; }
.prod-report table { width: 100%; border-collapse: collapse; }
.prod-report th { text-align: left; opacity: .7; font-weight: 500; padding-right: 8px; vertical-align: top; }
.prod-report td { padding: 3px 0; }
.blueprint-canvas { display: block; image-rendering: auto; }
```

- [ ] **Étape 2 : vérifier le rendu**

Recharger l'onglet Production : les trois colonnes se tiennent, le bandeau de suggestion est
visible, le tableau est lisible.

- [ ] **Étape 3 : consigner le module dans l'état du projet**

Ajouter une section à `docs/ETAT-ET-SUITE.md`, après §1 :

```markdown
## 1 bis. Le module de blueprints de production

`src/prodlayout/` calcule un layout compact et recopiable pour une chaîne complète, à partir
d'un bâtiment terminal. Indépendant du moteur d'île : ni terrain, ni fertilité, ni population,
et un test de frontière (`frontiere.test.ts`) interdit tout import vers `src/optimizer/` ou
`src/economy/`.

Ratios en rationnels exacts, placeur glouton **déterministe** — le test « deux appels
identiques rendent un plan identique » est ce qui rend le module mesurable. Spec :
`docs/superpowers/specs/2026-08-10-blueprints-de-production-design.md`.

Hors périmètre assumé : pose sur une île réelle, maisons ouvrières, coûts de construction
(absents de l'export du jeu), passe d'amélioration locale du placeur.
```

- [ ] **Étape 4 : suite complète**

Commande : `pnpm test && pnpm typecheck && pnpm lint`
Attendu : tout au vert, aucune régression sur les 294 tests existants.

- [ ] **Étape 5 : commit**

```bash
git add src/index.css docs/ETAT-ET-SUITE.md && git commit -m "style(prodlayout): habillage de l'onglet Production, etat du projet a jour"
```

---

## Vérification finale

- [ ] `pnpm test` — la suite entière, existante comprise, au vert
- [ ] `pnpm typecheck` — aucune erreur
- [ ] `pnpm lint` — aucun avertissement neuf
- [ ] `pnpm vitest run src/prodlayout/frontiere.test.ts` — l'indépendance du module tient
- [ ] Contrôle navigateur des six points de la Task 11, étape 5
