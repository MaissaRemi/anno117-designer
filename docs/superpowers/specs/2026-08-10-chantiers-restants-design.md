# Chantiers restants : ce qui se corrige, et ce qui se réfute

Date : 2026-08-10. Fait suite à la levée de la falaise du verdict (`f189ee9`), qui a fait passer
les 55 îles de 1 129 131 à 1 248 802 habitants. Ce document arbitre les chantiers ouverts de
`docs/ETAT-ET-SUITE.md` §3.2 à §3.6, plus la voie de fond de §3.1.

**Le point de méthode qui commande tout le reste** : les chiffres qui motivaient ces chantiers
ont été mesurés dans le régime BRIDÉ, quand toutes les grandes îles romaines s'effondraient au
palier Plébéiens. Le sur-provisionnement de services (« 3 113 services pour 532 maisons » sur la
continentale) décrivait un plan à 7 186 habitants ; la même île en livre aujourd'hui 19 486.
Aucun de ces chantiers ne peut être instruit sur ses chiffres d'origine.

---

## 1. Réfuté : rejouer la sélection de viabilité après les passes tardives

`ETAT-ET-SUITE.md` §3.1 désignait cette voie comme « la bonne », la falaise n'étant que « la
rapide ». **Son arithmétique la réfute, et elle est écrite deux paragraphes plus haut dans le
même document.**

Le déficit qui déclenchait la falaise est DIFFUS : −0,034 par maison sur 625 maisons. Pour
qu'un razage ramène le total à zéro, il faut retirer plus de six cents maisons — un tiers de
l'île — puisque chaque maison retirée ne rend que sa propre contribution, 0,034. Rejouer
`viableSubset` après les passes tardives ne sauverait donc pas le plan : **il le détruirait**,
et raserait de surcroît quasi arbitrairement, toutes les maisons contribuant également.

`viableSubset` ne répare que les déficits CONCENTRÉS, où quelques maisons portent l'essentiel du
manque. C'est le cas pour lequel il a été écrit, et il continue de le traiter, au strict.

**Ce qui reste vrai** derrière la formulation de §3.1 : le modèle juge sur un TOTAL d'île. Une
poche locale en déficit, compensée ailleurs, est invisible — avant comme après le plancher. Ce
n'est pas un problème d'ORDRE des passes mais de GRANULARITÉ du bilan, et le corriger demande un
modèle d'attributs par zone, pas un réordonnancement. Chantier réel, hors périmètre ici.

## 2. Réfuté par l'enjeu : l'effet dominant de Vulcain

`ETAT-ET-SUITE.md` §3.3. Le blocage donnée est réel — le pool `50609` « Production All
Smelters » est vide dans cet export, vérifié deux fois au parseur — mais l'enjeu ne l'est pas :

- l'effet est **dominant**, donc nul en deçà de 7 000 de dévotion, quand le défaut est 0 ;
- il se greffe sur les **fonderies**, que l'optimiseur ne pose qu'au titre de la production
  locale, rarement et en petit nombre.

Identifier les fonderies par template ou par chaîne de production reste possible. Ça ne se
justifie pas tant que la dévotion par défaut vaut zéro.

---

## 3. Fait : l'extraction cesse de faire croire qu'un effet est vide

`ETAT-ET-SUITE.md` §3.4. `fx_buffs` ne lisait que `BuildingUpgrade/AdditionalAttributes`, si
bien que huit effets de patron sur vingt-quatre ressortaient avec `attrs: {}` — ce qui se lit
« cet effet ne fait rien ». Mesure au parseur XML :

| divinité | effet | contenu réel |
|---|---|---|
| Cérès, Cernunnos, Épona, Mars, Minerve, Neptune, Vulcain | premier effet local | `FactoryUpgrade/ProductivityUpgrade` = 1 |
| **Vulcain** | local `144804`, cible `31046` « All Residences » | `BuildingUpgrade/WorkforceModifierInPercent` = **5 %** |

Deux sections s'ajoutent donc à la lecture : `FactoryUpgrade` et `WorkforceModifierInPercent`.
Elles sortent dans `ResolvedEffect.factory` et `ResolvedEffect.workforcePct`, émises seulement
quand elles mordent.

