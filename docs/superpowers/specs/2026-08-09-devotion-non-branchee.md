# Dévotion : extraite, pas encore branchée

Date : 2026-08-09. Fait suite à l'extraction des huit divinités (`feat(economy)`, commit
`ba05407`). Les données sont là ; la tentative de les faire agir sur le plan a été **revertie**
après mesure. Ce document dit pourquoi, pour que la prochaine tentative parte du bon endroit.

## Ce qui est acquis, et testé

`economy.patrons` porte les huit divinités : autel emblématique, pool d'autels, merveille,
effets locaux avec leurs paliers de dévotion, effets dominants. `economy.religion` donne les
trois seuils (dominance 7 000, merveille 4 000, autel 1 000). Verrouillé par
`src/economy/patrons.test.ts`.

**Trois divinités seulement touchent les résidences** — celles dont un effet local vise le pool
`31046 « All Residences »` :

| divinité | effet local | échelle |
|---|---|---|
| Cérès | Population +1 | ×1 → ×7 |
| Cernunnos | Santé +1, Connaissance +1 | ×1 → ×7 |
| Minerve | Connaissance +1 | ×1, 3, 5 … 13 |

Epona vise `38370` (bâtiments de production), Mercure les comptoirs, dépôts et jetées. Les
crediter aux maisons serait faux — le Prestige de Mercure monte à ×350.

L'échelle est un **multiplicateur**, lisible dans la donnée : Cérès porte Population 1 avec une
échelle 1→7, Epona Population 1 **et** Prestige 2 avec la même échelle.

## La tentative, et ce qu'elle a appris

Quatre corrections successives, chacune réparant un défaut réel du modèle :

1. **`patronAttrs` par maison** dans `LatticeOpts`, alimenté depuis `req.devotion`.
2. **Découplage de l'autel.** Première version : la divinité n'était créditée que si son autel
   était posé. Faux — le dieu tutélaire est un CHOIX D'ÎLE, pas un bâtiment
   (`GAME_MECHANICS.md §9 bis.1`). Or sur la plupart des îles l'autel ne paie pas son sol et se
   fait rejeter, donc la dévotion ne servait jamais.
3. **Population est une CAPACITÉ, pas un attribut.** Les habitants viennent de `reach.cap`,
   calculé par le modèle de besoins, pas de la carte d'attributs. Créditer Cérès dans `attrs`
   seul ne logeait personne.
4. **Le dieu ne se choisit pas sur son autel.** Les divinités à effet d'île ont justement des
   autels médiocres : élues sur le rayon, elles perdaient la présélection et leur bonus
   disparaissait avec elles.

**Malgré ces quatre correctifs, aucune mesure ne bouge** : `roman_island_small_06` rend
13 835 habitants à dévotion 0, 4 500 et 25 000 — au habitant près. La continentale du DLC de
même. Seule `roman_island_extralarge_02` frémit (44 651 → 44 634, soit −17).

## Le point de blocage, MESURÉ

La question posée était : le bloc d'élection est-il seulement atteint ? Une trace y répond, et
elle écarte l'hypothèse la plus commode.

```
### TRACE pick=true instCands=12 sanctuaires=6      (roman_island_small_06)
```

**Le bloc est atteint**, quatre fois, avec six sanctuaires candidats. L'élection tourne. Le
défaut est ailleurs, et il est structurel :

> Un autel **gagne** la présélection — c'est son effet de zone qui le fait gagner. La divinité
> est donc verrouillée sur ce dieu-là, qui n'a aucun effet d'île. Puis la passe de RAFFINAGE
> rejoue le plan et **retire l'autel**, jugé trop coûteux en sol. Résultat : ni autel, ni dieu.
> Le plan affiche `dieu=aucun` alors que l'élection a bien eu lieu, et la branche « sans autel »
> qui aurait crédité Cérès n'est jamais empruntée, puisque l'autel avait gagné.

Les quatre correctifs listés plus haut réparaient tous un vrai défaut, mais aucun ne touchait
celui-là : ils supposaient que `dieu=aucun` signifiait « autel rejeté », alors qu'il signifiait
« autel retenu puis élagué plus tard ».

## Par où reprendre

Découpler complètement les deux décisions, dans cet ordre :

1. **la DIVINITÉ** — choisie une fois, sur ce qu'elle rend aux résidences à la dévotion
   courante, indépendamment de tout autel. Ses attributs s'appliquent à TOUTES les passes, y
   compris le plan de base et le raffinage ;
2. **l'AUTEL** — décidé après, comme n'importe quel bâtiment : il se pose s'il paie son sol.

Aujourd'hui la seconde décision commande la première, et la dernière passe peut annuler les
deux. Tant que cet ordre n'est pas inversé, aucun réglage de dévotion ne produira d'effet.

## Ancien diagnostic, conservé pour mémoire

Le bloc d'élection est gardé par :

```ts
if (pick && instCands.some((i) => i.uniqueType === SHRINE_TYPE)) {
```

Sur `roman_island_small_06` le plan final annonce `dieu=aucun`, ce qui est compatible avec DEUX
lectures opposées : soit les autels ont été essayés puis rejetés, soit **le bloc n'est jamais
entré**. Rien dans les mesures prises ne les distingue, et c'est là que la prochaine tentative
doit commencer — par une trace, pas par une hypothèse.

Si le bloc n'est pas entré, la cause probable est `instCands` : `institutionDefs` ne retient que
les bâtiments à effet de zone `street` bénéfique qui ne sont service d'aucun palier, et le
filtre `tierGod` peut le réduire à vide.

## Ce qui reste hors de portée, indépendamment

L'effet **dominant** de Vulcain — Incendie +2 greffé sur chaque fonderie, sans permis — est
extrait et testé, mais **inapplicable en l'état** : il vise le pool `50609 « All Smelters »`, et
les pools sont VIDES dans l'export XML (0 sur 323 pools d'attributs renseignés). Il faudrait
identifier les fonderies autrement — par template ou par chaîne de production — avant de
pouvoir poser cet effet.

C'est pourtant le plus gros levier connu sur l'attribut qui borne toutes les grandes îles.
