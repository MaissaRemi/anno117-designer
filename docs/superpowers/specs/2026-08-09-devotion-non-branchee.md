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

## Le point de blocage, à vérifier en premier

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
