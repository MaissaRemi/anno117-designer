# Blueprints de production — un module de plan de chaîne, hors terrain

Date : 2026-08-10.

Sur Anno 1800, la communauté répertoriait des *production layouts* : le quartier compact et
recopiable qui fait tourner une chaîne complète à plein régime, sur la plus petite emprise
possible. Ce document décrit le module qui les calcule pour Anno 117.

L'utilisateur désigne un bâtiment terminal — « une boulangerie » — et le module remonte la
chaîne, dimensionne chaque étage au bon ratio, pose l'ensemble avec ses routes, son entrepôt et
ses champs dans une boîte englobante minimale, et l'affiche pour recopie en jeu.

## Ce que ce module n'est pas

Le projet possède déjà `planIslandProduction`, qui pose une chaîne de production sur une **île
réelle**, avec ses slots de montagne, ses fertilités, sa main-d'œuvre logée sur place et sa
cascade de services. Ce n'est pas ce module-ci.

Le blueprint ne connaît **aucune île**. Il calcule sur un rectangle vide, sans terrain, sans
fertilité, sans population. C'est précisément ce qui le rend recopiable partout — et ce qui
justifie de l'écrire à part plutôt que de greffer un mode de plus sur un moteur qui porte déjà
huit chantiers ouverts (`docs/ETAT-ET-SUITE.md`).

## Décisions de cadrage

| question | décision |
|---|---|
| entrée | **Par bâtiment final** : « N boulangeries ». Le débit sort en résultat |
| surface | **Blueprint hors terrain**, boîte englobante choisie par le module |
| contraintes dures | accès route, portée d'entrepôt, quota de champ, rayon d'aire libre |
| ratio imparfait | **plan demandé + suggestion chiffrée** du lot parfait, avec bouton de bascule |
| main-d'œuvre | **chiffrée seulement**, jamais logée dans le blueprint |
| profondeur de chaîne | jusqu'aux matières brutes, **chaque intrant marquable « importé »** |
| isolation | code neuf, données partagées, rendu réutilisé |
| sorties | onglet dédié, export PNG, bibliothèque locale nommée |
| placeur | **glouton déterministe** (squelette routier + rangées), pas de recuit |

## Deux faits de données qui commandent la conception

**Les biens s'indexent différemment selon la source.** `economy.buildingProd` désigne les biens
par GUID — la boulangerie `g3174` consomme `2119` et produit `2137` — quand le catalogue les
désigne par nom d'affichage (`"Farine"`, `"Pain"`). Le graphe économique fait donc foi pour la
chaîne, en GUID ; le catalogue ne sert qu'à la **géométrie** (`size`, `field`, `freeArea`,
`needsRoad`, `transporterRange`, `icon`, `color`). Aucune traduction entre les deux, aucune
occasion de les faire diverger.

**Les coûts de construction n'existent pas dans l'export.** `economy.generated.json` porte
`buildingUpkeep` mais rien qui ressemble à un prix de pose. La ligne « Construction costs » des
layouts communautaires **ne sera pas affichée** : une case absente vaut mieux qu'un chiffre
inventé. L'extraction reste à faire, hors de ce chantier.

## L'exemple de référence, vérifié sur les données

| bâtiment | emprise | cycle | sortie | entrée |
|---|---|---|---|---|
| `g3174` Boulangerie | 4×5 | 60 s | 1 Pain (1/min) | 1 Farine (1/min) |
| `g3075` Moulin à grains | 4×6 | 30 s | 1 Farine (2/min) | 1 Blé (2/min) |
| `g2693` Ferme de céréales | 4×3 | 60 s | 1 Blé (1/min) | — (140 cases de champ) |

Une boulangerie appelle donc **½ moulin** et **1 ferme**. Le lot parfait est `2 boulangeries :
1 moulin : 2 fermes` — exactement le cas que le module doit savoir suggérer.

---

## 1. Frontière du module

Nouveau dossier `src/prodlayout/`, **sans aucun import depuis `src/optimizer/` ni
`src/economy/`**. Un test de frontière le verrouille.

Ce qu'il lit :

- `src/data/economy.generated.json` — le graphe de production, en GUID ;
- le catalogue de `BuildingDef` — la géométrie seule ;
- `src/model/types.ts` — et surtout, **le module produit un `Layout` standard**
  (`grid` + `buildings` + `roads` + `fields`). C'est ce qui fait que `src/render/draw.ts` et
  `src/render/exportImage.ts` fonctionnent sans une ligne d'adaptation.

| fichier | responsabilité | dépend de |
|---|---|---|
| `types.ts` | types du module | — |
| `chain.ts` | GUID cible → arbre de chaîne, ratios exacts, imports, main-d'œuvre | données `economy.generated.json` |
| `lot.ts` | arrondis, taux d'utilisation, lot parfait | chain |
| `roads.ts` | squelette routier, BFS de distance-rue | — |
| `fields.ts` | pavage des champs, réservation d'aire libre | catalogue |
| `pack.ts` | boîte, ordre de pose, entrepôt, compaction | roads, fields |
| `report.ts` | récapitulatif chiffré | chain, pack |
| `index.ts` | `planProductionLayout(defId, n, opts) → LayoutPlan` | tous |

