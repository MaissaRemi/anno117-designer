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

### 3.1 Refaire le balayage des 55 îles — BLOQUANT avant toute nouvelle livraison

Trois correctifs sont entrés depuis le dernier balayage complet : élection du dieu par la
mesure, prise en compte de `<Targets>`, dévotion. Seules cinq îles témoins ont été vérifiées.

Protocole : palier le plus dense du monde de l'île, `coverageFloor: 0.7`, `exploitSlots: true`,
`autoTier: true`, tolérance et dévotion à zéro. Référence : le balayage du commit `89956cc`,
reproduit dans `docs/superpowers/specs/2026-08-09-services-vs-maisons.md`. Critère : habitants
non décroissants à −0,5 % près, `viable` partout.

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
