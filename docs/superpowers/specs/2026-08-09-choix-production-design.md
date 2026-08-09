# Choisir les bâtiments de production avant le calcul du plan

Date : 2026-08-09.

Aujourd'hui, `planLocalProduction` choisit seul les ateliers à poser, à partir du manifeste
d'import et par débit décroissant, et `planSlots` choisit seul quoi mettre sur chaque
emplacement de terrain. L'utilisateur n'a que deux cases à cocher : « Exploiter les
emplacements » et « Produire sur l'île ».

Ce document décrit comment lui laisser demander « trois boulangeries et deux bijoutiers », et
« du fer sur les slots montagne ».

## Décisions de cadrage

| question | décision |
|---|---|
| granularité | **Liste de vœux**, le moteur reste libre du placement |
| si la demande ne tient pas | **Poser ce qui tient, annoncer ce qui a sauté** |
| après la liste | **Le moteur continue** son choix automatique avec le budget restant, intrants compris |

Le choix emplacement par emplacement — « ce slot-ci → fer, celui-là → pierre » — est
explicitement écarté : il demanderait d'exposer la liste des slots avec leur position, donc un
sélecteur adossé à la carte. La préférence se fait **par type de slot**.

## Pourquoi une file amorcée, et pas un module séparé

`planLocalProduction` travaille déjà sur une file de biens triée par débit, qu'il dépile en
posant `copies` exemplaires et en y réinjectant les intrants. Chaque copie est déjà encadrée
par le devis de main-d'œuvre (`workforce.quote`), le budget d'attributs, la recherche de
terrain libre, la réservation du sol et le recul sur pose.

La liste de vœux devient donc **le début de cette file**, en unités de BÂTIMENT plutôt que de
bien. Aucun de ces garde-fous n'est à réécrire.

Les deux alternatives ont été écartées :

- **un pré-plan séparé, fusionné ensuite** : il faudrait dupliquer le devis de main-d'œuvre et
  le budget d'attributs, ou les extraire d'abord. C'est le motif « deux façons de juger un même
  plan » qui a coûté cher pendant l'audit du 2026-08-08 ;
- **traduire la liste en demande de biens** (« 3 boulangeries » → « 24 pains/min ») : zéro
  changement moteur, mais le lien se rompt — le moteur peut décider de 2 ou 4 copies selon ses
  arrondis, et l'utilisateur n'obtient pas ce qu'il a demandé.

## Contrat moteur

```ts
IslandPlanRequest.wanted?: {
  /** Ateliers demandés, dans l'ORDRE DE PRIORITÉ. */
  workshops?: { defId: string; count: number }[];
  /** Préférence par type d'emplacement : "mountain" | "river" | "marsh" → defId. */
  slots?: Record<string, string>;
};
```

**Ateliers.** `wanted.workshops` amorce la file de `planLocalProduction`, dépilée avant les
biens du manifeste. La file épuisée, le moteur enchaîne sur son choix automatique avec le
budget restant, en posant les intrants comme il le fait déjà.

**Emplacements.** `wanted.slots` est consulté par `planSlots` avant son choix par défaut, et
**ne peut que restreindre** : un bâtiment d'un autre monde, ou dont la fertilité manque sur
l'île, reste écarté. Une préférence infaisable n'est pas une erreur — elle est ignorée et
signalée.

**Retour.** Une ligne par vœu non tenu dans `gaps`, avec la cause exacte :
`Boulangerie : 2 posées sur 3 — main-d'œuvre Plébéiens insuffisante`. Le grand-livre connaît
déjà la raison du refus (`quote()` rend `null`) et le budget d'attributs aussi ; il s'agit de
propager cette information au lieu de la perdre.

**Conséquence assumée.** Une demande servie AVANT le manifeste déplace le plan : les ateliers
que le moteur aurait choisis seuls ne seront peut-être plus finançables, et **le plan livré peut
loger moins de monde qu'avec l'option décochée**. C'est l'effet recherché, mais il doit être
affiché, sinon il se lira comme une régression.

