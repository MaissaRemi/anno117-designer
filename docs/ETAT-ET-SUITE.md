# État du projet et chantiers ouverts

Dernière mise à jour : 2026-08-09. Branche `dev`, arbre propre, 274 tests verts.
Docker sur `:8090`. Ce document est le point d'entrée d'une nouvelle session.

---

## 1. Où en est le moteur

L'optimiseur produit des plans **viables sur les 55 îles**, avec deux réglages exposés dans
l'interface qui n'existaient pas avant : le **risque toléré** et la **dévotion**.

Bilan du dernier balayage complet (55 îles, palier le plus dense, seuil 0,7, emplacements
exploités, palier auto), comparé à l'état d'avant les correctifs de viabilité :

| | avant | après |
|---|---|---|
| habitants, 55 îles | 1 032 493 | **1 154 688** (+11,8 %) |
| habitants, îles romaines | 579 238 | **701 433** (+21,1 %) |
| médiane romaine | — | **+14,3 %** |
| `viable` | vrai partout | **vrai partout** |
| îles celtiques | — | **rigoureusement inchangées** |

Un balayage de contrôle a été lancé après les trois derniers correctifs mais **n'a pas rendu
son résultat avant la fin de la session**. Cinq îles témoins ont été vérifiées à la main :
écart nul sur quatre, −0,02 % sur la cinquième. À refaire en entier — c'est le premier point
de la section 3.

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

Trois divinités seulement touchent les résidences (pool `31046 « All Residences »`) : **Cérès**
(Population ×1→7), **Cernunnos** (Santé + Connaissance), **Minerve** (Connaissance). Epona vise
les bâtiments de production, Mercure les comptoirs — les créditer aux maisons serait faux.

Point de conception à ne pas reperdre : **la divinité se choisit AVANT l'autel**. L'ordre
inverse était le défaut — un autel gagnait la présélection sur son rayon, la divinité se
trouvait verrouillée sur ce dieu sans effet d'île, puis le raffinage retirait l'autel. Ni
autel, ni dieu.

---

## 3. Chantiers ouverts, par ordre de valeur

### 3.1 ~~RÉGRESSION~~ FALAISE DU VERDICT — CORRIGÉE, cause réelle mesurée

**Traité.** Cette section garde le déroulé complet parce que le premier diagnostic était faux :
la régression n'était pas une régression de `<Targets>` mais une **falaise préexistante** du
verdict binaire, révélée par un plan devenu MEILLEUR. Voir le correctif plus bas.

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

Reste ouvert, et c'est la voie de fond : **rejouer la sélection de viabilité APRÈS** les passes
tardives (production locale, cascade de main-d'œuvre, razage pour le comptoir) — celles qui
repoussent sous zéro un plan sorti viable de `viableSubset`. Cela demande de conserver les
attributs par maison jusque-là. Le plancher rend la falaise inoffensive ; il ne supprime pas
la dérive qui y mène.

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

### 3.4 Productivité des divinités — extraction incomplète

Le premier effet local des huit dieux (productivité par pool de biens) passe par
`FactoryUpgrade`, que `fx_buffs` ne lit pas — il ne lit que
`BuildingUpgrade/AdditionalAttributes`. Même chose pour sept dominants sur huit (navires,
troupes, stockage, déblocages). Les entrées sont émises avec leurs GUID et leurs paliers, mais
avec des attributs vides.

### 3.5 Exploitations sur emplacements de marais éloignés

Certaines restent sans entrepôt à portée de charrette. Signalé par les invariants, jamais
traité.

### 3.6 Le sur-provisionnement de services sur les très grandes îles

Sur la continentale : 3 113 services pour 532 maisons à tolérance nulle. Les budgets du glouton
sont dimensionnés sur `landCount`, la surface totale, et non sur le nombre d'emplacements de
maison réellement disponibles. Une tentative de correction (compter les emplacements) a été
**revertie** : le seuil `2r²·0,25` est une *aire* comparée à un *compte*, ce qui faisait perdre
30 % sur les îles celtiques. Le correctif propre demande de remettre le seuil en unités
homogènes. Détail dans `docs/superpowers/specs/2026-08-09-services-vs-maisons.md`.

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
