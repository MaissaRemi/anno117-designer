# État du projet et chantiers ouverts

Dernière mise à jour : 2026-08-10 (seconde session). Branche `dev`, arbre propre, 294 tests verts.
Docker sur `:8090`. Ce document est le point d'entrée d'une nouvelle session.

---

## 1. Où en est le moteur

L'optimiseur produit des plans **viables sur les 55 îles**, avec deux réglages exposés dans
l'interface qui n'existaient pas avant : le **risque toléré** et la **dévotion**.

Bilan des balayages complets successifs (55 îles, palier le plus dense, seuil 0,7, emplacements
exploités, palier auto, tolérance et dévotion nulles) :

| | habitants, 55 îles | |
|---|---|---|
| avant les correctifs de viabilité | 1 032 493 | — |
| après (`89956cc`, la référence du protocole) | 1 154 688 | +11,8 % |
| après `<Targets>` + élection du dieu | 1 129 131 | −2,2 % |
| après le plancher de bruit du verdict (§3.1) | 1 248 802 | +21,0 % / départ |
| **après le retrait des exploitations stériles (§3.5)** | **1 262 830** | **+22,3 % / départ** |

`viable` est vrai partout à chaque étape. La dernière ligne vient de lever une **falaise du
verdict** qui bridait toutes les grandes îles romaines — jusqu'à ×6,6 sur `extralarge_03` — sans
que rien ne le signale, le plan effondré étant livré `viable=true`. Détail et mesures en §3.1.

### Les deux réglages, et pourquoi ils se tiennent

Mesures sur `roman_dlc01_island_continental_01` (carte continentale du DLC, 413 266 cases) :

| | dévotion 0 | dévotion 25 000 |
|---|---|---|
| tolérance 0 | 7 186 | 5 716 |
| tolérance 1 | 34 257 | 37 755 |
| tolérance 3 | 70 057 | **93 622** |

La dévotion **coûte** de la population sans tolérance et en **rapporte** avec : plus d'habitants
par maison alourdit le malus de rang de cité, donc le garde-fou rase davantage. C'est un
arbitrage de joueur, d'où deux curseurs plutôt qu'un réglage automatique. Les deux valent 0 par
défaut : une requête par défaut rend une sortie identique à l'historique.

---

## 1 bis. Le module de blueprints de production

`src/prodlayout/` calcule un layout compact et recopiable pour une chaîne complète, à partir
d'un bâtiment terminal : « une boulangerie » remonte jusqu'aux fermes, avec routes, entrepôt et
champs, dans une boîte englobante minimale. Onglet **Production** dans la barre de navigation.

**Indépendant du moteur d'île** : ni terrain, ni fertilité, ni population. `frontiere.test.ts`
interdit par lecture des sources tout import vers `src/optimizer/` ou `src/economy/`, et tout
appel à `Math.random`, `Date.now` ou `new Date` — le déterminisme est structurel, pas promis.
Une troisième assertion garde contre la vacuité du glob, sans quoi les deux autres passeraient
sur un ensemble vide.

