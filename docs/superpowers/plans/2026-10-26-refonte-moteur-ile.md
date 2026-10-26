# Refonte du moteur d'île — découpage complet

Rédigé le 2026-10-26, après un audit mesuré du moteur sur cinq îles réelles, réglages par
défaut de l'interface. Ce document est la feuille de route du moteur : chaque étape se livre
seule, sur sa branche, mesurée avant et après, puis fusionnée dans `dev`.

---

## Le constat qui motive la refonte

**Le but du projet** : générer un plan d'île organisé avec **les bâtiments que le joueur a
choisis**.

**Ce que fait le moteur** (`planIslandImport` → `planLattice`) : il maximise la population d'un
palier. Le joueur choisit un palier, le moteur décide de tout le reste. L'optimiseur « liste de
courses » qui posait une commande a été retiré le 2026-06-21 (`009c1e6`).

**Et il démolit ce qu'il pose.** Ordre actuel : grille de routes sur toute l'île → services en
treillis sur toute l'île → maisons partout où il reste de la place → `viableSubset` rase les
maisons jusqu'à ce que le bilan d'attributs de l'île repasse à zéro. Services et routes restent.

| île (palier sommet, défauts UI) | maisons posées | maisons gardées | services gardés |
|---|---|---|---|
| `celtic_island_large_07` | 2 059 | 183 (−91 %) | 187 |
| `roman_island_large_03` | 3 126 | 240 (−92 %) | 301 |

Plan livré sur `celtic_island_large_07` : 313 services pour 245 maisons, 23 % de la terre en
routes, **45 % de terre vide**. La population tombe juste sous un seuil de rang de cité
(4 999 / 7 489 / 9 996 / 59 958 pour des seuils à 5 000 / 7 500 / 10 000 / 60 000) : c'est la
règle « bilan d'île ≥ 0 » qui fixe le résultat, et elle n'a jamais été vérifiée en jeu.

**Les tests ne le voient pas** : ils vérifient la cohérence interne (pas de chevauchement,
comptoir présent, sommes justes), jamais qu'un plan a du sens.

---

## La vision à long terme

**Le joueur commande, le moteur dispose.**

```
COMMANDE            NOMENCLATURE            DISPOSITION                 RAPPORT
ce que je veux  →   liste exacte des    →   quartiers + zone de     →   servi / refus chiffré,
(maisons, services, bâtiments (solveur      production posés sur        bilan d'attributs
 production)        d'économie existant)    le masque réel de l'île     présenté comme un RISQUE
```

Principes qui tranchent les choix de chaque étape :

1. **Ne jamais démolir pour satisfaire un modèle non vérifié.** Un bilan négatif se signale,
   chiffré par maison et par attribut ; le joueur décide. Le comportement strict reste
   disponible en option.
2. **Dimensionner avant de poser.** Une passe ne défait pas la précédente : les services sont
   calculés pour les maisons qui seront réellement là, pas pour une île pleine qu'on vide ensuite.
3. **Mesurer la qualité du plan, pas seulement les habitants.** « Habitants sur 55 îles » est
   plafonné par la règle elle-même ; il ne dit rien de l'usage du sol. Chaque étape se juge sur
   les métriques de l'étape 1 et sur le rendu PNG.
4. **`src/prodlayout/` est la base saine** : déterministe, verdict `served` strict, refus qui
   dit ce qui manque. La disposition à venir s'en inspire au lieu d'empiler des passes sur
   `islandPlan.ts`.
5. **Maximiser la population devient un MODE**, « remplir le reste de l'île », et non plus
   l'unique raison d'être du moteur.

---

## Les étapes

Légende : ✅ fait · 🔧 en cours · ⏳ à faire.

### Étape 1 — L'instrument de mesure ✅

Sans lui, aucune étape suivante n'est jugeable.

- `src/optimizer/planQuality.ts` : métriques pures d'un plan livré — part du sol en maisons,
  services, routes, terre vide ; services par maison.
- `src/optimizer/invariants.ts` : deux règles `suspect` — plus de services que de maisons,
  plus de 30 % de terre constructible laissée vide.
