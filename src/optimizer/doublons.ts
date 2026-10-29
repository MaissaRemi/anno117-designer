/**
 * ═══ COPIES EN TROP D'UN MÊME SERVICE ══════════════════════════════════════════════════
 *
 * Une maison est couverte par un TYPE de service, pas par une copie : la seconde copie qui la
 * voit ne lui apporte rien (l'évaluateur de palier ne lit qu'un booléen par type). Une copie
 * dont toutes les maisons sont aussi vues par une autre copie est donc retirable sans rien
 * changer au palier d'aucune maison — elle ne coûte que son emprise et son entretien.
 *
 * `vues[k]` : indices des maisons couvertes par la copie `k`. Renvoie les copies retirables,
 * la moins utile d'abord (retrait glouton : retirer une copie peut rendre une voisine
 * indispensable, d'où le décompte tenu à jour). Le type garde toujours au moins une copie.
 */
export function copiesEnTrop(vues: readonly (readonly number[])[], nbMaisons: number): number[] {
  if (vues.length <= 1) return [];
  const nb = new Int32Array(nbMaisons);
  for (const v of vues) for (const i of v) nb[i]++;
  const ordre = vues.map((_, k) => k).sort((a, b) => vues[a].length - vues[b].length || a - b);
  const retirees: number[] = [];
  let restantes = vues.length;
  for (const k of ordre) {
    if (restantes <= 1) break;
    if (!vues[k].every((i) => nb[i] >= 2)) continue;
    for (const i of vues[k]) nb[i]--;
    retirees.push(k);
    restantes--;
  }
  return retirees;
}