Ratios en rationnels exacts (le PPCM des dénominateurs donne le **lot parfait**, suggéré à
l'utilisateur avec son coût en cases), placeur glouton à ordre total. Mesure de référence :
pain romain, lot parfait `2 boulangeries : 1 moulin : 2 fermes` → **23×23, 92,1 % d'efficacité**,
un entrepôt, les deux fermes à leurs 140 cases de champ.

Le test « deux appels identiques rendent un plan identique » est celui qui rend le module
mesurable : sans lui, comparer deux versions du placeur ne rendrait que du bruit.

**Un piège de donnée à retenir** : sept entrées de `buildingProd` ont des intrants et **aucune
sortie** — les phases de construction de l'Amphithéâtre. « Amphithéâtre : arène » ouvrant la
liste alphabétique romaine, c'était la cible par défaut de l'interface, qui plantait à
l'ouverture. Tous les tests partaient de la boulangerie et ne pouvaient pas le voir ; c'est le
navigateur qui l'a trouvé. `isProducer()` sert désormais au filtre de la vue ET au garde-fou de
`buildChain`, pour que les deux ne divergent pas.

**Hors périmètre, assumé** : pose sur une île réelle, maisons ouvrières (la main-d'œuvre est
chiffrée, jamais logée), coûts de construction — **absents de l'export du jeu**, donc la ligne
n'est pas affichée plutôt que remplie d'un chiffre inventé —, et la passe d'amélioration locale
du placeur, à ne construire que si une mesure montre le glouton visiblement lâche.

Spec : `docs/superpowers/specs/2026-08-10-blueprints-de-production-design.md`.
Plan : `docs/superpowers/plans/2026-08-10-blueprints-de-production.md`.

---

## 2. Ce qui a été corrigé, et ce que ça a appris

### Le défaut visible : « tous les sanctuaires du jeu sur mon île »

Trois causes empilées, aucune dans l'optimiseur :

1. **Le catalogue était figé dans le navigateur.** `loadState` rendait le catalogue tel
   qu'enregistré, sans jamais le confronter aux données du jeu. `uniqueType` ayant été ajouté à
   l'extraction bien après les premières ouvertures, les sanctuaires n'en portaient aucun dans
   un catalogue ancien, `uniqueCap` renvoyait l'infini, et plus rien ne bornait ni le nombre ni
   la variété. Corrigé : les données du jeu écrasent la copie persistée
   (`src/persist/local.ts`), verrouillé par `src/persist/local.test.ts`.
2. **`index.html` n'avait aucun `Cache-Control`.** Cache heuristique du navigateur + `/assets/`
   marqué `immutable` un an = l'utilisateur exécutait un ancien bundle **depuis plusieurs
   correctifs**, alors que le serveur servait bien le nouveau code. Corrigé en `no-cache,
   must-revalidate`, plus une **empreinte de bundle affichée dans la barre du haut**
   (`src/buildStamp.ts`) pour que la question soit vérifiable en une seconde.
3. **Trois trous d'unicité** dans le moteur : budget de densification indexé par defId,
   garantie « tout type requis » de `packPlan` sans consultation du quota, et l'absence de
   règle sur l'identité du dieu. Fermés, plus l'invariant `un-seul-dieu` (gravité `faute`) qui
   tient la règle quel que soit le chemin de placement.

### Le plafond de population des grandes îles

Ce n'était **ni la surface, ni l'argent, ni l'import**. Le malus de rang de cité s'applique
**par maison** et atteint −7 dès 30 000 habitants, quand une maison patricienne plafonne à +7
de sécurité incendie. Au-delà, aucune maison ne peut avoir un bilan incendie positif, quelle
que soit la surface disponible. Le remplissage, lui, fonctionnait : il posait 17 989 maisons
sur la continentale (44,2 pour 1000 cases, mieux que 37,4 sur une petite île) — `viableSubset`
en rasait 97 %.

Quatre correctifs : tri du garde-fou sur **tous** les attributs déficitaires (il ne triait que
sur le pire, le Bonheur, alors que c'est l'incendie qui ferme la boucle), passe de
**réadmission** (le retrait par lots de 2 % dépasse par construction), correction du **déficit
toujours nul** — le dieu était élu par ordre alphabétique — et la **tolérance** en option.

### Trois erreurs de l'assistant, corrigées par la mesure

Elles valent d'être retenues, parce qu'elles disent comment se tromper sur ce projet :

- **L'override de sanctuaire.** `g3615 Sanctuaire` avait été pris pour un archétype non
  constructible ; il porte `<Constructable />` et le besoin 2753 déclare mot pour mot ses
  attributs. L'override créditait un **Incendie +2 fictif** à chaque maison. Les quatre
  « régressions » du balayage venaient toutes de son retrait — aucune n'était un défaut.
- **Le diagnostic « le dieu cause la régression de `medium_03` ».** Faux : l'île rend le même
  nombre d'habitants avec Vulcain qu'avec Epona.
- **Les pools d'assets « renseignés ».** Deux mesures le laissaient croire ; une regex
  débordait sur l'asset suivant, les items étant auto-fermés. **Le parseur XML fait foi**, pas
  la regex.

### Deux critères d'élection du dieu, réfutés

La marge par maison, puis la même marge projetée sur une ville deux fois plus peuplée : la
première élit le mauvais dieu, la seconde ne déplace **aucune** élection sur sept îles. Le dieu
ne change pas qu'un total d'attributs, il change la **géométrie** du plan. L'élection se fait
désormais en **rejouant** le plan pour chaque candidat de la présélection — c'est la population
livrée qui tranche.

### Les divinités tutélaires, extraites

`economy.patrons` : huit divinités, autel emblématique, pool, merveille, effets locaux avec
paliers de dévotion, effets dominants. `economy.religion` : dominance 7 000, merveille 4 000,
autel 1 000. Verrouillé par `src/economy/patrons.test.ts`.

Trois divinités seulement touchent les résidences PAR LEURS ATTRIBUTS (pool
`31046 « All Residences »`) : **Cérès** (Population ×1→7), **Cernunnos** (Santé + Connaissance),
**Minerve** (Connaissance). Epona vise les bâtiments de production, Mercure les comptoirs — les
créditer aux maisons serait faux.

⚠ **Cette phrase a été tenue pour vraie en général, et elle ne l'est pas.** Vulcain vise lui
aussi le pool `31046`, par un modificateur de MAIN-D'ŒUVRE (+5 %) et non par un attribut : il ne
loge personne, mais l'affirmation « seules trois divinités touchent les résidences » est fausse
telle quelle. Voir §3.4.

Point de conception à ne pas reperdre : **la divinité se choisit AVANT l'autel**. L'ordre
inverse était le défaut — un autel gagnait la présélection sur son rayon, la divinité se
trouvait verrouillée sur ce dieu sans effet d'île, puis le raffinage retirait l'autel. Ni
autel, ni dieu.

---

## 3. Chantiers ouverts, par ordre de valeur

### 3.1 ~~RÉGRESSION~~ FALAISE DU VERDICT — CORRIGÉE (+10,6 % sur les 55 îles)

**Traité.** Cette section garde le déroulé complet parce que le premier diagnostic était faux :
la régression n'était pas une régression de `<Targets>` mais une **falaise préexistante** du
verdict binaire, révélée par un plan devenu MEILLEUR. Elle bridait en réalité **toutes les
grandes îles romaines**, jusqu'à −85 % sur `extralarge_03`. Voir le correctif plus bas.

Le balayage des 55 îles a rendu son verdict, sur `dev` à `6de3cdf` (src identique à `347f8d4`),
55/55 îles, aucun plantage.

| | nombre |
|---|---|
| en hausse (> +0,5 %) | 0 |
| stables (± 0,5 %) | **49** |
| en baisse (< −0,5 %) | **6** |

Total : 1 154 688 → **1 129 131 habitants (−2,21 %)**. Mais **hors les deux îles effondrées, les
53 autres font −0,06 %** — parfaitement dans l'attendu de `<Targets>`.

| île | avant | après | écart |
|---|---|---|---|
| `roman_island_medium_05` | 19 986 | **4 992** | **−75,0 %** |
| `roman_island_large_06` | 14 864 | **4 980** | **−66,5 %** |
| `roman_island_small_02` | 11 360 | 11 121 | −2,1 % |
| `celtic_island_medium_01` | 7 330 | 7 238 | −1,3 % |
| `celtic_island_medium_04` | 14 132 | 14 010 | −0,9 % |
| `roman_island_large_03` | 14 847 | 14 750 | −0,7 % |

Les quatre derniers sont du bruit de placement. Les deux premiers ne le sont pas.

#### Le mécanisme, mesuré palier par palier sur `roman_island_medium_05`

```
Liberti      maisons=600  hab= 2 999  viable=true
Plébéiens    maisons=416  hab= 4 992  viable=true    <- RETENU par autoTier
Equites      maisons=557  hab=13 143  viable=false
Patriciens   maisons=625  hab=20 904  viable=false
```

`autoTier` classe par `feasible`, puis `viable`, puis `residents`. Les deux paliers hauts
basculant non viables, il se rabat sur Plébéiens : **16 000 habitants perdus**. Même schéma
exact sur `roman_island_large_06` (Patriciens 29 265 habitants, non viable → Plébéiens 4 980).

**Et la non-viabilité tient à un cheveu** : `FireSafety = −21` sur 625 maisons, soit
**−0,034 par maison**, quand Bonheur vaut +3 637, Argent +46 414 et Santé +2 883. Sur
`large_06` : −26 sur 878 maisons, −0,030 par maison. Un déficit de vingt et un points coûte
quinze mille neuf cents habitants.

#### CE N'EST PAS `<Targets>`. L'attribution première était fausse

Le premier diagnostic accusait `5ccb105` (`<Targets>`) : « un petit bonus de zone qui atteignait
ces paliers a légitimement disparu ». **La bissection le réfute**, et deux mesures indépendantes
convergent :

| commit | `medium_05`, palier haut | sanctuaire posé |
|---|---|---|
| `89956cc` (référence) | 591 maisons / 19 986 hab / **viable** | aucun |
| `db7f8d5` (élection du dieu) | 625 / 20 904 / **NON viable** | Autel de Vulcain |
| `9385312` (`<Targets>`) | 625 / 20 904 / non viable | Autel de Vulcain |

**L'effondrement est déjà entier à `db7f8d5`, avant `<Targets>`.** La cause est l'élection du
dieu par la population livrée : elle fait poser l'Autel de Vulcain, ce qui **améliore** le plan
(19 986 → 20 904 habitants) et le pousse juste sous zéro en incendie. Le plan tombé n'est pas
un plan dégradé, c'est un **meilleur plan que le verdict binaire refuse**.

Le filtre `minTier` de `<Targets>`, lui, ne mord sur **aucun** bâtiment : les institutions
réellement passées à `planLattice` (Vigiles, Medicus, autel du patron — vérifié par trace à
l'exécution) ont toutes `minTier` nul, les bâtiments restreints étant des services de palier,
exclus de `institutionDefs`. Le message de `5ccb105` l'annonçait lui-même : « IMPACT MESURÉ :
NUL ». Il fallait le croire.

Sur `large_06`, mieux : le palier Patriciens était **déjà non viable à la référence**
(878 maisons / 29 265 habitants / `viable=false`). La falaise y bridait donc le plan **avant
les trois correctifs** — les 14 864 habitants de la référence étaient déjà une chute, jamais
diagnostiquée parce qu'aucune comparaison ne la révélait.

#### Ce qui NE marche pas comme correctif

Raser des maisons jusqu'au retour à zéro : inefficace ici. La maison moyenne n'est déficitaire
que de 0,034, donc en raser une ne rend que 0,034 — il en faudrait **plus de six cents**, soit
un tiers de l'île. Le razage ne répare que les déficits concentrés, pas les déficits diffus.

#### CORRIGÉ : un plancher de bruit sur le VERDICT, pas sur le garde-fou

`BRUIT_VITAL = 0,05` par maison s'ajoute à la tolérance du joueur dans `verdictViable`
(`islandPlan.ts`), et **là seulement** : `viableSubset` continue de raser au strict, verrouillé
par `src/optimizer/viability.test.ts`. Ce n'est pas la tolérance déguisée — c'est la RÉSOLUTION
du modèle, en dessous de laquelle un écart ne signifie plus rien, les attributs étant des
entiers par maison sur une couverture discrète.

Trois défauts adjacents, trouvés par la revue et corrigés avec :

- le **recul d'ateliers** jugeait sur les maisons d'AVANT le rasage par les ateliers gardés,
  quand le verdict final compte celles d'APRÈS : il s'arrêtait donc jusqu'à
  `(tolérance + bruit) × rasées` points trop tôt. Il lit désormais `trial.wf.houses`, le même
  effectif que le bilan qu'il regarde ;
- le **message d'avertissement** annonçait « émeutes/incendies/maladies en jeu » sur un plan
  déclaré viable — l'en-tête et le corps du rapport se contredisaient. Le chiffre reste affiché
  dans les deux cas, ramené à la maison ; c'est la conséquence annoncée qui suit le verdict ;
- **`packPlan` ne filtrait pas `minTier`** du tout, là où `planLattice` le fait. Inerte sur les
  données actuelles, mais les deux moteurs se départagent par `better()` : l'un créditant ce que
  l'autre refuse, le comparatif aurait été faussé dès la première institution restreinte.

#### Balayage complet des 55 îles, après correctif

Protocole habituel (palier le plus dense, `coverageFloor: 0.7`, `exploitSlots`, `autoTier`,
tolérance et dévotion nulles). 55/55 îles, aucun plantage, **`viable` partout**.

| | habitants | écart |
|---|---|---|
| référence `89956cc` | 1 154 688 | — |
| `dev` avant correctif | 1 129 131 | −2,21 % |
| **après correctif** | **1 248 802** | **+8,15 % / réf, +10,6 % / `dev`** |

**Aucune île ne baisse par rapport à `dev`** — huit montent, quarante-sept sont au habitant près.
La falaise ne bridait donc pas seulement les deux îles repérées :

| île | référence | après | écart |
|---|---|---|---|
| `roman_island_extralarge_03` | 4 896 | **32 555** | **+564,9 %** |
| `roman_dlc01_island_continental_01` | 7 186 | **19 486** | +171,2 % |
| `roman_island_extralarge_01` | 14 732 | **34 448** | +133,8 % |
| `roman_island_medium_03` | 9 955 | **21 965** | +120,6 % |
| `roman_island_large_06` | 14 864 | **29 265** | +96,9 % |
| `roman_island_medium_04` | 9 887 | 13 457 | +36,1 % |
| `roman_island_large_03` | 14 847 | 19 012 | +28,1 % |
| `roman_island_medium_05` | 19 986 | 20 904 | +4,6 % |

Les grandes îles romaines étaient **toutes** bridées par le même veto, et personne ne l'avait vu
parce qu'aucune comparaison ne le révélait : le plan effondré était livré `viable=true`, donc
d'apparence saine. C'était le plafond de population décrit en §2 — l'analyse était juste sur le
mécanisme (le malus de rang par maison ferme la boucle d'incendie), mais le dernier verrou
n'était pas le razage, c'était le VERDICT.

Trois îles restent sous la référence (`roman_island_small_02` −2,1 %,
`celtic_island_medium_01` −1,3 %, `celtic_island_medium_04` −0,9 %). Elles sont **au habitant
près identiques au balayage de `dev`** : ce sont les écarts de placement de `<Targets>` et de
l'élection du dieu, antérieurs à ce correctif, pas une dégradation de celui-ci.

**Les trois correctifs adjacents ne déplacent aucune sortie** : le balayage rend exactement les
mêmes 55 lignes qu'avec le seul plancher. Ce sont bien des mises en cohérence — `trial.wf.houses`
compris, dont la fenêtre d'erreur ne s'ouvre qu'à tolérance non nulle.

#### Ce qui reste, et c'est la voie de fond

**Rejouer la sélection de viabilité APRÈS** les passes tardives (production locale, cascade de
main-d'œuvre, razage pour le comptoir) — celles qui repoussent sous zéro un plan sorti viable de
`viableSubset`. Cela demande de conserver les attributs par maison jusque-là. Le plancher rend la
falaise inoffensive ; il ne supprime pas la dérive qui y mène.

Deux limites connues du plancher, à garder en tête :

- il est **proportionnel au nombre de maisons** (0,05 × 17 989 ≈ 900 points sur la continentale)
  et le bilan est un TOTAL : il ne voit pas la concentration locale. Un déficit groupé autour
  d'un quartier reste invisible, mais c'est une cécité du modèle d'attributs entier, antérieure
  au correctif ;
- il **calibre le symptôme**, pas la cause. Si une île portait un déficit structurel supérieur à
  0,05 par maison, la falaise se rouvrirait à l'identique. Aucune des 55 n'est dans ce cas
  aujourd'hui.

### 3.2 Services isolés par l'élagage des routes — demande un réordonnancement

Un service qu'aucune route rattachée au comptoir ne dessert est **inactif en jeu** : il ne rend
rien et coûte son entretien. Le retirer devrait rapporter, comme le retrait des consommateurs
d'eau secs (+3,6 % sur `small_06`).

L'ordre du pipeline l'interdit. Dans `planLattice` : `placeHouses()` calcule couverture,
paliers et attributs, **puis** `pruneRoads()` élague. Retirer un service ensuite invaliderait
tout ce qui vient d'être calculé — sa couverture disparaît, les maisons qu'il desservait
retombent d'un palier.

Le correctif est un **réordonnancement** : élaguer d'abord, retirer les services privés
d'accès, poser les maisons ensuite. Il touche le cœur du moteur. À faire d'un seul tenant, avec
balayage complet.

### 3.3 Effet dominant de Vulcain — bloqué sur la donnée

Population +1 / **Incendie +2** / Connaissance +1 / Prestige +1, greffé par rayon, **sans
consommer de permis**. C'est le seul effet de haut niveau qui touche l'attribut bornant toutes
les grandes îles.

Il vise le pool `50609 « Production All Smelters »`, et **les pools d'assets sont vides** dans
cet export (`<Item><Asset /></Item>`). Vérifié au parseur XML, deux fois. Il faudrait identifier
les fonderies autrement : par template, par chaîne de production, ou via un autre export du
jeu. Noter que le pool vise les **fonderies**, pas « chaque bâtiment » : la portée est plus
étroite qu'annoncé initialement.

### 3.4 ~~Productivité des divinités~~ — TRAITÉ

`fx_buffs` ne lisait que `BuildingUpgrade/AdditionalAttributes` : huit effets de patron sur
vingt-quatre sortaient avec `attrs` vide, ce qui se lit « cet effet ne fait rien ». Il lit
désormais aussi `FactoryUpgrade` (productivité, sept divinités sur huit) et
`BuildingUpgrade/WorkforceModifierInPercent`.

**Correction à une affirmation de ce document** (§2, à lire avec ça) : « trois divinités
seulement touchent les résidences » est vrai des ATTRIBUTS, faux en général. Vulcain vise lui
aussi le pool `31046 « All Residences »`, par la main-d'œuvre (+5 %). Il ne loge toujours
personne, mais la donnée ne le disait pas.

Restent muets dix effets dominants (navires, troupes, stockage, déblocages) et le commerce
passif de Mercure, qui passe par un `AreaBuff` et non un `BuildingBuff`. Aucune sortie du moteur
ne bouge : c'est un gain de vérité, pas de population.

### 3.5 ~~Exploitations sans débouché~~ — TRAITÉ (+14 028 habitants)

Une exploitation sans entrepôt à portée de charrette n'expédie RIEN en jeu et coûte pourtant son
entretien, sa main-d'œuvre et ses malus de zone. Elle sort désormais du plan.

Le chiffre de ce document — « 6 sur 31 sur cinq îles » — **datait du régime bridé**. Mesure sur
les 55 îles après la levée de la falaise : **78 sur 452, soit 17 %, réparties sur 34 îles**,
dont `celtic_island_small_07` où les DEUX étaient stériles.

Résultat : +14 028 habitants, +39 037 d'argent, aucune dégradation. Dix îles gagnent quelques
dizaines d'habitants ; `roman_island_large_05` passe de 14 650 à 28 439 (+94 %) — retirer
quelques mines stériles suffit à faire basculer un palier haut en viable.

`droppedSlots` remonte jusqu'au résultat, sans quoi le retrait serait INOBSERVABLE : `exploited`
ne contenant plus que les desservies, un test sur « aucune stérile ne survit » passerait
trivialement. Trois instruments étaient devenus aveugles d'un coup.

### 3.6 Le sur-provisionnement de services — DEUX VOIES FERMÉES PAR LA MESURE

Sur la continentale : **3 095 services pour 764 maisons** (ratio 4,05), quand les 54 autres îles
tiennent 0,39. L'anomalie est réelle et reste entière.

Mais les deux voies évidentes sont désormais fermées, chacune par un balayage :

1. **Corriger le critère du glouton** (compter les emplacements dans `diamondGain`) : reverti,
   −30 % sur celtic. Détail dans `2026-08-09-services-vs-maisons.md`.
2. **Retirer après coup les copies qui ne servent aucune maison** : **−13 819 habitants**,
   `roman_island_large_05` retombant de 28 439 à 14 650. Détail et post-mortem dans
   `2026-08-10-services-inertes-refute.md`.

**Le « défaut d'unité » que décrivait ce document n'existe pas dans le code actuel.** Vérifié
par lecture : les quatre usages de `landCount` sont homogènes entre eux — `2r²·0,25` et
`landCount·0,3` sont des cases, comparées à un `diamondGain` en cases ; `landCount/(2r²)` est un
rapport aire/aire, donc un compte. La phrase « remettre le seuil en unités homogènes » visait la
variante REVERTIE, pas l'état courant. Et `landCount` n'est pas la surface totale : montagnes,
lobes secondaires et comptoir en sont déjà exclus.

Ce qui reste vrai : `diamondGain` valorise de la TERRE, pas du POTENTIEL DE LOGEMENT. La
troisième voie — dimensionner le glouton sur les emplacements en convertissant TOUS les termes
du seuil par la densité d'origines (~0,22-0,26 par case) — n'a jamais été essayée proprement.

### 3.7 Le plancher de bruit est un pare-feu, pas une réponse — et sa marge est mince

`BRUIT_VITAL` vaut 0,05 par maison. Mesure sur les 55 îles du déficit livré le plus profond :

| île | déficit/maison | marge |
|---|---|---|
| `roman_island_medium_04` | **−0,0452** (Bonheur) | **×1,11** |
| `roman_island_medium_05` | −0,0336 | ×1,49 |

Huit îles sur 55 portent un déficit non nul. **La distribution est TRONQUÉE par construction** :
une île dont le palier haut dépasserait 0,05 ne l'affiche pas — elle s'effondre au palier
inférieur, où le déficit est nul. Les îles visibles sont les survivantes, pas la population.

Le CLASSEMENT continu (`populationEffective`) a été livré pour ça : il escompte la population du
risque au lieu de trancher sur un drapeau, donc une île qui franchit le plancher perd désormais
quelques pour cent au lieu de 75 %. Mesuré : **zéro changement sur les 55 îles** — toutes sont
dans la bande — ce qui est le résultat attendu d'une assurance.

**Reste à mesurer** : le déficit du palier le PLUS PEUPLÉ de chaque île, retenu ou non. C'est
lui qui dirait combien de population la falaise bride encore. La sonde est écrite dans l'esprit
de `__marge55` mais n'a jamais rendu son résultat.

### 3.8 Découpage de `planIslandImport` — entamé

`balayerPaliers` et `construireRecettes` en sont sortis (1 164 → 1 107 lignes). Reste
`finalize`, 580 lignes fermant des closures sur une trentaine de variables — un chantier à part
entière, qui demande son propre balayage de contrôle. C'est là que vivait le défaut `nMaisons`
vs `houses`, donc là où le découpage vaudra le plus.

---

## 4. Méthode — ce qui a marché, et ce qui a coûté cher

**Mesurer, jamais déduire.** Tous les vrais défauts de cette session ont été trouvés par
l'exécution, et plusieurs diagnostics tenus de tête ont été démentis. Chaque tentative réfutée
est documentée avec ses chiffres plutôt que supprimée — c'est ce qui évite de la refaire.

**Vérifier que l'utilisateur exécute bien le code livré.** Plusieurs correctifs ont paru sans
effet parce qu'un `index.html` en cache servait un ancien bundle. L'empreinte affichée dans la
barre du haut tranche la question en une seconde ; c'est le premier réflexe quand un correctif
« ne change rien ».

**Le parseur fait foi, pas la regex.** Sur `assets_base.xml`, les éléments auto-fermés font
déborder les expressions régulières sur l'asset suivant.

**Discipline de branche.** Une branche par correctif cohérent, fusionnée dans `dev`. Jamais de
commit direct sur `dev`. `pnpm` uniquement — un hook bloque npm, npx et yarn.
