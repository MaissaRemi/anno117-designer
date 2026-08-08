# Leviers pour la qualité des plans d'île

Ouvert au 2026-08-08 après la cascade de main-d'œuvre, les dieux et les chaînes de production.
Note d'auto-évaluation de la feature à l'ouverture : **6,3/10** — fidélité au jeu ~8, légalité
des plans ~8, **qualité d'optimisation ~4**.

Mesure de référence à l'ouverture, `roman_island_medium_01` en pleine résolution, emplacements
+ production locale cochés : 22 901 habitants · 640/817 maisons au palier cible (78 %) ·
couverture minimale 56 % · bilan positif (🔥 +455) · main-d'œuvre couverte · ~5 à 12 s.

**Même configuration, à la clôture — mesurée dans l'interface, pas dans un banc : 24 550
habitants · 677/883 au palier cible · couverture minimale 56 % · bilan positif (🔥 +645).**
Soit **+7,2 %** sur la référence exacte, réglages par défaut, sans le balayage des paliers.

⚠ Les bancs de ce document tournent sur la grille TUILE (`downscaleGrid`, 27 456 cases de
terre sur medium_01) ; l'interface travaille en demi-tuiles (109 824 cases). Les chiffres des
deux ne se comparent pas entre eux — seulement chacun à lui-même.

**État, après mesure :**

| levier | verdict | effet mesuré |
|---|---|---|
| 1 — coût réel dans la sélection | ✅ fait, voie (b) | **+2,2 %** sur celtic, 0 % sur medium_01, +7 à 10 % de temps |
| 2 — passe de réparation locale | ❌ réfuté | 0 % sur 7 configurations, −0,5 % sur la huitième, +12 à 42 % de temps |
| 3 — terrain libre avant démolition | ✅ fait | **+3,6 %** sur medium_01, **+7,5 %** sur celtic |
| 4 — balayage du palier cible | ✅ fait, en option | **+120 %** sur celtic (Nobles → Aldermen), 0 % sur medium_01 |
| 5 — élargir le budget de recettes | ❌ réfuté | plan IDENTIQUE à 7, 11 et 15 recettes, +58 % de temps |
| 6 — les ateliers réservent leur sol | ✅ fait | **+2,0 %** sur medium_01, 70 maisons rasées → 7 |
| 7 — packPlan à armes égales | ✅ fait, puis sorti du portefeuille | perd les 9 configurations ; −7,4 à −8,8 % de temps |
| 8 — ne bâtir que sur le tenant du comptoir | ✅ fait | **justesse** : 93 bâtiments inactifs → 22 sur huit îles |

La leçon commune : **le sol est la contrainte qui mord, pas la couverture.** Poser plus de
services ne rapporte rien ; mieux CHOISIR entre les plans, et cesser d'en détruire, si.

Cumul sur la session : `roman_island_medium_01` 16 660 → **17 266**,
`celtic_island_large_07` 8 968 → **9 844** (+9,8 %), et **21 622** avec le balayage des
paliers activé (+141 %).

---

## Levier 3 — TERRAIN LIBRE AVANT DÉMOLITION : ✅ FAIT (2026-08-08)

**D'abord la mesure, pour ne pas repayer l'erreur du levier 2.** L'écart plan nu → plan livré
(−9 à −12 %) a été VENTILÉ, jalon par jalon, avant d'écrire une ligne :

| étape | medium_01 | celtic |
|---|---|---|
| plan nu | 18 944 | 9 956 |
| comptoir | 18 944 — **0** | 9 956 — **0** |
| emplacements | 18 767 — −177 (−0,9 %) | 9 874 — −82 (−0,8 %) |
| **ateliers** | **16 609 — −2 158 (−11,4 %), 89 maisons rasées** | **9 120 — −754 (−7,6 %), 41 rasées** |
| main-d'œuvre | 16 660 — **+51** | 9 161 — **+41** |

Verdict sans ambiguïté : le comptoir ne coûte rien, les emplacements ~1 %, et la cascade de
main-d'œuvre est **nette positive** — le malus de rang se détend plus que les conversions ne
coûtent. Tout l'écart est dans les ateliers.

**La cause.** `place()` (`localProd.ts`) spiralait depuis le barycentre des maisons et retenait
la PREMIÈRE position que `fits` acceptait — or `fits` accepte les cases occupées par des
résidences, qu'il rase. Le moteur bulldozait le centre-ville plutôt que d'aller chercher du
vide quelques tuiles plus loin. 89 maisons, soit ~90 cases de résidence, pour des bâtiments
qui en occupent 16 à 25.

