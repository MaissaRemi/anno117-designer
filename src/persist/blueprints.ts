/**
 * Bibliothèque locale de blueprints. On enregistre la COMMANDE (bâtiment cible, nombre,
 * intrants coupés), pas le plan calculé : le placeur étant déterministe, rejouer la
 * commande rend exactement le même plan, et un plan périmé ne peut donc pas survivre à une
 * amélioration du moteur.
 */

const KEY = "anno117-designer:blueprints:v1";

export interface SavedBlueprint {
  name: string;
  targetDefId: string;
  count: number;
  /** GUID des biens marqués importés. */
  imported: string[];
}

export function listBlueprints(): SavedBlueprint[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedBlueprint[]) : [];
  } catch {
    return []; // contenu corrompu ou stockage indisponible : la bibliothèque est vide
  }
}

function write(list: SavedBlueprint[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota plein / mode privé : on ignore, comme `saveState`
  }
}

export function saveBlueprint(bp: SavedBlueprint): void {
  write([...listBlueprints().filter((b) => b.name !== bp.name), bp]);
}

export function deleteBlueprint(name: string): void {
  write(listBlueprints().filter((b) => b.name !== name));
}