- `src/optimizer/quality.sweep.test.ts` : balayage sauté sauf `QUALITY=1`, réglages par défaut
  de l'interface, imprime le tableau des métriques et écrit chaque plan en JSON si
  `QUALITY_OUT` est défini.
- `tools/render_plan.py` : rend ces JSON en PNG.

**Fini quand** : la référence chiffrée ci-dessous est relevée sur l'échantillon.

### Étape 2 — Le bilan d'attributs devient un indicateur ✅

- Nouvelle option `viability: "indicatif" | "strict"`, **`"indicatif"` par défaut**.
- En indicatif : aucune démolition par `viableSubset`, classement des candidats sur la
  population brute, ateliers non bornés par le bilan (ils restent bornés par la demande, la
  main-d'œuvre, la place et le quota), pas de recul sur bilan.
- Le verdict `viable` reste honnête (tolérance nulle + plancher de bruit) et le rapport affiche
  le déficit **par maison** pour chaque attribut.
- En strict : comportement historique inchangé, curseur « risque toléré » conservé.
- Interface : case « Respecter strictement le bilan d'attributs (démolit des maisons) »,
  le curseur de tolérance n'apparaît qu'en strict.

**Fini quand** : sur l'échantillon, services par maison < 1 et terre vide < 25 % en indicatif ;
le mode strict rend exactement la référence ; un test bloquant verrouille les deux.

**Livré.** Toutes les décisions qui dépendaient du bilan passent par `regleDeBilan()`
(`islandPlan.ts`) : garde-fou de `planLattice`, trois comparateurs, budget des ateliers, recul
sur pose. Mesuré sur l'échantillon, réglages par défaut :

| île | maisons strict → indicatif | habitants | au palier % | pire déficit/maison | svc/maison | vide % |
|---|---|---|---|---|---|---|
| `roman_island_small_01` | 375 → 498 | 7 406 → 9 103 | 44 → 40 | Incendie −2,2 | 0,27 → 0,21 | 23,5 → 16,3 |
| `roman_island_medium_01` | 903 → 1 106 | 23 492 → 24 399 | 71 → 72 | Incendie −5,3 | 0,24 → 0,23 | 16,1 → 12,9 |
| `roman_island_medium_05` | 344 → 1 309 | 11 542 → 32 286 | 98 → 83 | Incendie −5,8 | 0,78 → 0,24 | 29,2 → 13,4 |
| `roman_island_large_03` | 320 → 3 008 | 9 966 → 64 854 | 96 → 52 | Incendie −3,4 | 1,95 → 0,21 | 46,5 → 12,9 |
| `celtic_island_small_01` | 176 → 418 | 3 570 → 6 428 | 99 → 78 | Bonheur −5,5 | 0,81 → 0,29 | 33,2 → 30,7 |
| `celtic_island_medium_04` | 243 → 876 | 4 982 → 13 807 | 100 → 81 | Bonheur −8,7 | 0,78 → 0,23 | 39,1 → 21,1 |
| `celtic_island_large_07` | 245 → 1 932 | 4 992 → 28 658 | 100 → 75 | Bonheur −10,6 | 1,24 → 0,20 | 46,1 → 18,3 |

- Le mode strict rend des plans **identiques au bâtiment et à la route près** à la référence,
  sur les sept îles.
- `celtic_island_small_01` reste à 30,7 % de vide : c'est un lobe séparé par l'eau, sans route
  possible vers le comptoir, écarté à dessein par `keepMainLandmass`. Pas un défaut de l'étape.
- La part au palier baisse : le strict ne gardait que les maisons les mieux desservies. En
  nombre, les maisons au palier sont 3 à 6 fois plus nombreuses en indicatif.
- **Le revers, chiffré** : selon le modèle d'attributs, ces villes sont en déficit — jusqu'à
  −10,6 de Bonheur par maison. Le modèle n'est pas vérifié en jeu (test transverse n° 1), et le
  remède n'est plus la démolition mais la compensation, à l'étape 3.
- Verrouillé par `bilanIndicatif.test.ts` (lourd) ; les cinq tests qui portaient le contrat
  strict le demandent désormais explicitement.

### Étape 3 — Nettoyage final cohérent ✅ (objectifs revus par la mesure)

Une fois les maisons fixées (et seulement alors) :

- **retirer** les services qui ne servent aucune maison et les routes qui ne desservent rien,
  puis réévaluer une seule fois. Cette voie a été réfutée en août (−13 819 habitants), mais
  sous le régime de démolition, où retirer un service déclenchait d'autres rasages. À remesurer ;
- **compenser** le déficit d'attributs au lieu de démolir : densifier les institutions
  (Vigiles, Medici, Custodia…) là où les maisons sont en déficit, tant que le gain par case
  dépasse celui d'une maison. C'est le pendant constructif du garde-fou strict.

**Fini quand** : part des routes en baisse mesurable sans perte de population au palier, et
pire déficit par maison réduit d'au moins moitié sur l'échantillon.

**Mesuré avant de coder** (plans indicatifs, trois îles) — et deux des trois objectifs tombent :

| | `roman_island_medium_05` | `celtic_island_large_07` | `roman_island_large_03` |
|---|---|---|---|
| services qui ne servent aucune maison | 0 / 316 | 0 / 378 | 0 / 626 |
| routes ne touchant aucun bâtiment | 811 / 8 391 | 1 637 / 11 982 | 2 361 / 18 938 |
| couverture des institutions | 86 à 100 % | 83 à 90 % | 81 à 96 % |

- **Retirer des services : rien à gagner.** Le sur-provisionnement (§3.6 de `ETAT-ET-SUITE`)
  venait entièrement de la démolition ; sans elle, chaque copie sert des maisons.
- **Compenser par les institutions : presque rien à gagner dans le modèle.** Leurs effets ne
  se cumulent pas par type, et elles couvrent déjà 81 à 100 % des maisons : passer à 100 %
  rapporte moins de 0,2 point par maison face à des déficits de 1,5 à 10,6. Le déficit est
  STRUCTUREL dans le modèle — rang de cité contre plafond d'attributs par maison. Seul le jeu
  peut dire s'il est réel (test transverse n° 1).
- **Routes** : les cases qui ne touchent aucun bâtiment sont surtout des liaisons. Les
  culs-de-sac proprement dits ne pèsent que ~0,5 % de la voirie.

**Livré** :

- `roadCleanup.ts` : `pruneDeadEnds`, élagage itératif des culs-de-sac, appliqué en toute fin
  de `finalize` — sans effet possible sur couverture ni connexité. 48 à 60 cases par île.
- Départage par bilan en indicatif : à 2 % de population près, le plan le plus sain gagne, au
  pré-tri comme entre finalistes. `roman_island_medium_01` : Incendie −5,26 → −1,99 par maison
  pour −0,7 % d'habitants (24 399 → 24 236) ; sans effet notable ailleurs.
- Repère pour le joueur : la recette « tous les services » réduit le déficit au prix de la
  population — `roman_island_medium_05` −5,7 → −2,3 par maison (32 163 → 24 670 habitants),
  `celtic_island_large_07` −10,6 → −7,7 (28 658 → 27 350).

**Ce qui reste du problème des routes** (~25 % du sol) est TOPOLOGIQUE : le peigne posé sur
toute l'île. C'est l'objet de l'étape 5.

### Étape 4 — La commande et sa nomenclature ⏳

- Type `IslandOrder` : maisons par palier (nombre ou population cible), services (`auto` ou
  liste), panier de production (`Basket` de `prodlayout`).
- `billOfMaterials(order, island)` : fonction pure qui rend la liste exacte des bâtiments —
  services dimensionnés aux maisons demandées, chaînes complétées (`completeBasket`), biens
  importés listés. Réutilise `src/economy/solve.ts`.

**Fini quand** : nomenclature testée sur des commandes types (pain ×2, 300 maisons de
Patriciens, mélange), sans aucun placement.

### Étape 5 — Quartiers bornés ⏳

Poser N maisons et leurs services dans une **zone compacte** (croissance depuis le comptoir,
aire estimée depuis la nomenclature) au lieu de remplir l'île. Réutilise `planLattice` sur une
sous-grille masquée ; la voirie suit la zone, pas la boîte englobante de l'île.

**Fini quand** : une commande de 300 maisons occupe une zone d'un seul tenant, routes < 20 %
de la zone, toutes les maisons au palier demandé ou l'écart chiffré.

### Étape 6 — La production posée sur l'île ⏳

- `prodlayout` multi-entrepôts : un panier qui dépasse la portée d'un entrepôt se découpe au
  lieu d'être refusé (aujourd'hui, 15 bâtiments → « aucun entrepôt sous 30 »).