**Le correctif.** Deux spirales : terrain RÉELLEMENT vide et desservi par une route d'abord,
démolition en repli seulement. S'écarter du barycentre ne coûte rien et rapporte deux fois —
les maisons restent debout, ET le malus de zone de l'atelier frappe moins de monde.

| | rasées | copies d'atelier | habitants |
|---|---|---|---|
| avant | 69 | 26 | 23 263 |
| après | 42 | 40 | **24 046** |

Le budget d'attributs n'étant plus mangé par les maisons détruites, il finance 14 copies de
plus. Verrouillé par un test sur le RATIO rasées/copie (2,65 → 1,05), pas sur un compte absolu.

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

**Correctif de suite : pas de doublon dans la liste.** La passe de divinité tutélaire rejoue
la recette gagnante et, quand l'autel ne change rien, rend un plan strictement égal. Sur
celtic les finalistes #0 et #1 étaient ce même plan (9 820 nus, 8 968 livrés tous les deux),
soit un rang sur trois joué pour rien — alors que le vrai gagnant était #2, de justesse.
Chaque candidat porte désormais une signature géométrique et la liste n'en retient qu'un par
signature : {9 820, 9 820, 9 956} devient {9 820, 9 956, 3 480}.

**Ce qui reste sur ce levier.** La voie (a) — estimation bon marché du coût aval intégrée
directement à `better()` — n'a pas été faite et n'est plus prioritaire : la voie (b) capte
l'essentiel. Elle redeviendrait utile si le nombre de recettes essayées explosait.

---

## Levier 4 — BALAYAGE DU PALIER CIBLE : ✅ FAIT, en option (2026-08-08)

Le palier cible était pris pour argent comptant. Or **un palier plus haut ne loge pas
forcément plus de monde** : ses services mangent plus de sol, et son malus de rang de cité est
plus lourd. Balayage complet, plan livré à chaque fois :

| celtic_island_large_07 | cap/maison | habitants | maisons |
|---|---|---|---|
| Tourbiers | 4 | 7 142 | 1 978 |
| Forgerons | 9 | 13 949 | 1 863 |
| Mercators | 13 | 4 740 | 416 |
| **Aldermen** | 18 | **22 114** | 1 698 |
| Nobles *(sommet de lignée)* | 21 | 9 844 | 488 |

**Viser les Aldermen loge 2,25 fois plus que viser les Nobles.** Les Nobles et les Mercators
sont la population ROMANISÉE d'Albion : malus de rang bien plus lourd (−17,4 de Bonheur contre
−12,6 pour un natif), services plus gourmands, et le garde-fou de viabilité rase les trois
quarts du quartier. Les deux paliers romanisés sont d'ailleurs les deux pires de la lignée.

Ce n'est pas une règle générale : sur `roman_island_medium_01`, monotone, le sommet gagne
(Patriciens 17 266 contre Equites 7 409). D'où un balayage et non une heuristique.

**En OPTION (`autoTier`), pas par défaut** : le palier cible reste un objectif de partie, pas
un réglage, et le balayage coûte un plan complet par palier (37 s sur celtic contre 10 s). Le
palier retenu ressort dans `tierGuid` / `tierName`, et un écart au palier demandé est annoncé
en tête des trous — l'utilisateur n'a rien à deviner.

---

## Levier 5 — ÉLARGIR LE BUDGET DE RECETTES : ❌ RÉFUTÉ (2026-08-08)

L'hypothèse : `budget = 7` datait d'une époque où la sélection ne prédisait rien, donc essayer
plus ne servait à rien ; le levier 1 rendant la comparaison fiable, plus de diversité amont
devait payer. Mesuré à 7, 11 et 15 recettes :

| île | 7 | 11 | 15 |
|---|---|---|---|
| roman_island_medium_01 | 17 266 (7,1 s) | 17 266 (9,2 s) | 17 266 (11,2 s) |
| celtic_island_large_07 | 9 844 (10,1 s) | 9 844 (13,2 s) | 9 844 (16,1 s) |

Plan **strictement identique** dans les six cas, pour +58 % de temps. Les recettes au-delà de
la septième ne gagnent jamais : `candidateRecipes` les émet déjà par ordre de promesse
décroissante, et la queue de distribution est plate. Ne pas y revenir sans changer
l'ÉNUMÉRATION elle-même.

---

## Levier 8 — NE BÂTIR QUE SUR LE TENANT DU COMPTOIR : ✅ FAIT (2026-08-08)

