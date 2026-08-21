# Panier de blueprints — conception

Date : 2026-08-22. Module : `src/prodlayout/`. Statut : validé, prêt pour le plan.

---

## 1. Le besoin

Composer un **panier libre** de bâtiments — « 2 boulangeries, 1 moulin, 3 élevages ovins,
1 entrepôt » — et obtenir un plan posable tel quel : le plus petit possible, **entièrement
fonctionnel**, avec une **sortie de route** par laquelle le comptoir de l'île branchera
l'ensemble.

Ce que « fonctionnel » veut dire, en quatre exigences que le catalogue déclare déjà :

| Exigence | Donnée du catalogue | Exemple |
|---|---|---|
| Le bâtiment et ses champs | `field.tiles` | « Élevage ovin » `g2786`, 3×3, `field.tiles: 3` — les trois champs de moutons. Une ferme de céréales en demande 140, un cultivateur d'olives 160. |
| Le bâtiment et son aire libre | `freeArea` | Un bûcheron `g2878` produit en proportion des cases LIBRES dans un rayon de 8, et en exige 80. Le serrer l'étrangle. |
| L'accès route | `needsRoad` | Presque tous les producteurs. |
| L'expédition | `transporterRange` | Un producteur hors de portée d'un entrepôt **en distance-rue** n'expédie RIEN en jeu, et coûte pourtant son entretien. |

La cinquième exigence est nouvelle et ne vient pas du catalogue : **la sortie de route**. Au
moins une case de route doit atteindre le bord du plan et être reliée par la voirie à un
entrepôt. C'est le fil unique par lequel le plan, recopié sur une île, se raccorde au
comptoir général.

---

## 2. Ce qui existe déjà, et ce qui manque

`src/prodlayout/` fait le placeur, les champs, les aires libres, les routes, la portée de
charrette et la boîte englobante minimale. Trois manques le séparent du besoin :

1. **L'entrée est une chaîne, pas un panier.** `planProductionLayout(catalog, targetDefId,
   count)` part d'un bâtiment terminal et remonte l'arbre. On ne peut pas dire « ces
   bâtiments-là, ceux que j'ai choisis ».
2. **Aucune règle de sortie de route.** Le squelette peint des routes qui touchent les
   bords par accident, jamais par contrat, et le résultat n'expose aucun point de
   raccordement.
3. **L'objectif récompense le gaspillage.** Mesure sur le pain romain avant tout
   changement :

```
pain ×1 : 18×18 = 324 cases | eff 92,9 % | bât 92  champs 140 routes 69 | bords N3 S3 O18 E18
pain ×2 : 23×23 = 529 cases | eff 92,1 % | bât 124 champs 280 routes 83 | bords N3 S3 O23 E23
```

`O23 E23` : les colonnes de gauche et de droite sont **entièrement en route**. 46 des
83 cases de route servent un bord, donc des bâtiments d'un seul côté. Or `efficiency =
(bâtiments + champs + routes) / (w × h)` les compte comme utiles : **retirer ces 46 cases
ferait BAISSER le score**. `better()` classant sur l'efficacité avant la surface, le critère
actuel préfère un plan qui gaspille. C'est la raison de fond du changement d'objectif en §5.

---

## 3. Architecture : étendre, et faire de la chaîne un cas du panier

`planProductionLayout` devient un appel de `planFromBasket`. Un seul chemin de placement.

Le module n'est pas dupliqué dans un nouveau dossier, pour une raison structurelle :
`frontiere.test.ts` lit les sources par `import.meta.glob("./*.ts")`. **Tout fichier ajouté
au dossier hérite** de l'interdiction d'importer `src/optimizer/` ou `src/economy/`, et de
l'interdiction d'`Math.random`, `Date.now` et `new Date`. Un module frère devrait recopier
ce garde-fou, donc le laisser dériver.

### Nouveaux fichiers

| fichier | rôle |
|---|---|
| `basket.ts` | Le panier normalisé — doublons fusionnés, ordre total, comptes ≤ 0 écartés — et le **bilan des biens** : production moins consommation, en rationnels exacts (`frac.ts`). Rend surplus, déficits, et les avis de `slotType`. |
| `complete.ts` | « Compléter » : point fixe qui ajoute les producteurs manquants jusqu'à déficit nul. Ajouter un moulin crée un besoin de céréales, d'où le point fixe, avec la garde anti-cycle que `chain.ts` porte déjà. Rend un **nouveau panier**, éditable ensuite. |
| `exit.ts` | La sortie de route : couloir garanti jusqu'au bord demandé, point exposé dans le résultat, connexité à l'entrepôt vérifiée. |
| `search.ts` | La recherche de boîte : croissance jusqu'à la première boîte **servie**, puis rétrécissement vers la plus petite. Sort de `pack.ts`. |

### Fichiers modifiés

| fichier | changement |
|---|---|
| `pack.ts` | `served`, booléen strict, remplace `gaps.length` dans `better()`. L'efficacité **sort du critère de décision** et reste une mesure affichée. La recherche de boîte part dans `search.ts` ; `pack.ts` redevient « poser dans une boîte donnée ». |
| `roads.ts` | Le squelette cesse de peindre les colonnes de bord. L'orientation de l'épine suit le rapport de la boîte : épine horizontale si large, verticale si haute. |
| `occupancy.ts` | Un état `BLOCKED` pour les cases hors forme. `fits`, `fillFields`, `paintSkeleton` et `freeAround` testent tous `=== FREE` : ils respectent le masque **sans changer**. |
| `index.ts` | Porte `planFromBasket`. `layout.grid.usable` porte enfin le vrai masque au lieu d'être rempli de `true`. |

---

## 4. Le contrat

```ts
export type ExitSide = "nord" | "sud" | "est" | "ouest";

