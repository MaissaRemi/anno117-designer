import { islandById, regionOfIsland, type WorldRegion } from "../data/islands";
import { economy } from "../economy/economy";

/**
 * ═══ CONFIGURATION D'UN MONDE ═════════════════════════════════════════════════════════
 *
 * Planification globale (`docs/superpowers/specs/2026-10-30-planification-globale-design.md`).
 * Une configuration décrit une partie : les îles de la carte, des deux provinces à la fois
 * (les besoins complets d'un monde traversent de l'une à l'autre), leurs fertilités et à qui
 * elles sont. Le moteur s'en servira pour répartir population et production.
 *
 * Ce module ne fait que DÉCRIRE et VALIDER. Une configuration vient d'IndexedDB ou d'un fichier
 * importé : `normaliserConfiguration` est la frontière, rien n'entre sans y passer.
 */

/** À qui est l'île. Une île non possédée est « inconnue » tant que le joueur n'a rien dit. */
export type Propriete = "moi" | "achetable" | "indisponible" | "inconnue";
export const PROPRIETES: readonly Propriete[] = ["moi", "achetable", "indisponible", "inconnue"];
export const LIBELLES_PROPRIETE: Record<Propriete, string> = {
  moi: "À moi", achetable: "Achetable", indisponible: "Adversaire", inconnue: "Inconnue",
};

/** Rôle voulu par le joueur ; « auto » laisse le moteur décider (production, pour une île à lui). */
export type RoleIle = "principale" | "production" | "auto";
export const ROLES: readonly RoleIle[] = ["principale", "production", "auto"];

export interface IleDuMonde {
  /** Clé unique dans la configuration : une même île du catalogue peut figurer deux fois. */
  cle: string;
  /** Id du catalogue (`roman_island_large_03`…). */
  ileId: string;
  /** Le nom de l'île dans la partie, pour s'y retrouver. */
  libelle?: string;
  propriete: Propriete;
  /** Fertilités et gisements (GUIDs). `null` : inconnues. */
  fertilites: string[] | null;
  role: RoleIle;
}

export interface ConfigurationMonde {
  version: 1;
  id: string;
  nom: string;
  creeLe: string;
  modifieLe: string;
  iles: IleDuMonde[];
}

let compteur = 0;
/** Identifiant court, unique dans la session (horodatage + compteur). */
export const nouvelId = (prefixe: string): string =>
  `${prefixe}_${Date.now().toString(36)}_${(++compteur).toString(36)}`;

export function nouvelleConfiguration(nom: string, maintenant = new Date()): ConfigurationMonde {
  const t = maintenant.toISOString();
  // le nom peut être vide le temps de l'assistant ; la normalisation lui donne un défaut
  return { version: 1, id: nouvelId("monde"), nom: nom.trim(), creeLe: t, modifieLe: t, iles: [] };
}

export function nouvelleIle(ileId: string): IleDuMonde {
  return { cle: nouvelId("ile"), ileId, propriete: "inconnue", fertilites: [], role: "auto" };
}

/** Province d'une île de la configuration. */
export const provinceDe = (ile: Pick<IleDuMonde, "ileId">): WorldRegion => regionOfIsland(ile.ileId);

const estChaine = (v: unknown): v is string => typeof v === "string";

/**
 * Configuration valide, ou `null`. Les champs inconnus sont écartés, les valeurs hors domaine
 * ramenées à leur défaut, les îles absentes du catalogue et les fertilités inconnues retirées :
 * une configuration enregistrée avant une mise à jour des données reste lisible.
 */
export function normaliserConfiguration(brut: unknown): ConfigurationMonde | null {
  if (!brut || typeof brut !== "object") return null;
  const c = brut as Record<string, unknown>;
  if (!estChaine(c.id) || !c.id) return null;
  const maintenant = new Date().toISOString();
  const cles = new Set<string>();
  const iles: IleDuMonde[] = [];
  for (const i of Array.isArray(c.iles) ? c.iles : []) {
    if (!i || typeof i !== "object") continue;
    const r = i as Record<string, unknown>;
    if (!estChaine(r.ileId) || !islandById(r.ileId)) continue;
    let cle = estChaine(r.cle) && r.cle ? r.cle : nouvelId("ile");
    if (cles.has(cle)) cle = nouvelId("ile");
    cles.add(cle);
    const fertilites = r.fertilites === null ? null
      : (Array.isArray(r.fertilites) ? r.fertilites : []).filter((f): f is string => estChaine(f) && f in economy.fertilities);
    iles.push({
      cle,
      ileId: r.ileId,
      ...(estChaine(r.libelle) && r.libelle.trim() ? { libelle: r.libelle.trim() } : {}),
      propriete: PROPRIETES.includes(r.propriete as Propriete) ? (r.propriete as Propriete) : "inconnue",
      fertilites: fertilites === null ? null : [...new Set(fertilites)],
      role: ROLES.includes(r.role as RoleIle) ? (r.role as RoleIle) : "auto",
    });
  }
  return {
    version: 1,
    id: c.id,
    nom: estChaine(c.nom) && c.nom.trim() ? c.nom.trim() : "Sans nom",
    creeLe: estChaine(c.creeLe) ? c.creeLe : maintenant,
    modifieLe: estChaine(c.modifieLe) ? c.modifieLe : maintenant,
    iles,
  };
}
