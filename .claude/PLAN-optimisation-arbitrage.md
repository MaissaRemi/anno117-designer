# Leviers pour la qualité des plans d'île

Ouvert au 2026-08-08 après la cascade de main-d'œuvre, les dieux et les chaînes de production.
Note d'auto-évaluation de la feature à l'ouverture : **6,3/10** — fidélité au jeu ~8, légalité
des plans ~8, **qualité d'optimisation ~4**.

Mesure de référence à l'ouverture, `roman_island_medium_01` en pleine résolution, emplacements
+ production locale cochés : 22 901 habitants · 640/817 maisons au palier cible (78 %) ·
couverture minimale 56 % · bilan positif (🔥 +455) · main-d'œuvre couverte · ~5 à 12 s.

**État des deux leviers, après mesure :**

| levier | verdict | effet mesuré |
|---|---|---|
| 1 — coût réel dans la sélection | ✅ fait, voie (b) | **+2,2 %** d'habitants sur celtic, 0 % sur medium_01, +7 à 10 % de temps |
| 2 — passe de réparation locale | ❌ réfuté | 0 % sur 7 configurations, −0,5 % sur la huitième, +12 à 42 % de temps |

La leçon commune : **le sol est la contrainte qui mord, pas la couverture.** Poser plus de
services ne rapporte rien ; mieux CHOISIR entre les plans, si.

---

## Levier 2 — PASSE DE RÉPARATION LOCALE : ❌ TENTÉ, MESURÉ, RÉFUTÉ (2026-08-08)

**L'hypothèse était :** couverture minimale 56 %, donc près d'une maison sur deux hors de
portée d'au moins un service ; les moteurs posant les services sur des trames régulières, une
maison qui rate un seuil le rate souvent *de peu*, et rien ne repasse derrière pour combler ce
trou. Une passe de réparation devait donc être du gain facile.

**Ce qui a été construit** (dans `planLattice`, pas après le choix du plan — toute la
géométrie y est locale, la refaire ailleurs aurait dupliqué le moteur) : pour chaque type de
service encore posable, le gain marginal en habitants d'une copie supplémentaire, emplacement
par emplacement, `evaluate(masque | bit) − evaluate(masque)` ; puis pose au maximum du gain,
remesure complète, et RECUL SUR POSE si le total livré n'a pas monté.

**Mesures, deux îles × quatre seuils de densification, A/B strict :**

| île | floor | habitants OFF | ON | Δ | temps |
|---|---|---|---|---|---|
| medium_01 (Patriciens) | 1 / 0,9 / 0,8 | 13 574 / 13 574 / 14 498 | identique | 0,0 % | +12 à +18 % |
| medium_01 | 0,6 | 15 697 | 15 620 | **−0,5 %** | +42 % |
| large_07 (Nobles) | 1 / 0,9 / 0,8 / 0,6 | 9 966 | identique | 0,0 % | +13 à +25 % |
| medium_01, plan complet | — | 16 660 | 16 640 | −0,1 % | +10 % |

Sept configurations sur huit rendent un plan **bit-à-bit identique** : la passe pose, mesure,
et défait chacune de ses propositions.

**Pourquoi.** Le sol est la contrainte qui mord, pas la couverture. La phase de densification
existante sature déjà l'île : à seuil 1, toute copie supplémentaire détruit plus
d'emplacements de maison qu'elle n'en fait monter de palier. Le seul régime où des poses
passent le remesurage est le plan complet — et là le gain (+225, +499 habitants mesurés au
niveau du lattice) ne survit pas à l'aval : le routage d'eau, la démotion `deadTypes` et la
bande de 2 % de `better()` l'absorbent entièrement.

**Deux enseignements gardés en dur :**

- La fenêtre carrée `portée × 0,6 / √2` — celle que la densification utilise pour choisir
  *où* poser — est **inutilisable comme critère de décision**. Elle surestime largement ce
  qu'une copie atteint en distance-rue : dans la première version, les deux premiers tours
  proposaient la MÊME position avec le MÊME gain, la copie posée ne couvrant rien de neuf.
  Elle ne vaut que comme générateur de propositions.
- `viableSubset` (`planLattice.ts`) a été extrait de `placeHouses` et documenté comme LA
  définition de « ce que ce plan livre ». La première version de la passe jugeait sur la
  population brute et acceptait des poses que le garde-fou punissait juste après en rasant des
  maisons entières : −1,2 % sur `celtic_island_large_07` pour un gain annoncé positif. C'est
  la seule chose de ce chantier qui reste dans le dépôt.

**Ce que ça dit du reste.** L'upside restant n'est pas dans « poser plus de services ». Il est
dans le levier 1 et dans l'arbitrage recette/palier.

---

## Levier 1 — LE COÛT RÉEL DANS LA SÉLECTION : ✅ FAIT, voie (b) (2026-08-08)

**Le constat, qui était juste.** `better()` comparait les plans candidats sur les habitants et
la viabilité d'un plan NU. Comptoir, exploitations, ateliers, conversions de main-d'œuvre et
effets de zone étaient appliqués APRÈS le choix. On optimisait une approximation, puis on
corrigeait — et le correctif (le recul sur pose) ne peut que retrancher, jamais rattraper un
mauvais choix de départ. C'est ce décalage qui avait produit le bilan à −1.