Chaque fichier reste sous ~250 lignes. Le découpage n'est pas décoratif : `planIslandImport`
pèse 1 107 lignes et son `finalize` de 580 lignes est aujourd'hui un chantier à lui seul
(`ETAT-ET-SUITE.md` §3.8). On ne recommence pas.

## 2. Le solveur de ratios (`chain.ts`, `lot.ts`)

**Entrée** : `{ defId cible, nombre, importés: Set<GUID de bien> }`.
**Sortie** : comptes fractionnaires exacts, comptes posés, taux d'utilisation par bâtiment,
manifeste d'import, main-d'œuvre par palier.

**Les ratios restent des fractions.** `amount` et `cycleTime` sont des entiers ; tout garder en
rationnel (numérateur / dénominateur, réduit par PGCD) évite qu'un `0,333…` flottant fasse
rater le lot parfait. Le **lot parfait est le PPCM des dénominateurs** des comptes exacts.

**Le producteur suit la région du bâtiment cible.** `economy.producers[2069]` rend
`["g2693", "g5972"]` — ferme romaine et ferme celtique. Une boulangerie romaine ne doit pas
tirer une ferme celtique. À défaut de région (bien exogène), on prend la première.

**Les cycles du graphe sont bornés.** Une pile de biens en cours de résolution coupe la
récursion ; un bien déjà sur la pile est traité comme importé et signalé.

**Les producteurs à `slotType` sont détectés, pas coupés d'office.** 41 bâtiments du catalogue
exigent un slot de terrain (montagne, rivière, prairie, marais) et ne sont pas posables dans un
blueprint hors terrain. Le module les nomme — « Mine de fer : exige un slot montagne » — avec un
bouton *marquer comme importé* à côté. L'utilisateur garde la main, sans avoir à deviner lequel
pose problème.

**Un bien sans producteur** entre au manifeste d'import avec son débit et son coût
(`goodPrices`, approximation du prix d'achat).

## 3. Le placeur (`pack.ts`)

Tout est en balayage à ordre fixe. **Même entrée, même plan** — c'est ce qui permet de
verrouiller le résultat par test au lieu de le constater.

### 3.1 Boîtes candidates

Surface utile `S` = Σ emprises + Σ cases de champ + Σ disques d'aire libre (`π·radius²` par
bâtiment à `freeArea`, plafonné à sa `area` exigée). On essaie douze boîtes : rapports `1:1`,
`4:3`, `3:2`, `2:1` × gonflement `1,15`, `1,3`, `1,5` de `S`. Chaque candidate est un essai
complet ; on garde la meilleure efficacité, départagée par la plus petite boîte puis par le
rapport le plus carré — un ordre total, donc un résultat stable.

### 3.2 Ordre de pose : du plus contraint au plus libre

L'ordre décide de la réussite, il n'est pas cosmétique.

1. **Entrepôt** au centre de la boîte — ancre de la portée de charrette, tout se mesure depuis
   lui. `g3310 Entrepôt` 6×6 côté romain, son équivalent régional sinon.
2. **Squelette routier** : épine dorsale d'une case de large traversant l'entrepôt, branches en
   peigne perpendiculaires au pas `p = 2·d + 1`, où `d` est la plus grande dimension d'emprise
   parmi les bâtiments à poser — une rangée de chaque côté de la branche, chacune touchant la
   route.
3. **Bâtiments à `freeArea`** (rayon 10, 140 cases libres exigées) en périphérie, leur disque
   marqué interdit aux autres. Posés tard, ils échouent toujours.
4. **Fermes** — 140 cases de champ chacune dans un rayon de 22 — qui réservent leur quota avant
   que le reste ne mange la place.
5. **Le reste**, emprise décroissante, première position valide en balayage haut-gauche →
   bas-droite le long des bandes routières. Rotations 0 et 90 testées si `rotatable`.
6. **Champs** en remplissage final : BFS depuis chaque ferme, cases libres dans son rayon,
   jusqu'au quota. Les champs n'exigent pas de route.

### 3.3 Les deux vérifications qui font foi

Un bâtiment `needsRoad` doit toucher une case de route par au moins une case de son emprise.

Et surtout : **BFS de distance-rue depuis l'entrepôt**, chaque producteur devant être atteint
sous son `transporterRange` — 30 pour 85 bâtiments du catalogue, 40 pour la ferme de céréales,
jusqu'à 80. Un plan qui rate cette vérification est un tas de bâtiments qui n'expédie rien en
jeu. Si un producteur reste hors portée, on ajoute un second entrepôt au barycentre des échecs
et on rejoue ; si ça rate encore, la boîte est rejetée.

### 3.4 Compaction

Rognage des lignes et colonnes vides en bordure, puis nouvelle tentative sur une boîte réduite
d'une bande, tant que le plan reste valide.