export type BoxSpec =
  | { mode: "auto" }                                  // plus petite boîte servie
  | { mode: "taille"; w: number; h: number }          // dimensions imposées
  | { mode: "forme"; w: number; h: number; usable: boolean[] };

export interface BasketPlanOptions {
  exitSide: ExitSide;
  box?: BoxSpec;                       // défaut { mode: "auto" }
}

// « Importé » ne concerne QUE la complétion : le panier littéral ne déduit rien, donc il
// n'a pas à savoir d'où vient la farine. C'est `completeBasket(basket, lookup, imported)`
// qui s'abstient d'appeler un producteur pour un bien que l'utilisateur fournit lui-même.
completeBasket(basket, lookup, imported?): Basket

export type BasketPlan = LayoutPlan & {
  served: true;                                       // toujours vrai : sinon c'est un refus
  exit: { x: number; y: number; side: ExitSide };
  advisories: Advisory[];                             // slotType à vérifier sur l'île
};

export interface PlanRefus {
  refuse: true;
  raison: string;
  nonServis: Unmet[];
}

export type Unmet =
  | { kind: "champ"; defId: string; uid: string; obtenu: number; requis: number }
  | { kind: "aire-libre"; defId: string; uid: string; obtenu: number; requis: number }
  | { kind: "route"; defId: string; uid: string }
  | { kind: "portee"; defId: string; uid: string; distance: number; portee: number }
  | { kind: "non-pose"; defId: string; manque: number }
  | { kind: "sortie"; side: ExitSide };

/** Ce que le module ne peut pas vérifier hors terrain — signalé, jamais bloquant. */
export interface Advisory {
  defId: string;
  slotType: string;
}