**Ce qui a été fait.** Voie (b). Tout l'aval — de `chosen` jusqu'au `return` — est extrait en
`finalize(chosen: Evaluated): IslandPlanResult`. Le pré-tri par `better()` ne décide plus, il
PRÉSÉLECTIONNE : les trois premiers candidats subissent le pipeline complet, et `betterFinal`
tranche sur ce qui sort (jouable, puis bilan tenu, puis habitants, puis solde net). Extraction
du maximum plutôt que `sort` — `better()` n'est pas transitif, sa bande d'égalité à 2 % l'en
empêche.

**Mesures, A/B strict (seuil 1, emplacements + production locale) :**

| île | 1 finaliste | 3 finalistes | Δ |
|---|---|---|---|
| roman_island_medium_01 (Patriciens) | 16 660 hab, 6 526 ms | 16 660 hab, 7 209 ms | 0 %, +10 % de temps |
| celtic_island_large_07 (Nobles) | 8 968 hab, 10 426 ms | **9 161 hab**, 10 452 ms | **+2,2 %** |

Le détail de celtic dit tout : le pré-tri classait EN TÊTE un plan nu à 9 820 habitants, qui
n'en livre que 8 968 ; le plan nu à 9 956, relégué au troisième rang, en livre 9 161. Les deux
sont à 1,4 % l'un de l'autre — dans la bande d'égalité — et le départage se faisait alors sur
des critères secondaires (vivier, raccordement, nombre de maisons) qui ne prédisent rien.

**Écart plan nu → plan livré : −9 % à −12 %.** C'est l'ampleur de l'approximation que
`better()` optimisait. Verrouillé par un test de non-régression (`islandPlan.test.ts`,
« l'arbitrage se fait sur le plan LIVRÉ »), qui échoue sur l'ancien code.

**Pourquoi 3 et pas plus.** Mesuré à 6 : les rangs 4 et 5 s'effondrent (2 886 et 9 793
habitants livrés contre 9 161 et 16 660) — ce sont des recettes que le pré-tri écarte à juste
titre. Le coût de l'aval est de 300 à 380 ms par finaliste, soit ~+7 % par plan.

**Ce qui reste sur ce levier.** La voie (a) — estimation bon marché du coût aval intégrée
directement à `better()` — n'a pas été faite et n'est plus prioritaire : la voie (b) capte
l'essentiel. Elle redeviendrait utile si le nombre de recettes essayées explosait.

---

## Reliquat d'hygiène (+0,2, une heure)

Les trois `avg = capByTier[g] / tierCounts[g]` (`islandPlan.ts`, raccord du comptoir,
emplacements, production locale) décrémentent des agrégats DÉRIVÉS en utilisant une moyenne
comme substitut de la maison réelle : le résultat dépend de l'ordre des retraits, et le
`Math.max(0, …)` masque la dérive. Or `WorkforceLedger.settle()` recalcule déjà ces mêmes
agrégats depuis les parcelles survivantes, et les écrase dès qu'il y a une conversion.

Correctif : ne rien décrémenter. Tenir un ensemble d'uid morts et dériver
`tierCounts` / `capByTier` / `residents` / `houses` de l'ensemble survivant, en un seul endroit.
C'est la dernière survivance du motif « accumulation de deltas sur un état qui bouge » corrigé
partout ailleurs.

---

## Réserve d'efficacité, si le levier 1 coûte trop cher en temps

Mesuré : 92 % du temps d'un plan est dans les passes de `planLattice`, ~13 passes par plan.
Le grand-livre entier pèse 1 %. Pistes, dans l'ordre :

- `settle()` rejoue un `run()` complet — 4 balayages de parcelles sur 17 — alors que le glouton
  sort à la première itération quand la demande est déjà couverte.
- Le recul sur pose est linéaire ; une dichotomie le ramènerait à ⌈log₂ n⌉ appels, mais c'est
  −69 % de 0,78 % : sans intérêt tant que le reste n'a pas bougé.
- Les caches de `needsModel` sont des tableaux denses de `2^nBits` par palier pour 4 à 42
  entrées réellement utilisées (0,26 % d'occupation). Passer en `Map` supprime aussi la falaise
  mémoire latente à `MAX_CACHED_BITS = 20` (~42 Mo alloués d'un coup dans le worker).

---

## Ce qu'il ne faut PAS refaire

- Ne pas conditionner la complétion de recette aux options du plan : cela invalide toute
  comparaison A/B et prive le mode simple d'un gain majeur (mesuré 15 881 contre 26 028
  habitants).
- Ne pas rétrécir le budget d'essais pour financer des variantes : `keep` est un plafond MOU,
  `candidateRecipes` y ajoute les siennes. Réserver les places, ne pas diviser.
- Ne pas fusionner la passe du choix de divinité avec le raffinage : le patron serait élu sur
  le déficit d'un plan et appliqué à un autre.
- Ne jamais tenir le bilan de l'île par accumulation de deltas. Partir de la somme absolue
  publiée par `WorkforceLedger.settle()`.
- Ne pas reprendre le levier 2 sous une autre forme (« min-cover sur les parcelles qui ratent
  UNE catégorie », « densifier là où la couverture est la plus basse »…) sans avoir d'abord
  desserré la contrainte de SOL. Huit configurations mesurées : la couverture n'est pas le
  goulot. Toute passe qui pose des services de plus repartira du même mur.
- Ne jamais juger un plan sur la population BRUTE. Passer par `viableSubset` — le garde-fou de
  viabilité rase des maisons entières, et il rend négatif un gain qui semblait positif.