**Correction à une affirmation du projet.** Il était écrit que « trois divinités seulement
touchent les résidences : Cérès, Cernunnos, Minerve ». C'est vrai des ATTRIBUTS, faux en
général : Vulcain vise lui aussi le pool `31046`, par la main-d'œuvre. Il ne loge toujours
personne — `patronResidenceAttrs` rend bien `{}` — mais la donnée ne le disait pas.

**Ce que ça ne change pas** : ni productivité ni main-d'œuvre n'est un attribut vital, et les
deux sont nuls à dévotion 0. Aucune sortie du moteur ne bouge. C'est un gain de vérité, pas de
population — et c'est la raison pour laquelle ce chantier passe avant les autres : il ne risque
rien.

Restent muets dix effets dominants (navires, troupes, stockage, déblocages) et le commerce
passif de Mercure, qui passe par un `AreaBuff` et non un `BuildingBuff`.

Verrouillé par `src/economy/patrons.test.ts`. Régénération vérifiée reproductible avant
modification : le diff du JSON ne touche que `patrons`.

---

## 4. À arbitrer par la mesure, pas par le document

Trois chantiers dépendent de faits qui ont changé sous eux. Une sonde sur les 55 îles les
établit dans le régime actuel avant toute écriture de code.

### 4.1 Services isolés du comptoir (§3.2)

Un service qu'aucune route rattachée au comptoir ne dessert est inactif en jeu. Aujourd'hui il
est détecté (`repair.stranded`), signalé, et exclu de la couverture AFFICHÉE — mais il reste
dans le plan, et sa couverture a déjà compté dans `placeHouses()`, qui tourne avant. Le mensonge
subsiste donc dans les habitants, comme il subsistait pour les services d'eau secs avant leur
correction (+3,6 % sur `small_06`).

**Ce que le document ne dit plus correctement** : `pruneRoads` a depuis reçu un ancrage sur la
racine du comptoir qui RESTITUE tout chemin nécessaire pour relier au réseau ce qu'il garde. Le
nombre de services réellement isolés devrait s'en trouver très réduit. La sonde le compte : si
le total est nul ou marginal, le réordonnancement du cœur du moteur que §3.2 réclame ne se
justifie pas.

### 4.2 Exploitations sans débouché (§3.5)

`r.exploited.filter((e) => !e.served)` — une mine sans entrepôt à portée de charrette coûte son
entretien et sa main-d'œuvre sans rien produire. Signalé par l'invariant
`exploitation-sans-entrepot`, jamais traité. La sonde en donne le compte réel par île.

### 4.3 Sur-provisionnement de services (§3.6)

Une tentative a été revertie, avec sa cause identifiée : compter les EMPLACEMENTS de maison dans
`diamondGain` sans convertir le seuil `2r²·0,25`, qui est une AIRE, rendait le seuil
inatteignable pour les grands rayons — plus aucun wonder, palier effondré, −30 % sur celtic.

Lecture du code : `minGain` et `diamondGain` sont aujourd'hui tous deux en cases de terre, donc
homogènes. Ce qui reste discutable est le BUDGET (`maxCopies`, `minGain`), dimensionné sur
`landCount` — la surface totale — alors qu'un service ne sert que des maisons. La sonde donne le
ratio services/maisons dans le régime actuel : c'est lui qui dira si le chantier a encore un
objet.

---

## 5. Robustesse du correctif de la falaise

Point soulevé par la revue adversariale, jamais mesuré : `BRUIT_VITAL = 0,05` ne couvre le pire
cas connu (−0,034 par maison) qu'avec une marge de ×1,47. Si une île livrée s'approche de 0,05,
le plancher est au bord et la falaise peut se rouvrir sans prévenir.

Une seconde sonde mesure, sur les 55 îles, le déficit vital par maison le plus profond parmi les
plans effectivement livrés. Deux issues :

- **marge confortable** (pire cas ≤ 0,04) : rien à faire, le chiffre est consigné et devient la
  référence à surveiller ;
- **marge mince** : le plancher doit cesser d'être une constante et se dériver de ce que le
  modèle peut produire comme bruit — sans jamais devenir une tolérance déguisée.

---

## Critère de livraison

Inchangé et non négociable : balayage complet des 55 îles, `viable` partout, aucune île en
baisse par rapport à l'état de `dev`. Toute variante réfutée est consignée avec ses chiffres.
