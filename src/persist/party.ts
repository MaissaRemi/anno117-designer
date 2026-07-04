import type { ResourceProfile } from "../economy/resources";

// Config de PARTIE (îles + profils de ressources) — clé PROPRE, indépendante du layout (v8).
const KEY = "anno117-designer:party:v1";

export interface PartyState {
  partyIslands: string[];
  islandProfiles: Record<string, ResourceProfile>;
}

export const emptyParty = (): PartyState => ({ partyIslands: [], islandProfiles: {} });

/** Normalise une valeur brute en PartyState valide (défauts si champs manquants/invalides). */
export function normalizeParty(data: unknown): PartyState {
  const p = (data ?? {}) as Partial<PartyState>;
  return {
    partyIslands: Array.isArray(p.partyIslands) ? p.partyIslands : [],
    islandProfiles: p.islandProfiles && typeof p.islandProfiles === "object" && !Array.isArray(p.islandProfiles)
      ? (p.islandProfiles as Record<string, ResourceProfile>)
      : {},
  };
}

export function loadParty(): PartyState {
  try {
    return normalizeParty(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return emptyParty();
  }
}

export function saveParty(p: PartyState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* quota/mode privé : ignore */
  }
}