Ce n'est pas de l'optimisation, c'est une **correction de justesse** : le plan contenait des
bâtiments qui ne fonctionnent pas en jeu, et les comptait quand même.

Les « îles » du jeu ne sont pas des blocs pleins. Composantes de terre mesurées :

| île | composantes | tailles | bâtiments isolés |
|---|---|---|---|
| `celtic_island_small_01` | 112 | 12 472, **1 193**, 60, 59… | 29 |
| `celtic_island_small_06` | 85 | 6 449, 51, 48, 25… | 31 sur 67 maisons |
| `celtic_island_medium_04` | 70 | 22 695, **418**, 78… | 14 |
| `celtic_island_medium_03` | 8 | 27 472, 3, 3, 1… | 0 |
| `celtic_island_medium_07` | 6 | 23 324, 3, 1, 1… | 0 |

La corrélation est parfaite : les îles à composante secondaire notable ont des bâtiments
isolés, celles dont le reste tient en trois cases n'en ont aucun. Les moteurs bâtissaient sur
ces lobes, aucune route ne franchissant la mer — **marchés, puits et fana INACTIFS en jeu**,
et des maisons comptées comme desservies par des services qui ne tournent pas.

Deux fausses pistes, mesurées avant d'abandonner : porter le détour de raccordement de 24 à
96 cases (aucun effet), et autoriser la réparation à raser des maisons pour ouvrir un passage
(31 → 31). On ne traverse pas la mer.

**Correctif** : `keepMainLandmass` retire du masque constructible tout ce qui n'est pas d'un
seul tenant avec le comptoir. Bâtiments isolés sur huit îles : **93 → 32**, puis **→ 22** en
retirant aussi les RÉSIDENCES isolées, qui gonflaient la population annoncée de maisons
mortes. Les services isolés restent — les retirer changerait une couverture déjà calculée —
mais sont signalés nommément.

Le message des trous comptait des CASES DE ROUTE ; il compte désormais des BÂTIMENTS, avec
leurs noms. Reliquat connu : ~22 services isolés sur huit îles, dus à l'élagage des routes à
l'intérieur du tenant principal.

---

## Levier 6 — LES ATELIERS RÉSERVENT LEUR SOL : ✅ FAIT (2026-08-08)

Suite du levier 3. Chercher le terrain libre d'abord règle le problème là où il y a du vide ;
sur `roman_island_medium_01` il s'épuise, et 70 maisons tombaient encore. Une emprise qui ne
mord qu'UNE case d'une résidence emporte la maison entière, ses neuf cases et ses habitants :
250 cases d'atelier détruisaient plus de 600 cases de logement.

Le comptoir résout ce problème depuis longtemps, en RÉSERVANT son emprise avant que les
moteurs bâtissent. Même remède, mais les emprises ne sont connues qu'après coup : la recette
gagnante est rejouée sur une grille où le sol des ateliers du premier plan est retiré du
masque constructible, puis les ateliers y sont **ÉPINGLÉS** (`LocalProdOptions.preferred`).

| | rasées | maisons | habitants |
|---|---|---|---|
| avant | 70 | 585 | 17 266 |
| réservation seule | 59 | 585 | 17 266 |
| réservation + épinglage | **7** | **628** | **17 608** |

**L'épinglage n'est pas un détail : sans lui le gain est nul.** Les ateliers de la seconde
passe se réinstallent où bon leur semble et rasent de nouveau — la réservation seule ne
ramenait les démolitions que de 70 à 59, pour zéro habitant.

La passe est sautée quand le premier plan n'a rasé aucune maison : elle ne changerait que le
sol déjà occupé, pour le prix d'une passe complète (mesuré +6 % de temps sur celtic, où la
recherche de terrain libre suffit à tout loger).

Effet de bord notable : **activer la production locale ne coûte plus de population.** Mesuré
25 001 habitants avec, contre 24 953 sans. Un test qui affirmait l'inverse portait sur un coût
qui n'existe plus ; il vérifie désormais la comptabilité, qui, elle, doit rester vraie.

---

## packPlan — remis à égalité, puis sorti du portefeuille (2026-08-08)

**Le soupçon de départ** était mince : `packPlan` déclare `plots?: HousePlot[]` et ne le
remplit jamais, donc la cascade de main-d'œuvre est morte sur ses plans et son vivier vaut 0
dans le départage. La mesure a trouvé bien pire.

