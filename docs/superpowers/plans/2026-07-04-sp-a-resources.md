# SP-A — Ressources + contrainte dure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un modèle de ressources PUR + des profils de ressources PERSISTANTS par île, branchés comme contrainte DURE dans le mode Production mono-île — noyau réutilisable par le futur mode multi-îles.

**Architecture:** Couches unidirectionnelles `domaine ← état ← UI`. `resources.ts` (pur) juge la producibilité via `chainFertilities` existant. `persist/party.ts` (clé localStorage propre, isolée du layout v8) persiste `{partyIslands, islandProfiles}`. Le store expose une slice. `ResourceSelector` (UI contrôlée) édite un profil, réutilisé mono-île ET multi-îles. `IslandPlanner` filtre le menu « bien à produire » par les biens produisibles.

**Tech Stack:** TypeScript, Vitest, React, Zustand. Réf : spec `docs/superpowers/specs/2026-07-04-multi-island-orchestration-design.md` §4.1, §4.2, §5.

---

## File structure

- Create `src/economy/resources.ts` — modèle pur (producibilité) + `ResourceProfile`.
- Create `src/economy/resources.test.ts`.
- Create `src/persist/party.ts` — persistance party/profils (clé propre) + `normalizeParty` pur.
- Create `src/persist/party.test.ts`.
- Modify `src/state/store.ts` — slice `partyIslands`/`islandProfiles` + actions, load/save party.
- Create `src/ui/ResourceSelector.tsx` — composant contrôlé partagé.
- Modify `src/ui/IslandPlanner.tsx` — contrainte dure (dropdown filtré) + profil persistant via `ResourceSelector`.

---

## Task 1 : `resources.ts` — modèle de producibilité (pur)

**Files:**
- Create: `src/economy/resources.ts`
- Test: `src/economy/resources.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/economy/resources.test.ts
import { describe, expect, it } from "vitest";
import { chainFertilities, economy } from "./economy";
import { canProduce, emptyProfile, missingFertilities, producibleGoods } from "./resources";

// choisit dynamiquement un bien dont la chaîne EXIGE une fertilité (données réelles)
const gatedGood = Object.keys(economy.producers).find((g) => chainFertilities(g).size > 0)!;
const gatedFert = [...chainFertilities(gatedGood)][0];
// et un bien SANS fertilité requise
const freeGood = Object.keys(economy.producers).find((g) => chainFertilities(g).size === 0)!;

describe("resources — producibilité", () => {
  it("emptyProfile = aucune fertilité, 0 slot", () => {
    expect(emptyProfile()).toEqual({ fertilities: [], mountainSlots: 0 });
  });
  it("bien à fertilité : refusé si absente, accepté si présente", () => {
    expect(canProduce(gatedGood, emptyProfile())).toBe(false);
    expect(missingFertilities(gatedGood, emptyProfile())).toContain(gatedFert);
    const p = { fertilities: [...chainFertilities(gatedGood)], mountainSlots: 0 };
    expect(canProduce(gatedGood, p)).toBe(true);
    expect(missingFertilities(gatedGood, p)).toEqual([]);
  });
  it("bien sans fertilité : produisible même profil vide", () => {
    expect(canProduce(freeGood, emptyProfile())).toBe(true);
  });
  it("producibleGoods : profil vide = tous les biens sans fertilité ; profil complet ⊇ profil vide", () => {
    const empty = producibleGoods(emptyProfile());
    expect(empty.has(freeGood)).toBe(true);
    expect(empty.has(gatedGood)).toBe(false);
    const full = producibleGoods({ fertilities: Object.keys(economy.fertilities), mountainSlots: 0 });
    expect(full.has(gatedGood)).toBe(true);
    expect(full.size).toBeGreaterThanOrEqual(empty.size);
  });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run: `npx vitest run src/economy/resources.test.ts`
Expected: FAIL (module `./resources` introuvable).

- [ ] **Step 3: Écrire l'implémentation minimale**

```ts
// src/economy/resources.ts
import { chainFertilities, economy } from "./economy";

/** Ressources déclarées d'une île (saisie utilisateur — fertilités par-partie dans le jeu). */
export interface ResourceProfile {
  fertilities: string[]; // GUIDs Fertility/Deposit présents (naturels + miniers)
  mountainSlots: number; // nb de slots montagne exploitables (capacité minière)
}

export const emptyProfile = (): ResourceProfile => ({ fertilities: [], mountainSlots: 0 });

