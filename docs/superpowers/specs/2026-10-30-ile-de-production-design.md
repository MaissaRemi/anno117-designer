# Île de production : conception

Statut : **proposée, en attente de validation par Rémi.** Aucun code écrit.

Diagnostic de départ (`plans/2026-10-29-portees-motifs-eau.md`, « Onglet Production ») : l'onglet
Production calcule une chaîne par ratios exacts puis un plan compact HORS de toute île — ni
côte, ni emplacements, ni relief, ni bonus de productivité. À refaire comme un mode de
Planifier (île de production), sur la vraie géométrie, avec les dieux.

## 1. Ce qui existe : trois portes pour la même idée

| Porte | Entrée | Où | Ce qui manque |
|---|---|---|---|
| Onglet **Production** (`prodlayout`, `planProductionLayout`) | un bâtiment terminal ou un panier | hors île, boîte minimale | île, côte, emplacements, relief, dieux, maisons ouvrières (chiffrées, jamais logées) |
| **Planifier**, mode « production » (`optimizer/prodPlan.ts`) | un bien + un débit | sur l'île | moteur ancien (recuit), côte et emplacements approximatifs (mines déplacées après coup), pas de dieux |
| Onglet **Commande**, panier de production (`commande/production.ts`, `disposerProduction`) | des bâtiments et leurs nombres | sur l'île, vraie géométrie | une entrée « bien + débit » ; c'est au joueur de compter les bâtiments |

La troisième porte fait déjà le plus dur : lots de production posés sur la vraie île
(côte à cheval, emplacements de montagne, relief, entrepôts à portée de transport), maisons
ouvrières logées, productivité du dieu tutélaire (`nomenclature`, `productiviteDuDieu`),
rapport ligne à ligne. Il lui manque l'objectif que le joueur pense : « 10 pains / min ».

## 2. Proposition

**Un seul moteur de production sur île : celui de Commande.** L'île de production devient une
commande dont la production se calcule depuis un objectif :

1. **Entrée** : un ou plusieurs biens finis avec leur débit (u/min), le monde et le peuple de
   l'île (Latium ; Albion branche celte ou romanisée — jamais mélangés), le dieu tutélaire et
   sa dévotion, le type de route.
2. **Nombre de bâtiments** : la chaîne de chaque bien par ratios exacts (`prodlayout/chain.ts`,
   déjà testé), débits multipliés par la productivité du dieu pour les ateliers qu'il vise,
   arrondis au supérieur ; les chaînes partagées (deux biens qui consomment de la farine) se
   cumulent avant l'arrondi.
3. **Pose** : la commande ainsi obtenue passe telle quelle par `planifierCommande` —
   nomenclature, maisons ouvrières logées, quartiers, production sur la vraie île, rapport.
4. **Interface** : le mode « production » de Planifier ouvre ce formulaire (biens, débits) à
   la place de l'actuel ; le rapport est celui de Commande, plus le débit obtenu par bien.

Ce qui disparaît : le mode « production » de `prodPlan.ts` (recuit). Ce qui reste à décider :
l'onglet Production hors île (blueprints recopiables) — utile pour copier un motif en jeu,
mais redondant si l'île de production le remplace (question 2).

## 3. Étapes, chacune mesurable

1. `objectifEnCommande(biens, monde, dieu)` : bien + débit → lignes de production. Tests :
   pain romain 10 / min sans dieu = les ratios de `chain.ts` ; avec Cérès à 300 000 de dévotion,
   moins d'ateliers visés, mêmes fermes si elles ne sont pas visées ; une île d'Albion n'utilise
   que des bâtiments de sa région.
2. Branchement dans Planifier (mode production) et rapport du débit obtenu par bien.
3. Retrait du recuit de `prodPlan.ts` et de son mode ; golden et recensements inchangés pour le
   mode population.
4. Selon la réponse à la question 2 : retrait ou maintien de l'onglet Production.

Vérification : sur 3 îles du Latium et 3 d'Albion (une par branche), un objectif simple (pain,
outils) doit être entièrement posé, servi et relié au comptoir, avec le débit demandé atteint.

## 4. Questions pour Rémi

1. **L'entrée** : un seul bien et son débit (comme l'actuel mode), ou plusieurs biens à la fois
   (une île qui fait pain ET outils) ?
2. **L'onglet Production hors île** (blueprints compacts) : le garder pour recopier un motif en
   jeu, ou le retirer au profit de l'île de production ?
3. **La productivité** : seulement celle du dieu tutélaire (déjà dans les données), ou aussi la
   recherche et les objets ? Ces deux-là ne sont pas dans les données extraites : il faudrait
   les saisir à la main.
4. **Les matières premières** : produites sur l'île, ou importées quand l'île n'a pas
   l'emplacement ou la fertilité ? Aujourd'hui `completerProduction` produit tout.
