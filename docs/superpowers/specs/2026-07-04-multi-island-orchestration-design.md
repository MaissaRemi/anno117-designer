# Orchestration multi-îles + catalogue de ressources — Design

Date : 2026-07-04 · Branche : `feature/diagonal-45` (ou dédiée) · Statut : design à valider.

## 1. Contexte & objectif

Le planner est aujourd'hui **mono-île** : on charge UNE île, on maximise une population
(mode import) ou on produit UN bien (mode production). Deux manques :

1. **Catalogue de ressources par île** : le mode production a un multi-select de fertilités,
   mais **éphémère, report-only** (warning au lieu de contrainte), absent en mode population,
   non persistant. On veut un vrai profil de ressources **persistant par île** qui **contraint
   réellement** ce qu'une île peut produire.
2. **Mode multi-îles** : dans une vraie partie, on a plusieurs îles. On veut déclarer ses
   îles + leurs ressources, puis laisser le programme **assigner les rôles** (îles de
   population vs îles de production qui alimentent les premières) pour **maximiser la
   population totale**.

**Contrainte d'architecture forte (exigence utilisateur)** : modules **isolés et réutilisables
partout**, **zéro copier-coller**. Le mode multi-îles est un nouvel onglet qui **réutilise** les
systèmes existants (planner mono-île, sélection d'île, affichage), il ne les duplique pas.

## 2. Décisions (validées)

- **Plusieurs îles-pop** (N pop + M prod), pas une seule principale.
- **Assignation auto + verrouillage manuel** : le programme propose l'optimal, l'utilisateur
  peut ÉPINGLER une île à un rôle avant de relancer.
- **Fret inter-îles ignoré en v1** : logistique supposée gratuite/illimitée, on matche
  demande de biens ↔ capacité de prod. (Fret = évolution future.)
- **Ressources déclarées = fertilités/gisements (oui/non) + nb de slots montagne** (capacité
  minière). Saisie manuelle (les fertilités sont par-partie dans le jeu, non extractibles).
- **Deux modes de calcul alternables** : « Dimensionner » (léger) et « Placer tout » (lourd),
  + drill-down par île à la demande.

## 3. Décomposition (2 sous-projets, spec/plan/impl chacun)

- **SP-A — Ressources + contrainte dure** (prérequis, noyau réutilisable) : `resources.ts`,
  profils persistants (store v9), `ResourceSelector`, filtrage dur du mode production mono-île.
- **SP-B — Mode multi-îles** (onglet) : `multiIslandPlan`, bascule d'onglets, `MultiIslandPanel`,
  worker, réutilisation du planner/rendu mono-île.

Construire A puis B.

## 4. Frontières de modules (le contrat de réutilisabilité)

Trois couches, **dépendances unidirectionnelles** `domaine ← état ← UI`. Aucune couche basse
n'importe une couche haute.

### 4.1 Domaine — pur (aucun React, aucun store, aucun accès navigateur), testable isolément

**`src/economy/resources.ts`** *(nouveau)* — le modèle de ressources, seule source de vérité
« que peut produire une île » :
```ts
export interface ResourceProfile {
  fertilities: string[]; // GUIDs Fertility/Deposit présents (naturels + miniers)
  mountainSlots: number; // nb de slots montagne exploitables (capacité minière)
}
export const emptyProfile = (): ResourceProfile => ({ fertilities: [], mountainSlots: 0 });
// un bien est produisible ssi TOUTES les fertilités de sa chaîne sont présentes
export function canProduce(good: string, p: ResourceProfile, region?: string): boolean;
export function missingFertilities(good: string, p: ResourceProfile, region?: string): string[];
export function producibleGoods(p: ResourceProfile, region?: string): Set<string>;
```
Bâti sur `chainFertilities` (existant). Ne connaît ni les îles ni l'UI. **Réutilisable partout.**

**`src/optimizer/multiIslandPlan.ts`** *(nouveau)* — le méta-optimiseur, **pur** :
```ts
export interface IslandInput {
  islandId: string; grid: GridShape; profile: ResourceProfile;
  pinnedRole?: "population" | "production" | "unused";
}
export interface MultiIslandRequest {
  catalog: BuildingDef[]; islands: IslandInput[]; tierGuid: string;
  needMode?: "all" | "thresholds"; mode: "dimension" | "place";
}
export interface MultiIslandResult {
  assignments: {
    islandId: string; role: "population" | "production" | "unused";
    // pop : population, maisons, demande d'import ; prod : biens assignés + débit
    population?: number; importGoods?: ImportGood[];
    producedGoods?: { good: string; perMin: number }[];
    plan?: IslandPlanResult | ProdPlanResult; // présent si mode "place" ou drill-down
  }[];
  balance: { good: string; demand: number; supply: number; covered: boolean }[];
  totalPopulation: number; gaps: string[];
}
export function multiIslandPlan(req: MultiIslandRequest): MultiIslandResult;
```
**Réutilise `planIsland` (déjà pur) comme sous-routine — ne réimplémente aucun placement.**

### 4.2 État — la persistance (store)
Extension du store existant (slice) :
```ts
partyIslands: string[];                          // îles de la partie
islandProfiles: Record<string, ResourceProfile>; // profil par islandId
setPartyIslands / addPartyIsland / removePartyIsland / setIslandProfile / ...
```
**Persisté : clé v9** + migration v8→v9 (ajoute `partyIslands: []`, `islandProfiles: {}` ;
le layout existant est inchangé). C'est le catalogue de ressources persistant du besoin #1.

### 4.3 UI — composants partagés, zéro copier-coller
- **`src/ui/ResourceSelector.tsx`** *(nouveau)* : édite un `ResourceProfile` (checklist
  fertilités groupées naturelles/minières + champ nb slots montagne). Props `{ value, onChange }`.
  **Réutilisé à l'identique** dans (a) le mode Production mono-île, (b) chaque île du mode
  multi-îles. Un seul composant.
- **Bascule d'onglets** dans `App.tsx` : la vue éditeur actuelle devient un composant
  `EditorView` (déplacement de JSX, aucune logique changée) ; ajout d'un switch
  `Éditeur | Multi-îles`. État d'onglet local à `App` (pas dans le store métier).
- **`src/ui/MultiIslandPanel.tsx`** *(nouveau)* : la vue multi-îles (voir SP-B).

## 5. SP-A — détaillé

- `resources.ts` + tests vérité-terrain : un bien dont la chaîne exige une fertilité absente →
  `canProduce=false` ; `producibleGoods` = intersection ; slots montagne exposés pour la capacité.
- Store slice + migration v9 (test round-trip + migration).
- `ResourceSelector` : liste `economy.fertilities` (GUID→nom), groupée, cases à cocher +
  nombre de slots. Contrôlé (`value`/`onChange`).
- **Contrainte dure mono-île** : dans `IslandPlanner` mode production, le menu « bien à produire »
  est **filtré par `producibleGoods(profil de l'île courante)`** (profil lu depuis le store,
  défaut = vide = tout autorisé si l'utilisateur n'a rien déclaré). Le `requiredFertilities`
  report existant reste comme détail. La sélection éphémère `islandFerts` est remplacée par le
  profil persistant (via `ResourceSelector`).

## 6. SP-B — détaillé

### 6.1 Algorithme `multiIslandPlan` (v1, glouton contraint)
1. **Rôles épinglés** = fixés ; les autres flexibles.
2. **Potentiel pop** de chaque île candidate = `planIslandImport(île, tierGuid)` → population,
   maisons pleines, **demande d'import** (biens/min). (Réutilise le planner pur.)
3. **Assignation** (maximiser Σ population, demande couvrable par la prod) :
   - trier les îles par potentiel-pop décroissant ;
   - marquer en `population` tant que la demande cumulée reste couvrable par la capacité de prod
     des îles restantes ; les autres deviennent candidates `production` ;
   - pour chaque bien du panier de demande agrégé, assigner sa production à la meilleure île
     `production` **qui peut le produire** (`resources.canProduce`) et a de la capacité ;
   - respecter les rôles épinglés comme contraintes dures ; îles sans rôle utile → `unused`.
4. **Capacité de prod** : mode `dimension` = proxy léger (aire terre × dispo ressource, slots
   montagne pour les mines) ; mode `place` = `planIslandProduction` réel par (île, bien) assigné.
5. **Sortie** : rôles, population totale, `balance` demande/offre par bien, `gaps` (biens non
   couverts, îles sans ressource), et les `plan` complets si mode `place`.

### 6.2 UI `MultiIslandPanel`
- **Sélection des îles de partie** : réutilise `IslandPicker` (ajout au lieu de charger).
- **Par île** : nom + `ResourceSelector` (réutilisé) + rôle épinglé optionnel (auto par défaut).
- **Paramètres globaux** : tier-cible, needMode, bouton `Dimensionner` / `Placer tout`.
- **Calcul dans un worker** (`multiIslandPlanWorker`, comme l'existant `islandPlanWorker`),
  car `planIsland` y tourne N fois.
- **Résultat** : tableau par île (rôle, population/biens, faisabilité) + bilan global
  import/export + trous. **Drill-down** « voir le layout » d'une île → réutilise le rendu
  mono-île (`renderFullCanvas` / charge l'île dans l'éditeur avec son plan appliqué).

### 6.3 Réutilisation garantie (checklist anti-duplication)
- Placement : `planIsland`/`planIslandImport`/`planIslandProduction` appelés, jamais copiés.
- Ressources : `resources.ts` (SP-A) est l'unique juge de producibilité, mono ET multi.
- UI : `ResourceSelector` et `IslandPicker` partagés ; le rendu réutilise `render/`.

## 7. Flux de données
Store (partyIslands + profils, persistés v9) → `MultiIslandPanel` construit `MultiIslandRequest`
→ worker → `multiIslandPlan` (→ `planIsland` ×N, → `resources.ts`) → `MultiIslandResult` →
tableau + drill-down (→ rendu mono-île).

## 8. Tests
- `resources.ts` : producibilité vérité-terrain (chaîne à fertilité absente refusée ; intersection).
- `multiIslandPlan` : demande couverte par l'assignation ; contrainte ressource respectée
  (une île sans la fertilité ne se voit jamais assigner le bien) ; rôle épinglé honoré ;
  max-pop (plus d'îles-pop si la prod suit) ; déterminisme.
- Persist : round-trip v9 + migration v8→v9 (profils vides ajoutés, layout intact).
- Smoke UI : onglet s'affiche, `ResourceSelector` contrôlé, calcul renvoie un résultat.

## 9. Ordre de construction & risques
- **SP-A d'abord** (noyau + contrainte + persistance), **SP-B ensuite**.
- Risque principal : le méta-optimiseur exécute `planIsland` N fois (lourd) — mitigé par le
  worker + le mode `dimension` léger (proxy de capacité) par défaut, `place` sur demande.
- Risque UI : introduire des onglets sans casser l'éditeur — mitigé en extrayant `EditorView`
  par simple déplacement de JSX (aucune logique touchée).
- Hors v1 (motivé) : fret/routes commerciales, multi-bien optimal par île de prod (v1 = glouton
  par bien), choix automatique du tier par île (v1 = tier global).