/** Fertilités requises par la chaîne de `good` mais ABSENTES du profil. */
export function missingFertilities(good: string, p: ResourceProfile, region?: string): string[] {
  const have = new Set(p.fertilities);
  return [...chainFertilities(good, region)].filter((f) => !have.has(f));
}

/** Le bien est-il produisible sur ce profil (toutes ses fertilités présentes) ? */
export function canProduce(good: string, p: ResourceProfile, region?: string): boolean {
  return missingFertilities(good, p, region).length === 0;
}

/** Ensemble des biens AYANT UN PRODUCTEUR et produisibles avec ce profil. */
export function producibleGoods(p: ResourceProfile, region?: string): Set<string> {
  const out = new Set<string>();
  for (const good of Object.keys(economy.producers)) {
    if (canProduce(good, p, region)) out.add(good);
  }
  return out;
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `npx vitest run src/economy/resources.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/economy/resources.ts src/economy/resources.test.ts
git commit -m "SP-A: pure resource producibility model (resources.ts)"
```

---

## Task 2 : `persist/party.ts` — persistance isolée (clé propre)

**Files:**
- Create: `src/persist/party.ts`
- Test: `src/persist/party.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/persist/party.test.ts
import { describe, expect, it } from "vitest";
import { emptyParty, normalizeParty } from "./party";

describe("party — normalisation", () => {
  it("vide/absent → défauts", () => {
    expect(normalizeParty(null)).toEqual(emptyParty());
    expect(normalizeParty({})).toEqual({ partyIslands: [], islandProfiles: {} });
  });
  it("partiel → complété", () => {
    const r = normalizeParty({ partyIslands: ["a"] });
    expect(r.partyIslands).toEqual(["a"]);
    expect(r.islandProfiles).toEqual({});
  });
  it("profils conservés", () => {
    const prof = { fertilities: ["f1"], mountainSlots: 3 };
    const r = normalizeParty({ partyIslands: ["a"], islandProfiles: { a: prof } });
    expect(r.islandProfiles.a).toEqual(prof);
  });
  it("garbage → défauts (pas de crash)", () => {
    expect(normalizeParty({ partyIslands: "nope", islandProfiles: 5 })).toEqual(emptyParty());
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `npx vitest run src/persist/party.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémentation minimale**

```ts
// src/persist/party.ts
import type { ResourceProfile } from "../economy/resources";

// Config de PARTIE (îles + profils de ressources) — clé PROPRE, indépendante du layout (v8).
const KEY = "anno117-designer:party:v1";

export interface PartyState {
  partyIslands: string[];
  islandProfiles: Record<string, ResourceProfile>;
}

export const emptyParty = (): PartyState => ({ partyIslands: [], islandProfiles: {} });

/** Normalise une valeur brute en PartyState valide (défauts si champs manquants/invalides). */
export function normalizeParty(data: unknown): PartyState {
  const p = (data ?? {}) as Partial<PartyState>;
  return {
    partyIslands: Array.isArray(p.partyIslands) ? p.partyIslands : [],
    islandProfiles: p.islandProfiles && typeof p.islandProfiles === "object" && !Array.isArray(p.islandProfiles)
      ? (p.islandProfiles as Record<string, ResourceProfile>)
      : {},
  };
}

export function loadParty(): PartyState {
  try {
    return normalizeParty(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return emptyParty();
  }
}

export function saveParty(p: PartyState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* quota/mode privé : ignore */
  }
}
```

- [ ] **Step 4: Lancer → succès**

Run: `npx vitest run src/persist/party.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persist/party.ts src/persist/party.test.ts
git commit -m "SP-A: isolated party/resource persistence (party.ts)"
```

---

## Task 3 : slice store `partyIslands` / `islandProfiles`

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/party-store.test.ts` (create)

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/state/party-store.test.ts
import { describe, expect, it } from "vitest";
import { useStore } from "./store";

describe("store — slice party", () => {
  it("setIslandProfile / addPartyIsland / removePartyIsland", () => {
    const s = () => useStore.getState();
    s().setIslandProfile("isl_x", { fertilities: ["f1"], mountainSlots: 2 });
    expect(s().islandProfiles["isl_x"]).toEqual({ fertilities: ["f1"], mountainSlots: 2 });
    s().addPartyIsland("isl_x");
    s().addPartyIsland("isl_x"); // idempotent
    expect(s().partyIslands.filter((i) => i === "isl_x").length).toBe(1);
    s().removePartyIsland("isl_x");
    expect(s().partyIslands).not.toContain("isl_x");
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `npx vitest run src/state/party-store.test.ts`
Expected: FAIL (`setIslandProfile` non défini).

- [ ] **Step 3: Ajouter la slice au store**

Dans `src/state/store.ts` :

1. Import en tête (après les autres imports) :
```ts
import { loadParty, saveParty, type PartyState } from "../persist/party";
import type { ResourceProfile } from "../economy/resources";
```

2. Dans l'interface `State`, ajouter (après `coverageHighlight`) :
```ts
  partyIslands: string[];
  islandProfiles: Record<string, ResourceProfile>;
  setPartyIslands: (ids: string[]) => void;
  addPartyIsland: (id: string) => void;
  removePartyIsland: (id: string) => void;
  setIslandProfile: (id: string, profile: ResourceProfile) => void;
```

3. Après `const persisted = loadState();`, ajouter :
```ts
const persistedParty = loadParty();
```

4. Dans l'objet retourné par `create`, initialiser (après `coverageHighlight: null,`) :
```ts
    partyIslands: persistedParty.partyIslands,
    islandProfiles: persistedParty.islandProfiles,
```

5. Ajouter les actions (après `setCoverageHighlight`) — chaque mutation persiste la party :
```ts
    setPartyIslands: (ids) => { set({ partyIslands: ids }); persistParty(); },
    addPartyIsland: (id) =>
      set((s) => (s.partyIslands.includes(id) ? s : { partyIslands: [...s.partyIslands, id] })),
    removePartyIsland: (id) => set((s) => ({ partyIslands: s.partyIslands.filter((x) => x !== id) })),
    setIslandProfile: (id, profile) => set((s) => ({ islandProfiles: { ...s.islandProfiles, [id]: profile } })),
```

6. Ajouter un helper `persistParty` près de `persist()` (dans la closure de `create`) :
```ts
  function persistParty(): void {
    const s = get();
    saveParty({ partyIslands: s.partyIslands, islandProfiles: s.islandProfiles } satisfies PartyState);
  }
```

7. Faire persister aussi `addPartyIsland`/`removePartyIsland`/`setIslandProfile` : remplacer leurs corps `set(...)` par une version qui appelle `persistParty()` après. Exemple pour `setIslandProfile` :
```ts
    setIslandProfile: (id, profile) => {
      set((s) => ({ islandProfiles: { ...s.islandProfiles, [id]: profile } }));
      persistParty();
    },
```
(idem `addPartyIsland`, `removePartyIsland` : `set(...)` puis `persistParty()`).

- [ ] **Step 4: Lancer → succès**

Run: `npx vitest run src/state/party-store.test.ts`
Expected: PASS. Puis `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/party-store.test.ts
git commit -m "SP-A: store slice for party islands + resource profiles (persisted)"
```

---

## Task 4 : `ResourceSelector` (composant contrôlé partagé)

**Files:**
- Create: `src/ui/ResourceSelector.tsx`

Composant UI → vérif par tsc + build + smoke (le projet n'a pas de test de composant React ; convention = preview).

- [ ] **Step 1: Écrire le composant**

```tsx
// src/ui/ResourceSelector.tsx
import { useMemo } from "react";
import { economy } from "../economy/economy";
import type { ResourceProfile } from "../economy/resources";

interface Props {
  value: ResourceProfile;
  onChange: (next: ResourceProfile) => void;
}

/** Édite un ResourceProfile : cases fertilités/gisements + nb de slots montagne.
 *  Contrôlé (value/onChange). Réutilisé en mono-île ET multi-îles. */
export function ResourceSelector({ value, onChange }: Props) {
  const ferts = useMemo(
    () => Object.entries(economy.fertilities).map(([guid, name]) => ({ guid, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const have = new Set(value.fertilities);
  const toggle = (guid: string) => {
    const next = new Set(have);
    next.has(guid) ? next.delete(guid) : next.add(guid);
    onChange({ ...value, fertilities: [...next] });
  };
  return (
    <div className="resource-selector">
      <label className="rs-slots">
        Slots montagne (mines)
        <input
          type="number" min={0} value={value.mountainSlots}
          onChange={(e) => onChange({ ...value, mountainSlots: Math.max(0, parseInt(e.target.value) || 0) })}
          style={{ width: 60, marginLeft: 6 }}
        />
      </label>
      <div className="rs-ferts" style={{ maxHeight: 180, overflow: "auto", marginTop: 6 }}>
        {ferts.map((f) => (
          <label key={f.guid} className="checkbox" style={{ display: "block" }}>
            <input type="checkbox" checked={have.has(f.guid)} onChange={() => toggle(f.guid)} /> {f.name}
          </label>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier compile**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add src/ui/ResourceSelector.tsx
git commit -m "SP-A: shared ResourceSelector component (fertilities + mountain slots)"
```

---

## Task 5 : contrainte DURE dans `IslandPlanner` (mode production)

**Files:**
- Modify: `src/ui/IslandPlanner.tsx`

Objectif : le profil de ressources de l'île COURANTE (persistant) est édité via `ResourceSelector`, et le menu « bien à produire » n'affiche que les biens **produisibles**. Remplace la sélection éphémère `islandFerts`.

- [ ] **Step 1: Imports + profil courant**

Ajouter en tête de `IslandPlanner.tsx` :
```ts
import { ResourceSelector } from "./ResourceSelector";
import { producibleGoods } from "../economy/resources";
```
Dans le composant, récupérer le profil de l'île chargée :
```ts
  const islandId = useStore((s) => s.layout.grid.islandId);
  const profile = useStore((s) => (islandId ? s.islandProfiles[islandId] : undefined));
  const setIslandProfile = useStore((s) => s.setIslandProfile);
  const effProfile = profile ?? { fertilities: [], mountainSlots: 0 };
  const islandRegion = islandId?.includes("celtic") ? "Celtic" : "Roman";
```

- [ ] **Step 2: Filtrer les biens produisibles**

Remplacer le calcul `producibleGoods` local (la liste `producibleGoods` mémoïsée existante, basée sur `economy.producers`) par un filtrage via le profil :
```ts
  const producible = useMemo(() => producibleGoods(effProfile, islandRegion), [effProfile, islandRegion]);
  const producibleGoodsList = useMemo(
    () => Object.keys(economy.producers)
      .filter((g) => producible.has(g))
      .map((g) => ({ guid: g, name: economy.goodNames[g] || g }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [producible],
  );
```
Utiliser `producibleGoodsList` dans le `<select>` du bien à produire (remplace l'ancienne liste). Si `effProfile.fertilities` est vide → `producibleGoods` renvoie tous les biens sans fertilité (comportement par défaut permissif quand rien n'est déclaré).

- [ ] **Step 3: Remplacer le multi-select éphémère par `ResourceSelector` persistant**

Supprimer l'état local `islandFerts`/`setIslandFerts` et le `<select multiple>` des fertilités. À la place, en mode production, rendre :
```tsx
  {mode === "production" && islandId && (
    <label style={{ display: "block", marginTop: 6 }}>
      Ressources de l'île <span className="muted">(persistées)</span>
      <ResourceSelector value={effProfile} onChange={(p) => setIslandProfile(islandId, p)} />
    </label>
  )}
```
Dans l'appel `runIslandPlan`, remplacer `islandFertilities: islandFerts...` par `islandFertilities: effProfile.fertilities.length ? effProfile.fertilities : undefined`.

- [ ] **Step 4: Vérifier compile + build**

Run: `npx tsc --noEmit && npm run lint && npx vite build`
Expected: 0 erreur, build vert.

- [ ] **Step 5: Smoke navigateur**

Charger une île, ouvrir Plan d'île → Production. Vérifier : le `ResourceSelector` s'affiche ; cocher une fertilité met à jour la liste des biens produisibles ; recharger la page conserve les ressources (persistance). Screenshot/console propres.

- [ ] **Step 6: Commit**

```bash
git add src/ui/IslandPlanner.tsx
git commit -m "SP-A: hard producibility constraint in single-island production mode"
```

---

## Self-review

- **Couverture spec §4.1** : `resources.ts` (Task 1) — API `canProduce/missingFertilities/producibleGoods/emptyProfile` ✓. §4.2 store slice (Task 3) + persist propre (Task 2) ✓. §5 contrainte dure (Task 5) + `ResourceSelector` réutilisable (Task 4) ✓.
- **Placeholders** : chaque step porte du code réel ; pas de « TODO ». ✓
- **Cohérence des types** : `ResourceProfile {fertilities:string[]; mountainSlots:number}` identique de Task 1 à Task 5 ; `PartyState {partyIslands, islandProfiles}` identique Task 2/3 ; actions `setIslandProfile/addPartyIsland/removePartyIsland/setPartyIslands` cohérentes. ✓
- **YAGNI** : pas de fret, pas de multi-bien, pas de migration lourde (clé party propre). ✓
- **Réutilisabilité** : `resources.ts` et `ResourceSelector` sont sans dépendance vers l'UI multi-îles → réutilisés tels quels en SP-B. ✓

## NOT in this plan (→ SP-B)
`multiIslandPlan`, bascule d'onglets, `MultiIslandPanel`, worker multi-îles, drill-down. Spec/plan/impl séparés une fois SP-A vert.
