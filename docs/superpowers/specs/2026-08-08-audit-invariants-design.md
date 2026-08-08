# Audit du dépôt par invariants exécutables

Date : 2026-08-08. Périmètre : tout le dépôt. Classes retenues : justesse, modes d'échec
silencieux, trous de test, perf / code mort / lisibilité.

## Pourquoi cette forme

La session du jour a trouvé ses défauts les plus graves — villes romaines sur Albion, 31
bâtiments inactifs sur une île de 67 maisons, packPlan éliminé au premier critère faute de
garde-fou — **par la mesure, jamais par la lecture**. Trois diagnostics tenus de tête ont été
démentis par l'exécution avant que la vraie cause apparaisse.

L'audit suit donc la même discipline : on écrit ce qu'un plan doit respecter, on le fait
tourner largement, et ce qui casse devient un candidat à confirmer.

Effet de bord voulu : les invariants ne sont pas un rapport jetable, ce sont des **tests**.
Écrire l'audit, c'est combler les trous de test.

## Architecture

`src/optimizer/invariants.ts` — fonctions pures, sans I/O.

```ts
type Severity = "faute" | "suspect";
interface Violation { rule: string; severity: Severity; island: string; detail: string }
function checkPlan(r: IslandPlanResult, ctx: PlanContext): Violation[]
```

Chaque règle est nommée, indépendante, et rend zéro ou plusieurs violations. Aucune ne connaît
les autres. Le module ne lit ni fichier ni réseau : il reçoit un plan et son contexte.

Deux consommateurs :

1. **Filet permanent** — `invariants.test.ts`. Échantillon borné (≈6 îles × 2 configurations),
   échoue sur toute violation `faute`. Reste dans le dépôt, garde les corrections.
2. **Balayage d'audit** — `audit.sweep.test.ts`, **sauté sauf `AUDIT=1`**. Toutes les îles,
   plusieurs paliers, plusieurs jeux d'options. N'échoue pas : il imprime l'inventaire. Reste
   rejouable après chaque correction.

Deux consommateurs et non un, parce que le balayage complet coûte des dizaines de minutes :
inacceptable en suite, indispensable en audit.

## Catalogue

**Comptabilité interne.** `Σ tierCounts = houses` · `residents = Σ capByTier` · aucun uid rasé
encore présent dans `buildings` · nombre de résidences posées = `houses` · `viable` ⟺ les
quatre attributs vitaux ≥ 0 · `money.net = gross − upkeep`.

**Jouabilité en jeu.** Tout bâtiment appartient au monde de l'île · tout bâtiment est relié au
réseau routier enraciné au comptoir · aucune case occupée deux fois · toute emprise est sur de
la terre utilisable · toute résidence touche une route · le quota par `uniqueType` respecte les
permis · tout consommateur d'eau déclaré raccordé a un chemin d'aqueduc.

**Échecs silencieux.** Toute anomalie détectable est annoncée dans `gaps` (déficit de
main-d'œuvre, service sec, bâtiment isolé) · jamais `houses > 0` avec `residents = 0` ni
l'inverse · `feasible` implique des maisons et des habitants · une île peuplée réclame des
biens.

**Fidélité économique.** Le palier retenu est du monde de l'île · tout palier de `tierCounts`
appartient à la chaîne du palier cible · la capacité d'une maison ne dépasse jamais celle du
palier tous besoins remplis.

## Couverture d'exécution

| passe | étendue | plans | temps estimé |
|---|---|---|---|
| large | toutes les îles × palier sommet × sans options | ~55 | ~15 min |
| profonde | 8 îles représentatives × 3 paliers × {rien, emplacements + production} | ~48 | ~20 min |

La passe large cherche l'ÉTENDUE : une règle qui casse sur quarante îles est structurelle. La
profonde cherche les INTERACTIONS entre options, là où vivaient les défauts des ateliers.

## Zones sans invariant

`src/ui` (15 fichiers, 1 735 lignes, 0 test) et `tools/` (12 fichiers, 2 283 lignes, 0 test) ne
produisent pas de plan : aucun invariant ne peut y tourner. Relecture ciblée, cadrée par les
quatre mêmes classes, conclusions versées au même inventaire.

## Discipline de confirmation

Une règle qui se déclenche signale un **candidat**, pas un défaut : la règle peut être fausse.
Chaque candidat est confirmé en lisant le code avant d'entrer à l'inventaire. Ce qui n'est pas
confirmé en sort avec sa raison — comme le levier 2, réfuté après huit configurations mesurées.

## Sortie et suite

Inventaire groupé par règle : nombre d'îles touchées, deux exemples nommés, gravité, correction
proposée. Classé par gravité puis par étendue. Puis correction de haut en bas, une branche par
lot cohérent, chaque correction re-mesurée par le balayage qui l'a trouvée.

## Hors périmètre au premier tour

Les invariants sur le mode production (`prodPlan`) et sur le multi-îles. Ils ont leur propre
forme de sortie, et les ajouter maintenant triplerait le catalogue avant qu'on sache ce que le
premier rend. À rouvrir une fois l'inventaire du mode import traité.