- Pose dans le masque réel de l'île (le mode `forme` existe), à côté des quartiers, reliée au
  réseau du comptoir ; emplacements de terrain (mines, forêts, côtiers) pris sur l'île.

**Fini quand** : une commande « quartier + deux chaînes » sort servie sur trois îles types.

### Étape 7 — Interface « Commande » ⏳

Panier de maisons, services et production ; bouton « compléter » (`completeBasket`) ; rapport
servi / refus chiffré ; bilan d'attributs présenté comme un risque. L'onglet « Plan d'île »
actuel devient le mode « remplir le reste ».

### Étape 8 — Retrait de l'ancien pipeline ⏳

`planIslandImport` réduit au mode « remplir le reste » ; passes devenues mortes supprimées
(démotion pensée pour `packPlan`, recul d'ateliers…) ; `finalize` découpé ; README mis à jour
(il annonce encore l'optimiseur « liste de courses »).

### Transverse — quatre tests en jeu (Rémi)

Le moteur optimise un modèle dont les fondations n'ont jamais été confrontées au jeu. Par
ordre de levier :

1. **Bilan négatif** : une ville à Bonheur ou Sécurité incendie négatif subit-elle des incidents
   ponctuels ou un effondrement ? Tranche définitivement le mode par défaut de l'étape 2.
2. **Sens de `UpgradeThreshold`** (`GAME_MECHANICS.md` §13.0) : conditionne toutes les recettes
   de services.
3. **Consommation par maison ou par habitant** (§13.4) : si c'est par habitant, tous les débits
   sont faux d'un facteur capacité.
4. **Aqueduc plat** (§13.1) : calibre `MAX_RUN`.

---

## Référence mesurée (étape 1)

Relevée sur `dev` à `200e559`, réglages par défaut de l'interface (palier sommet du monde,
recette `auto`, seuil 80 %, tolérance nulle, sans options), hauteurs de terrain chargées.

| île | ms | maisons | habitants | svc/maison | maisons % | services % | routes % | vide % |
|---|---|---|---|---|---|---|---|---|
| `roman_island_small_01` | 2 276 | 375 | 7 406 | 0,27 | 24,7 | 26,5 | 24,2 | 23,5 |
| `roman_island_medium_01` | 3 760 | 903 | 23 492 | 0,24 | 29,6 | 27,2 | 24,0 | 16,1 |
| `roman_island_medium_05` | 4 792 | 344 | 11 542 | 0,78 | 9,5 | 35,4 | 23,7 | 29,2 |
| `roman_island_large_03` | 7 438 | 320 | 9 966 | **1,95** | 3,9 | 23,1 | 24,9 | **46,5** |
| `celtic_island_small_01` | 2 442 | 176 | 3 570 | 0,81 | 11,2 | 30,6 | 22,9 | **33,2** |
| `celtic_island_medium_04` | 2 613 | 243 | 4 982 | 0,78 | 9,3 | 25,9 | 23,4 | **39,1** |
| `celtic_island_large_07` | 7 100 | 245 | 4 992 | **1,24** | 4,7 | 23,7 | 23,3 | **46,1** |

Tous livrés `viable`. Quatre îles sur sept déclenchent `terre-vide`, deux `services-par-maison`.
Les services occupent plus de sol que les maisons sur six îles sur sept ; les routes prennent
23 à 25 % partout, quelle que soit la population logée.

Commande :

```
QUALITY=1 QUALITY_OUT=<dossier> QUALITY_TAG=ref pnpm vitest run src/optimizer/planQuality.sweep.test.ts
python tools/render_plan.py <dossier>/ref-celtic_island_large_07.json
```
