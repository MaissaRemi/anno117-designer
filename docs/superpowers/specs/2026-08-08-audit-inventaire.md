# Inventaire de l'audit par invariants

Balayage du 2026-08-08 : **91 plans** (55 îles au palier sommet + 6 îles × 3 paliers × 2 jeux
d'options), 161 violations brutes. Chaque candidat a été confirmé en lisant le code avant
d'entrer ici.

Rejouable : `AUDIT=1 pnpm exec vitest run src/optimizer/audit.sweep.test.ts`

## Corrigé

| # | défaut | étendue | correctif |
|---|---|---|---|
| 1 | Les paliers d'Albion référençaient des bâtiments ROMAINS (résolution du besoin par icône, commune aux deux mondes). Les deux variantes étaient posées, chacune avec son bit : le poids du besoin comptait DEUX FOIS. | tous les paliers celtiques | `service_def()` par monde, repli sur le jumeau de même nom (`build_economy.py`) |
| 2 | Source d'aqueduc ROMAINE sur toute île d'Albion | toutes les îles celtiques | choix par monde (`waterPlan.ts`) |
| 3 | Entrepôt ROMAIN sur Albion — ses entrepôts portent le template `Warehouse_Marsh`, jamais cherché. `prodPlan` codait `"Roman"` en dur. | 3 îles mesurées | `pickWarehouseDef(catalog, region)` |
| 4 | Comptoir ABANDONNÉ quand le raccordement échoue → plan sans racine, ville entièrement inactive en jeu | 3 îles sur 55 | posé quand même, avec un message qui dit quoi faire |
| 5 | Tailles de bâtiment non lues des archives, repliées sur 3×3 en silence — dont `Bosquet sacré`, un SERVICE du palier Aldermen | 17 bâtiments, 4 posables | `sizeGuessed` + avertissement à la construction |

Effet mesuré du n° 1 : `celtic_island_large_07` / Nobles passe de 9 598 habitants annoncés à
4 616 réels. Ce n'est pas une régression, c'est la fin d'un double comptage — même nature que
les 67 862 habitants d'avant la contrainte de viabilité.

## Deux règles étaient fausses, pas le moteur

La discipline de confirmation a intercepté deux faux positifs, qui auraient conduit à
« corriger » du code sain :

- **`dans-la-grille`** accusait 42 îles sur 55. Toutes à tort : sources d'aqueduc et
  exploitations se posent sur des SLOTS de terrain, exclus du masque de terre parce que listés
  à part. Règle corrigée (exemption portuaire, `slotType`, `AqueductProducer`).
- **`acces-comptoir`** mêlait deux gravités. Une RÉSIDENCE coupée est un mensonge comptable ;
  un SERVICE coupé est une perte d'efficacité déjà signalée. Deux règles distinctes.

## Confirmation finale

Balayage rejoué après correction, code identique à celui du dépôt :

| passe | avant | après |
|---|---|---|
| LARGE — 55 îles | 98 violations, **4 familles de `faute`** (`acces-comptoir` 52 îles, `dans-la-grille` 42, `comptoir-present` 3, `pas-de-chevauchement` 1) | 55 violations, **aucune `faute`** |
| PROFONDE — 36 plans | 63 violations, 3 familles de `faute` | 33 violations, **aucune `faute`** |

Ne subsiste que `acces-comptoir-services`, de gravité `suspect` : 1 à 61 services par île
isolés par l'élagage des routes à l'intérieur du tenant principal. Déjà signalé à
l'utilisateur dans les trous du plan, et exclu de la couverture affichée depuis le correctif
des services inactifs.

**Filet permanent** : `invariants.test.ts` rejoue les règles sur les trois îles qui ont révélé
les défauts A, B et C, et fait échouer la suite sur toute violation `faute`. ~20 s.

---

## Corrigé au troisième lot

**A. Le comptoir se déclarait raccordé sans toucher aucune route.** `connectKontor` construisait
son périmètre COINS COMPRIS, et une route sur un coin — diagonale — faisait répondre « déjà
raccordé ». Sur `celtic_island_large_05` : zéro route sur les 30 cases orthogonales du comptoir,
dont 29 sur terre, dans un plan qui en compte 13 933. Aucune racine, 147 services inactifs.
Périmètre orthogonal désormais : 147 → 61 services isolés, et `celtic_island_large_07` gagne
4 616 → 4 925 habitants.

**B. La source d'aqueduc se posait sur le comptoir.** La réservation retire l'emprise du masque
de TERRE ; or une source vise justement les cases hors masque, celles des zones montagne. Et le
comptoir, posé plus tard, n'est pas dans le `bldOcc` que consulte `planWater`. 7 cases occupées
deux fois sur `roman_island_small_02`. `planWater` reçoit désormais l'emprise réservée.

**C. Une résidence comptée sans accès.** `repairRoadConnectivity` ne voit que les ÎLOTS de
route : une maison qui n'en touche plus aucune lui est invisible. La classe est fermée par une
passe finale qui tranche sur le critère du jeu (`rootedRoadSet` + `roadConnected`) et retire
toute résidence que le réseau enraciné n'atteint pas.

---

## Ancien état — pour mémoire

**A. La case d'accès du comptoir disparaît du plan final.** `celtic_island_large_05` : le
comptoir est posé ET raccordé (18 maisons rasées pour cela), mais la disposition finale ne
contient plus aucune route touchant son emprise — `rootedRoadSet` rend `hasRoot: false` — et
**147 services** se retrouvent isolés. Le plan est largement inactif en jeu. La perte se
produit entre `connectKontor` et la disposition finale ; les deux suspects sont l'élagage des
routes de `planLattice` et le retrait d'îlots « inutiles » de `repairRoadConnectivity`.
*C'est le plus grave des trois.*

**B. Chevauchement de bâtiments.** `roman_island_small_02`, 7 cases occupées deux fois. Illégal
en jeu. Une seule île sur 55 : probablement une interaction entre le raccord du comptoir et une
pose ultérieure.

**C. Une résidence sans accès au comptoir.** Même île, 1 maison comptée dans la population sans
l'être en jeu. Probablement le même mécanisme que A, en plus petit.

**D. Reliquat connu, gravité `suspect`.** 7 à 29 services isolés par île, dus à l'élagage des
routes à l'intérieur du tenant principal. Déjà documenté, déjà signalé à l'utilisateur, exclu
de la couverture affichée depuis le correctif des services inactifs.

## Le reliquat : RÉGLÉ à la troisième tentative

**Ce qui manquait n'était pas de la route, c'était la RACINE.** `pruneRoads` choisissait ce
qu'il gardait sans savoir où se trouve le comptoir. Sa position est pourtant fixée avant les
moteurs par `reserveKontor`, et elle arrivait déjà dans `LatticeOpts.reserved` — ajoutée pour
empêcher la source d'aqueduc de s'y poser. Il suffisait d'ancrer l'élagage dessus.

L'élagage force désormais l'anneau du comptoir dans le réseau gardé, puis, pour chaque morceau
qui n'y tient pas, restitue le chemin qui l'y ramène — en puisant dans les routes élaguées, qui
ne coûtent rien : l'élagage passe après `placeHouses` sans toucher `roadAt`, donc aucune maison
ne s'y est posée.

| île | services isolés | habitants |
|---|---|---|
| celtic_island_large_05 | 61 → **9** | 4 605 → **4 896** (+6,3 %) |
| celtic_island_small_07 | 29 → **1** | 2 474 → 2 476 |
| celtic_island_medium_05 | 22 → **6** | 4 861 → 4 873 |
| celtic_island_large_07 | 33 → **6** | 4 925 → **4 978** |
| roman_island_medium_01 | 7 → 7 | 18 303 → 18 313 |
| roman_island_small_02 | 13 → 13 | inchangé |

**165 → 42 services isolés, soit −75 %**, et la population monte partout. Les deux îles
inchangées relèvent de l'autre moitié du problème : les services qui n'ont AUCUNE route
adjacente (9 sur 61 sur large_05), que l'élagage ne peut pas raccrocher faute de point d'accroche.

### Deux tentatives réfutées avant celle-là

Elles valent d'être conservées : toutes deux consistaient à AJOUTER des routes après coup, et
toutes deux ont aggravé le défaut.

**Tentative 1 — rendre le réseau élagué connexe, dans `pruneRoads`, autour de « la plus grosse
composante ».** 61 → **147** services isolés. Les 1 679 cases ajoutées déplacent l'endroit où le
comptoir se raccroche : le tronc enraciné tombe de 12 693 à 11 487 cases.

**Tentative 2 — donner la réserve élaguée à `repairRoadConnectivity`.** Une île sur six
s'améliore (29 → 16), deux se dégradent lourdement : 61 → **166**, et 33 → **134** avec 4 925 →
4 402 habitants.

Le mécanisme commun : rendre des routes fait grandir le réseau sans garantir qu'il grandisse
DU BON CÔTÉ du comptoir. La troisième tentative ne diffère que par ce point — elle sait où est
la racine — et c'est tout l'écart entre −75 % et +170 %.

### Reste : les bâtiments sans AUCUNE route adjacente

Mesuré sur trois îles : **la totalité sont des sources d'aqueduc** — 7 sur
`roman_island_medium_01`, 5 sur `roman_island_small_02`, 9 sur `celtic_island_large_05`.
Aucun service de palier.

**Hypothèse posée puis RÉFUTÉE par l'utilisateur.** J'avais conclu que la source sortait du
régime routier — posée sur un slot montagne, entourée de cases hors masque de terre,
alimentée par des conduites — et je l'avais classée à part en `suspect`. C'est faux :

> « il faut qu'une route soit jusqu'à l'emplacement de montagne puisqu'il y aura des mines,
> et il faut un entrepôt à proximité que la mine puisse atteindre »

Le raisonnement « si le jeu exigeait une route, il rendrait le terrain constructible » ne
tient pas : le slot montagne accueille une MINE, qui a besoin de la route comme tout bâtiment
de production, et d'un entrepôt à portée de charrette pour expédier. L'exemption est retirée.

**RÉGLÉ.** Il fallait DEUX choses, et aucune ne suffit seule :

1. **Creuser un accès depuis chaque source vers le réseau.** Le chemin traverse le RELIEF —
   cases bloquées par le terrain, jamais par un bâtiment, puisque `fitsBld` exige `usable` et
   qu'aucune construction n'y tient — ainsi que les cases libres.
2. **Marquer l'adjacence de la source** (`markAdj`), comme `stamp` le fait pour tout autre
   bâtiment. La phase eau empilait ses sources dans `buildings` sans le faire : `bldAdj`
   restait vide autour d'elles, et l'élagage — qui garde sur le critère `roadAt && bldAdj` —
   reprenait leur unique accès. C'est pourquoi TOUS les bâtiments sans route mesurés étaient
   des sources : elles en avaient une, l'élagage la retirait.

| services isolés | medium_01 | small_02 | large_05 | small_07 | large_07 | medium_05 | total |
|---|---|---|---|---|---|---|---|
| avant | 7 | 13 | 9 | 1 | 6 | 6 | **42** |
| creusement seul | 7 | 13 | 9 | 1 | 6 | 6 | 42 |
| `markAdj` seul | 7 | 13 | 9 | 1 | 6 | 6 | 42 |
| les deux | **0** | 10 | **1** | 1 | **0** | **0** | **12** |

Trois îles sur six passent à AUCUNE violation. Les deux mesures d'isolation confirment que
ni l'une ni l'autre des corrections ne vaut seule — c'est leur conjonction qui compte.

**Reste** : `roman_island_small_02` (10, des `Medici`) et `celtic_island_small_07` (1, une
`Tour de guet`) — des institutions, pas des sources : autre mécanisme, à qualifier.

### L'entrepôt à portée de charrette — vérifié

Mesuré sur cinq îles, `exploitSlots` activé : **6 exploitations sur 31 sans débouché**.

| île | exploitations | sans entrepôt | type |
|---|---|---|---|
| roman_island_medium_01 | 4 | 0 | — |
| celtic_island_large_05 | 11 | 2 | marais ×1, montagne ×1 |
| celtic_island_large_07 | 12 | 4 | marais ×4 |
| celtic_island_medium_04 | 4 | 0 | — |
| roman_island_small_01 | 0 | 0 | — |

**Cinq des six sont des MARAIS, une seule montagne** — le correctif de la route de montagne a
donc bien porté sur son terrain.

**Ce n'est PAS un défaut d'accès routier.** `planSlots` sait creuser jusqu'à son propre slot :
son prédicat de passage autorise les cases non utilisables au voisinage du slot visé
(`nearSlot`). L'exploitation a sa route ; ce qui manque, c'est un **entrepôt** à moins de
`transporterRange` en distance-rue. C'est un problème de placement d'entrepôt sur des slots
éloignés, pas de viabilisation.

Conséquence en jeu : ces exploitations sont posées, coûtent leur entretien et leur
main-d'œuvre, et ne rapportent rien.

Le manque était déjà signalé dans les trous du plan ; il devient une règle d'invariant nommée,
`exploitation-sans-entrepot`, de gravité `suspect` — mesurable au balayage, avec sa
répartition par type de slot.

#### Tentative de sauvetage — RÉFUTÉE

Le glouton ne cherche des positions d'entrepôt qu'ADJACENTES aux routes déjà dans la portée de
charrette, et `fitsWh` exige du sol constructible. J'ai ajouté un rattrapage : repartir de
chaque exploitation abandonnée, avancer en distance-rue dans la limite de sa portée en creusant
au besoin, et s'arrêter au premier emplacement où l'entrepôt tient.

**Aucun effet** : 2 et 4 non desservies, identique. La cause est plus dure que le placement —
autour d'un marais, les cases sont non constructibles, donc le parcours ne peut pas avancer, et
le sol constructible est de toute façon **au-delà de la portée de charrette**. Retiré.

#### La vraie question est en amont

Ces exploitations ne sont pas mal servies, elles sont **inservables** : aucun entrepôt ne peut
tenir dans leur rayon. Les poser quand même coûte leur entretien et leur main-d'œuvre pour zéro
production.

La correction n'est donc pas d'améliorer le placement d'entrepôt, mais de **ne pas exploiter un
slot qu'on ne peut pas desservir** — décider avant de poser, ou retirer après coup. C'est un
changement de comportement du plan, pas de géométrie, et il faut le mesurer sur la population
et le bilan avant de l'adopter : moins d'exploitations, c'est aussi moins de main-d'œuvre
mobilisée et moins d'entretien.

**Ancien état de la question :**

1. **Amener la route jusqu'aux slots montagne.** `blockMountains` retire la zone montagne du
   masque constructible, et `layRoad` refuse toute case non utilisable (`occ` est initialisé à
   1 sur `!usable`) : le peigne ne peut donc structurellement pas y monter. Il faudra un
   chemin dédié, sur le modèle du corridor que `planWater` réserve déjà pour ses conduites via
   `mzone`.
2. **Vérifier l'entrepôt à portée.** `planSlots` place déjà des entrepôts par distance-rue
   (`transporterRange`) et signale les manques — « 4 exploitation(s) sans entrepôt à portée de
   charrette » est un message existant. À confronter aux invariants une fois la route montée.

### Le modèle ne connaît aucun TYPE de route

Question posée pendant l'audit : la distance-rue est-elle calculée sur des routes de base ou
en marbre ? **Ni l'une ni l'autre.** Le catalogue ne contient aucun asset de route —
l'extraction filtre sur des templates de bâtiment, les rues n'en sont pas — et le moteur n'a
nulle part de `roadType`. Une route est un booléen par case, la distance-rue un BFS à 1 par
case : implicitement, la route de base.

Si les routes pavées allongent la portée des services en jeu, ce bonus n'est ni extrait, ni
modélisé, ni compté, et toutes les couvertures sont calculées au pire cas. À vérifier dans les
fichiers du jeu.

### Diagnostic, pour mémoire

Le reliquat `acces-comptoir-services` a été attaqué deux fois. Les deux corrections ont été
mesurées, ont **aggravé** le défaut, et ont été retirées. Rien n'en subsiste dans le dépôt.

**Diagnostic établi** (`celtic_island_large_05`, palier sommet) :

- le réseau routier final compte **96 composantes** : un tronc de 12 693 cases, puis 169, 143,
  94, 74, 71, 50, 39… soit **1 240 cases hors du réseau enraciné** au comptoir ;
- sur les 61 services isolés, **52 ont bel et bien une route adjacente** — elle n'est
  simplement pas dans la composante du comptoir. Seuls 9 n'ont aucune route du tout. Ce sont
  deux problèmes distincts, et le second est marginal.

**Tentative 1 — rendre le réseau élagué connexe, dans `pruneRoads`.** Prendre le plus gros
morceau pour tronc, parcourir le réseau complet, restituer le chemin de chaque morceau isolé.

| | services isolés |
|---|---|
| référence | 61 |
| reconnexion | **147** |

Cause : la connexité qui compte n'est pas celle du réseau *en soi*, mais celle **au comptoir**
— or le comptoir n'existe pas encore à l'élagage. Ajouter 1 679 cases de route déplace
simplement l'endroit où il se raccroche : le tronc enraciné passe de 12 693 à 11 487 cases.

**Tentative 2 — donner à `repairRoadConnectivity` la réserve des routes élaguées.** L'idée
tenait debout : `pruneRoads` passe après `placeHouses` et ne touche pas `roadAt`, donc aucune
maison ne s'est posée sur une case élaguée — la restituer est gratuite. Et la réparation, elle,
s'exécute bien APRÈS la pose du comptoir, au bon moment.

| île | référence | avec la réserve |
|---|---|---|
| celtic_island_large_05 | 61 | **166** |
| celtic_island_large_07 | 33 | **134** (4 925 → 4 402 habitants) |
| celtic_island_medium_05 | 22 | 38 |
| celtic_island_small_07 | 29 | **16** |
| roman_island_medium_01 | 7 | 7 |
| roman_island_small_02 | 13 | 13 |

Une île sur six s'améliore, deux se dégradent lourdement. Même mécanisme que la tentative 1 :
rendre des routes fait grandir le réseau sans garantir qu'il grandisse DU BON CÔTÉ du comptoir.

**Ce qu'il ne faut PAS refaire.** Toute correction qui consiste à AJOUTER des routes après coup
se heurtera au même mur : la fragmentation ne vient pas d'un manque de routes — il en reste
13 933 — mais du fait que `pruneRoads` choisit ce qu'il garde sans connaître la racine du
réseau. La correction devra rendre l'élagage conscient du comptoir, dont la position est
pourtant connue AVANT les moteurs (`reserveKontor` la fixe) : c'est cette information qui n'est
pas transmise à `planLattice`, et c'est par là qu'il faudrait reprendre.

---

## Zones sans invariant

- **`src/ui`** (15 fichiers, 1 735 lignes, 0 test) : relu pour les quatre classes. Aucun `catch`
  muet, aucun `as any`, aucun `@ts-ignore`, erreurs de worker toutes remontées à l'interface.
  Rien à corriger.
- **`tools/`** (12 fichiers, 2 283 lignes, 0 test) : deux replis silencieux trouvés et rendus
  visibles (n° 5 ci-dessus, plus un piège `elem or fallback` sur ElementTree — latent, sans
  effet mesuré sur le catalogue régénéré).

## Services isolés par l'élagage : pourquoi ce n'est pas un correctif d'une ligne

Un service qu'aucune route rattachée au comptoir ne dessert est INACTIF en jeu : il ne rend
rien et coûte son entretien. Le retirer devrait donc rapporter, exactement comme le retrait des
consommateurs d'eau secs (+3,6 % sur `small_06`).

L'ordre du pipeline l'interdit en l'état. Dans `planLattice` :

```
placeHouses()   ← calcule couverture, paliers atteints, attrsSum, habitants
pruneRoads()    ← élague APRÈS
```

Retirer un service après l'élagage invaliderait tout ce que `placeHouses` vient de calculer :
sa couverture disparaît, les maisons qu'il desservait retombent d'un palier, la population et
le bilan d'attributs changent. C'est précisément parce que le retrait des services secs se
faisait AVANT la pose des maisons qu'il était sûr.

Le correctif est donc un réordonnancement : élaguer les routes d'abord, retirer les services
privés d'accès, puis poser les maisons. Il touche le cœur du moteur et demande un balayage
complet — à faire d'un seul tenant, pas en marge d'autre chose.