### 3.5 Efficacité

`(emprises + champs + routes) / cases de la boîte`. Les routes comptent comme utiles : le jeu
les exige, ce n'est pas du gâchis.

Cette définition **ne reproduit pas celle des layouts communautaires** et ne le prétend pas :
la capture « Schnapps 01 WH » annonce 408 cases pour 17×24, soit exactement la boîte entière, et
pourtant 97,30 % d'efficacité. Leur formule compte autre chose. La nôtre est explicite.

### 3.6 Échec

Le module ne rend jamais un plan silencieusement faux. Toute contrainte non tenue remonte dans
`gaps[]` et s'affiche : ferme sous son quota de champ, producteur hors portée d'entrepôt, aire
libre entamée, intrant non posable. Le plan est livré avec ses manques nommés.

C'est la leçon la plus chère du projet : un plan effondré livré `viable=true` a bridé toutes les
grandes îles romaines pendant des semaines sans que rien ne le signale (`ETAT-ET-SUITE.md`
§3.1).

## 4. Interface

Nouveau mode dans `NavRail`, à côté d'Éditeur / Plan d'île / Multi-îles. Trois colonnes.

**Gauche — la commande.** Sélecteur du bâtiment cible, filtré par le monde actif (la bascule
Latium / Albion existe déjà) et restreint aux bâtiments produisant quelque chose. Un champ de
nombre. En dessous, l'arbre de la chaîne, chaque intrant portant son compte exact, son taux
d'utilisation et un bouton *importer*.

**Centre — le plan.** Canvas rendu par `draw.ts`, boîte englobante matérialisée. Un bandeau
au-dessus quand le lot est imparfait : « le moulin tourne à 50 % — à 2 boulangeries : aucun
gaspillage », suivi de la nouvelle taille, avec un bouton de bascule. **Le chiffre avant de
cliquer, pas après.**

**Droite — le récapitulatif.** Bâtiments avec icônes et comptes, entretien, main-d'œuvre par
palier, taille, cases, efficacité, production/min, valeur marchande, manifeste d'import et son
coût. Pas de ligne « coût de construction ».

Boutons : *exporter en PNG* (`exportImage.ts`), *enregistrer* / *charger* dans une bibliothèque
locale nommée, persistée par `src/persist/local.ts`.

**Pas de worker.** Le plan d'île en utilise un parce qu'il coûte des centaines de millisecondes ;
douze essais de packing sur quelques dizaines de bâtiments se comptent en millisecondes.

## 5. Tests

Un fichier de test par fichier de source, plus un bout en bout.

| test | ce qu'il verrouille |
|---|---|
| `chain.test.ts` | le pain romain rend `1 boulangerie : ½ moulin : 1 ferme` ; un cycle du graphe ne boucle pas ; une boulangerie romaine ne tire pas la ferme celtique ; un intrant marqué importé sort des comptes et entre au manifeste |
| `lot.test.ts` | PPCM sur dénominateurs rationnels → `2 : 1 : 2` ; le moulin est à 50 % d'utilisation pour une boulangerie |
| `roads.test.ts` | le BFS compte le long des routes, pas à vol d'oiseau |
| `fields.test.ts` | une ferme atteint ses 140 cases ; deux fermes serrées ne se volent pas leurs champs |
| `pack.test.ts` | quatre invariants : aucun chevauchement, tout `needsRoad` touche une route, tout producteur est sous son `transporterRange`, **deux appels identiques rendent un plan identique** |
| `frontiere.test.ts` | aucun fichier de `src/prodlayout/` n'importe `src/optimizer/` ni `src/economy/` |
| `prodlayout.e2e.test.ts` | la boulangerie romaine de bout en bout : boîte, efficacité et comptes figés en valeur |

Le test de déterminisme est celui qui rapporte le plus : sans lui, toute comparaison « la version
B fait mieux que A » serait du bruit, et le module cesserait d'être mesurable.

## 6. Hors périmètre, sciemment

- **La pose sur une île réelle.** Le blueprint reste hors terrain. Le coller sur une île est un
  chantier suivant, qui ne changera pas le cœur.
- **Les maisons ouvrières et leurs services.** La main-d'œuvre est chiffrée, jamais logée : les
  loger ferait rentrer par la fenêtre toute la cascade services / couverture que ce module
  existe pour tenir à part.
- **Les coûts de construction.** Absents de l'export ; extraction à faire séparément.
- **La passe d'amélioration locale** (déplacer un bâtiment vers un trou, échanger deux rangées,
  en nombre fixe pour rester déterministe). Elle ne se construit que si une mesure sur des
  chaînes réelles montre que le glouton laisse une boîte visiblement lâche.

Le recuit simulé est écarté pour de bon, pas seulement reporté : le projet a mesuré que la
géométrie plafonne à +3 % quand le choix de la recette vaut ×1,48 (`src/optimizer/recipes.ts`).
Payer l'indéterminisme — donc l'impossibilité de verrouiller un résultat par test — pour ce
gain-là serait un mauvais échange.
