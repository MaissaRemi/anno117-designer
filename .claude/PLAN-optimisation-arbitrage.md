# Deux leviers pour la qualité des plans d'île

État au 2026-08-08, après la cascade de main-d'œuvre, les dieux et les chaînes de production.
Note d'auto-évaluation de la feature : **6,3/10** — fidélité au jeu ~8, légalité des plans ~8,
**qualité d'optimisation ~4**. Ce document décrit ce qui manque pour monter, et pourquoi.

Mesure de référence, `roman_island_medium_01` en pleine résolution, emplacements + production
locale cochés : 22 901 habitants · 640/817 maisons au palier cible (78 %) · **couverture
minimale 56 %** · bilan positif (🔥 +455) · main-d'œuvre couverte · ~5 à 12 s.

---

## Levier 2 — PASSE DE RÉPARATION LOCALE (+1, à faire en premier)

**Le constat.** Couverture minimale 56 % : près d'une maison sur deux est hors de portée d'au
moins un service. Et 22 % des maisons n'atteignent pas le palier visé — elles retombent au
meilleur palier dont elles franchissent les seuils (comptabilité mixte), ce qui est correct
mais laisse de la capacité sur la table.

**Pourquoi c'est du gain facile.** Les moteurs posent les services sur des trames régulières
calées sur leur portée. Une maison qui rate un seuil le rate souvent *de peu* — il lui manque
un seul service, à quelques tuiles. Rien aujourd'hui ne repasse derrière pour combler ces
trous : le plan retenu est livré tel quel.

**Forme proposée.** Après le choix du plan et AVANT le règlement de la main-d'œuvre :

1. pour chaque parcelle, on connaît déjà son masque de couverture et ses paliers atteignables
   (`HousePlot.opts`, `planLattice.ts`) ;
2. repérer les parcelles dont le palier atteint est strictement inférieur au palier cible, et
   pour lesquelles il ne manque qu'UNE catégorie de service au seuil ;
3. grouper ces parcelles par service manquant, et chercher une position libre couvrant le plus
   gros groupe (min-cover glouton, le même que `planSlots` utilise pour ses entrepôts) ;
4. poser tant que le bilan d'attributs le permet — le budget existe déjà, et `settleWith`
   sait le juger pour de bon.

**Pourquoi c'est le bon point de départ.** Isolé (aucun moteur à toucher), mesurable
immédiatement (la couverture minimale est affichée dans l'interface), et sans risque pour ce
qui vient d'être stabilisé. Le garde-fou de viabilité et le recul sur pose encadrent déjà
toute pose supplémentaire.

**Piège connu.** Densifier allonge la distance-rue moyenne et consomme du sol : au-delà d'un
certain seuil le moteur sur-densifie et la population BAISSE. C'est déjà documenté pour le
raffinage (`REFINE_FLOOR = 0.9`, `islandPlan.ts`). La passe doit donc être jugée sur la
population livrée, pas sur la couverture — la couverture n'est qu'un indice.

---

## Levier 1 — LE COÛT RÉEL DANS LA SÉLECTION (+1,5, refonte)

**Le constat.** `better()` compare les plans candidats sur leurs habitants et la viabilité d'un
plan NU. Les emplacements, les ateliers, les conversions de main-d'œuvre et leurs effets de
zone sont appliqués APRÈS que le plan a été choisi. On optimise donc une approximation, puis on
corrige — et le correctif (le recul sur pose) ne peut que retrancher, jamais rattraper un
mauvais choix de départ.

C'est ce décalage qui a produit le bilan à −1 : un plan retenu comme viable finissait négatif
une fois ses coûts réels appliqués. Le recul le MASQUE proprement ; il ne l'élimine pas.

**Ce qui rend la chose coûteuse.** Évaluer le coût réel d'un candidat suppose de lui faire
subir tout le pipeline aval — `planSlots`, `planLocalProduction`, le règlement — soit
plusieurs secondes par candidat, pour une douzaine de candidats.

**Deux voies, par ordre de faisabilité.**

*(a) Estimation bon marché du coût aval, intégrée à `better()`.* Le gros du coût est
prévisible sans poser quoi que ce soit : le nombre d'emplacements libres est connu, leur malus
de zone est une donnée, et la demande de main-d'œuvre d'un atelier aussi. Une borne inférieure
du coût suffirait à écarter les candidats qui n'ont aucune chance. Peu invasif, gain partiel.

*(b) Pipeline complet sur les 2 ou 3 meilleurs candidats.* On garde le pré-tri actuel, puis on
fait subir le pipeline aval aux finalistes seulement, et on tranche sur le résultat FINAL. Coût
en temps : ×2 à ×3 sur la phase de sélection, qui pèse déjà 92 % du plan. À financer par le
levier d'efficacité restant (cf. plus bas).

La voie (b) est la bonne réponse ; (a) est le repli si le temps de calcul devient inacceptable.

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