planFromBasket(catalog, basket, opts): BasketPlan | PlanRefus
```

`planProductionLayout(catalog, targetDefId, count, opts)` **garde sa signature actuelle** :
elle construit un panier depuis `buildChain`, puis appelle `planFromBasket` avec
`exitSide: "sud"` et `box: { mode: "auto" }`. Ce défaut n'est pas arbitraire — l'épine
actuelle du squelette est peinte juste sous l'entrepôt, donc c'est le bord sud que la
voirie atteint déjà. Les six tests existants de `index.test.ts` doivent passer sans être
modifiés, hors ceux que le changement d'objectif déplace légitimement, et tout déplacement
doit être mesuré et justifié plutôt qu'accepté.

`served` est **binaire et strict**. Aucun plan partiellement servi n'est livré comme un
succès : les champs sont complets ou le plan est refusé. C'est la leçon de la falaise du
verdict, dont le coût mesuré fut de 75 % de la population sur deux îles — un plan effondré
livré `viable=true` ne se voit pas.

Le refus n'est donc pas un `throw` à message vague. Il **chiffre chaque manque**, parce
qu'en modes `taille` et `forme` il n'y a plus de rattrapage par agrandissement : le refus
est la sortie normale d'une contrainte trop serrée, et il doit dire quoi ajouter.

---

## 5. L'objectif : servi d'abord, petit ensuite

`better()` classe désormais dans cet ordre :

1. `served` — vrai avant faux, sans nuance.
2. `w × h` croissant.
3. `|w − h|` croissant, pour départager à surface égale.

L'efficacité disparaît du classement. Elle reste calculée et affichée, avec un
**dénominateur corrigé** : la surface **utilisable**, non `w × h`, sans quoi une forme
trouée afficherait un score faux.

En mode `auto`, `search.ts` fait croître la surface cible jusqu'à la première boîte servie,
puis redescend pour trouver la plus petite. En modes `taille` et `forme`, il n'y a **aucune
recherche** : une seule tentative, servie ou refusée.

Conséquence assumée : l'invariant de minimalité ne concerne que le mode `auto`. Boîte
imposée, il n'y a plus rien à minimiser.

---

## 6. Les sept invariants

Chacun est un test, et chacun ferme un trou par lequel un plan injouable passerait.

1. **Déterminisme** — deux appels identiques rendent un plan identique. Sans lui, comparer
   deux versions du placeur ne rendrait que du bruit de placement ; le module a déjà ce
   test et il doit survivre au changement d'objectif.
2. **Sortie** — une case route sur le bord demandé, à distance-rue finie d'un entrepôt.
3. **Connexité** — tout bâtiment sur route touche une route de la **même composante** que
   la sortie. Sans cet invariant, deux îlots de voirie séparés passeraient les invariants 2
   et 4 tout en étant injouables : le comptoir ne verrait que le premier.
4. **Service** — les quatre conditions du catalogue, vérifiées séparément : champs
   complets, aire libre satisfaite, `needsRoad` sur route, `transporterRange` respectée en
   distance-rue.
5. **Minimalité** (mode `auto`) — aucune boîte servie plus petite au pas de la recherche.
6. **Refus utile** — un panier volontairement trop grand pour sa boîte rend un `PlanRefus`
   dont les `nonServis` désignent le bon bâtiment et le bon manque chiffré. Un refus qui ne
   dit pas quoi ajouter est un refus inutilisable.
7. **Non-régression** — le pain romain ×2 tient en **≤ 529 cases** et reste entièrement
   servi. C'est la référence mesurée du §2 : le changement d'objectif doit améliorer ou
   égaler, jamais dégrader.

La frontière du module (`frontiere.test.ts`) couvre les nouveaux fichiers par glob, sans
modification.

---

## 7. Hors périmètre, assumé

- **Pose sur une île réelle.** C'est le moteur d'île, un autre module, une autre frontière.
- **Maisons ouvrières.** La main-d'œuvre est chiffrée dans le récapitulatif, jamais logée.
- **Coûts de construction.** Absents de l'export du jeu. La ligne n'est pas affichée plutôt
  que remplie d'un chiffre inventé.
- **La vérification des `slotType`** — mines, forêts, marais, côtiers, prairies. Hors
  terrain, le module ne peut pas savoir si l'emplacement existe. Ces bâtiments sont donc
  **posés, avec un avis** (`Advisory`) : la géométrie du plan reste juste et utile, c'est la
  disponibilité de l'emplacement qui se vérifie sur l'île.

  Le premier jet de cette spec les refusait. **La donnée a tranché contre** : les
  12 bâtiments porteurs de `freeArea` ont **tous** un `slotType`. Les refuser aurait rendu
  la contrainte d'aire libre inatteignable — donc son code mort et son invariant vide — et
  aurait interdit tout blueprint de bûcheron ou de carrière, qui sont des demandes
  légitimes. Le refus reste réservé à ce qui casse réellement le plan : champs incomplets,
  aire libre insuffisante, accès route absent, portée de charrette dépassée, sortie
  impossible.
- **Passe d'amélioration locale du placeur.** À ne construire que si une mesure montre le
  glouton visiblement lâche. Le recuit simulé reste écarté : la géométrie plafonne à +3 %
  sur ce projet quand le choix de la recette vaut ×1,48, et payer l'indéterminisme pour ce
  gain-là serait un mauvais échange.

---

## 8. Phases

**Phase 1 — le module et ses tests.** L'algorithme, avec les trois modes de boîte. C'est le
cœur de la demande.

**Phase 2 — l'onglet Production.** Éditeur de panier (ajouter, retirer, changer les
comptes), bouton « compléter », choix du bord de sortie, champs largeur/hauteur pour le mode
`taille`. Affichage du refus chiffré.

**Phase 3 — le pinceau de forme.** L'éditeur sait déjà peindre une zone constructible : le
mode `forme` est du raccordement, pas de l'invention. Chiffré à part parce que c'est de
l'interface.

Les trois modes de boîte sont dans la phase 1 **au niveau de l'algorithme**, y compris
`forme`. Le masque ne coûte presque rien de plus que les dimensions imposées, et le refuser
maintenant obligerait à repasser plus tard dans `trim`, `efficiency` et l'orientation du
squelette — les trois endroits que le masque force à corriger.
