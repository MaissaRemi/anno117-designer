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

## Reste à corriger — confirmé, non résolu

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

## Zones sans invariant

- **`src/ui`** (15 fichiers, 1 735 lignes, 0 test) : relu pour les quatre classes. Aucun `catch`
  muet, aucun `as any`, aucun `@ts-ignore`, erreurs de worker toutes remontées à l'interface.
  Rien à corriger.
- **`tools/`** (12 fichiers, 2 283 lignes, 0 test) : deux replis silencieux trouvés et rendus
  visibles (n° 5 ci-dessus, plus un piège `elem or fallback` sur ElementTree — latent, sans
  effet mesuré sur le catalogue régénéré).