## Interface

Un panneau repliable sous « Produire sur l'île », actif seulement quand la case est cochée.

**Ateliers.** Champ de recherche sur les bâtiments de production, filtré par le monde de l'île
et par les fertilités déclarées du profil (`effProfile.fertilities`, déjà disponible dans le
panneau). Chaque ligne retenue affiche son nom, son bien produit et un compteur. La liste garde
l'**ordre d'ajout**, et cet ordre EST la priorité que le moteur suit quand le budget se ferme.
Retrait et réordonnancement possibles.

**Emplacements.** Une ligne par type de slot réellement présent sur l'île — montagne, rivière,
marais — avec un menu des bâtiments possibles pour ce type, fertilités respectées, et « au choix
du moteur » par défaut. Trois lignes au maximum, souvent une ou deux.

**Résultat.** Deux affichages :

- l'état des vœux — `Vœux : 5 posés sur 7` — avec les manquants et leur raison ;
- un avertissement en clair : une liste de vœux peut faire BAISSER la population, puisqu'elle
  est servie avant le choix automatique. Le plan alternatif n'est pas calculé pour comparer :
  cela doublerait le temps de calcul pour un chiffre qu'on obtient en décochant l'option.

La liste vit dans l'état React du panneau. Pas de persistance disque — YAGNI.

## Vérification

Quatre tests unitaires, sur les moteurs et non sur l'interface :

1. demande réalisable → exactement N copies posées, et **avant** les ateliers du manifeste ;
2. demande infaisable → moins de copies, un `gap` nommant le bâtiment et la cause, aucune
   exception levée ;
3. préférence de slot honorée quand la fertilité est présente, ignorée **et signalée** sinon ;
4. option absente → plan strictement identique à aujourd'hui (non-régression).

Le filet d'invariants existant (`invariants.test.ts`) couvre le reste : une liste de vœux ne
doit introduire aucune violation de gravité `faute`.

## Implémenté le 2026-08-09

Conforme au design, sans écart. Points d'entrée réels :

- `LocalProdOptions.requested` — la file de `planLocalProduction` accueille des entrées
  `{ good, perMin, defId?, copies?, wish? }`. Un vœu impose son `defId` et son nombre de
  copies ; une entrée de manifeste les déduit du débit comme avant. Tout ce qui suit — devis,
  budget, pose, recul — les traite pareil.
- `SlotPlanOptions.slotPrefs` — consulté par `pickSlotBuilding` APRÈS ses filtres, jamais avant :
  une préférence ne rouvre pas une porte que le monde, le gisement ou la main-d'œuvre ont
  fermée.
- `IslandPlanRequest.wanted` — assemble les deux et les passe aux moteurs.

**La cause de l'arrêt est désormais propagée.** Elle existait à chaque point de sortie de la
boucle de pose et se perdait : quota de bâtiments, plus de place, main-d'œuvre insuffisante,
budget d'un attribut nommé. Un vœu partiellement servi rend
`Boulangerie : 2 posé(s) sur 3 demandé(s) — main-d'œuvre insuffisante`.

**Cinq tests** (`wanted.test.ts`) : demande réalisable posée à l'identique ET en tête de liste ;
demande déraisonnable servie en partie avec sa cause ; préférence infaisable ignorée ;
préférence réalisable retenue ; plan strictement identique sans liste de vœux.

**Interface** : panneau conditionné à « Produire sur l'île ». Les ateliers proposés sont filtrés
par monde ET par productibilité réelle d'après les fertilités déclarées — on ne propose pas ce
que le moteur écarterait. Les lignes d'emplacement n'apparaissent que pour les types présents
sur l'île, et seulement si « Exploiter les emplacements » est coché.

## Hors périmètre

- Le choix emplacement par emplacement, qui demanderait un sélecteur cartographique.
- Le mode Production (`prodPlan`), qui a son propre moteur et sa propre forme de sortie.
- La persistance de la liste entre deux sessions.