**Il ne posait aucune INSTITUTION et n'appliquait aucun GARDE-FOU DE VIABILITÉ.** Sur les
paliers bas il annonçait donc trois à quatre fois la population des plans lattice — 21 414
contre 4 980 sur `roman_island_medium_01` / Plébéiens — et se faisait éliminer par `better()`
au tout PREMIER critère, un plan au bilan négatif perdant contre n'importe quel plan viable.
Ses chiffres étaient la même illusion que les 67 862 habitants d'avant la contrainte de
viabilité : des maisons que le jeu aurait punies.

Les trois manques sont corrigés — institutions blanketées comme dans le lattice, `viableSubset`
partagé (nouveau module `optimizer/viability.ts`), parcelles publiées.

**À armes égales, il perd partout.** Neuf configurations :

| | lattice | packPlan |
|---|---|---|
| medium_01 / Liberti | 2 947 | 2 418 |
| medium_01 / Plébéiens | 4 980 | 4 896 |
| large_07 / Tourbiers | 7 086 | 6 409 |
| large_07 / Forgerons | 13 919 | 10 158 |
| 5 îles au palier haut | — | jamais dans les trois finalistes |

Les paliers bas sont précisément ceux où son houses-first était censé payer, faute de
consommateur d'eau. Il coûtait **703 ms et 1 321 ms**, soit 7,4 % et 8,8 % du temps de CHAQUE
plan, pour un candidat jamais retenu — il sort du portefeuille. Le moteur reste maintenu et
testé ; le remettre tient en une ligne.

Population inchangée après retrait : 17 266 et 9 844.

---

## Reliquat d'hygiène : ✅ FAIT (2026-08-08)

Les trois `avg = capByTier[g] / tierCounts[g]` (`islandPlan.ts`, raccord du comptoir,
emplacements, production locale) décrémentaient des agrégats DÉRIVÉS en utilisant une moyenne
comme substitut de la maison réelle : le résultat dépendait de l'ordre des retraits, et le
`Math.max(0, …)` masquait la dérive.

Remplacés par `razeHouses(gone, extra)` et `recount()` : les agrégats se DÉRIVENT des maisons
encore debout, avec la capacité EXACTE de chaque parcelle (`HousePlot.opts`), jamais par
décrément. Dernière survivance du motif « accumulation de deltas sur un état qui bouge ».

**Gain de population : aucun** — mesuré identique (17 266 / 9 844). Attendu : le règlement de
main-d'œuvre écrasait déjà ces agrégats dès qu'il y avait une conversion, et il y en a une sur
les deux îles. C'est un correctif de robustesse, pas d'optimisation ; il le devient dès qu'un
plan n'a aucune conversion.

Repli conservé pour `packPlan` : il déclare le champ `plots` mais ne le remplit jamais — ce qui
est aussi la raison pour laquelle la cascade de main-d'œuvre ne fait rien sur ses plans.

---

## Réserve d'efficacité

Mesuré : 92 % du temps d'un plan est dans les passes de `planLattice`, ~13 passes par plan.
Le grand-livre entier pèse 1 %.

**✅ Fait — caches de `needsModel` en tables creuses.** C'étaient des tableaux DENSES de
`2^nBits` par palier pour 4 à 42 entrées réellement utilisées (0,26 % d'occupation), sous un
garde-fou `MAX_CACHED_BITS = 20` qui coupait purement le cache au-delà. Passés en `Map` :
falaise mémoire de ~42 Mo supprimée, coupure supprimée (un plan à plus de vingt types de
service est désormais mémoïsé au lieu d'être brutalement lent), et une branche de moins.
Mesuré dos à dos, **neutre en temps** : 9,2–10,0 s contre 9,6–9,8 s sur medium_01, 12,8–14,6 s
contre 13,4 s sur celtic — soit du bruit machine.

**Restant, par ordre décroissant :**

- `settle()` rejoue un `run()` complet — 4 balayages de parcelles sur 17 — alors que le glouton
  sort à la première itération quand la demande est déjà couverte. ~1 % du plan.
- Le recul sur pose est linéaire ; une dichotomie le ramènerait à ⌈log₂ n⌉ appels, mais c'est
  −69 % de 0,78 % : sans intérêt tant que le reste n'a pas bougé.

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
- Ne pas lire la COUVERTURE MINIMALE comme une note de qualité. Elle est anti-corrélée à
  l'objectif : sur celtic, le meilleur plan mesuré a 71 % de couverture contre 77 % au plan
  battu. Une recette maigre couvre moins et loge bien plus. L'interface le dit désormais en
  infobulle ; le chiffre qui compte est celui des habitants.
