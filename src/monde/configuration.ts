import { islandById, regionOfIsland, type WorldRegion } from "../data/islands";
import { economy, tierByGuid, worldOf } from "../economy/economy";
import { dieuParId } from "../economy/dieux";
import type { RoadType } from "../engine/roads";
import type { ResultatMonde } from "./calcul";

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
  /** Île principale : palier visé (GUID). Absent : le plus haut de sa province (`palierParDefaut`). */
  palier?: string;
  /** Dieu tutélaire de l'île (`Patron.id`). */
  dieu?: string;
  /** Rotation dans la partie, en quarts de tour (lue dans une sauvegarde). */
  rotation?: number;
  /** Position sur la carte de sa province, en cases (lue dans une sauvegarde). */
  position?: { x: number; y: number };
  /**
   * Emplacements (montagne, rivière, marais) que le générateur de carte n'a pas activés dans la
   * partie, par `ObjectId` (lus dans une sauvegarde) : retirés de l'île pour le calcul — ni mine,
   * ni source d'aqueduc. Absent : tous présents.
   */
  emplacementsInactifs?: string[];
}

/** Ce que maximisent les îles principales. */
export type ObjectifPrincipale = "argent" | "habitants" | "maisons";
export const LIBELLES_OBJECTIF: Record<ObjectifPrincipale, string> = {
  argent: "Le maximum de gains", habitants: "Le maximum d'habitants", maisons: "Le maximum de maisons",
};

export interface ReglagesMonde {
  objectif: ObjectifPrincipale;
  routes: RoadType;
  /** Productivité de la recherche et des objets, en points, pour tous les ateliers. */
  productiviteGlobale: number;
}
export const reglagesParDefaut = (): ReglagesMonde => ({ objectif: "argent", routes: "pavee", productiviteGlobale: 0 });

export interface ConfigurationMonde {
  version: 1;
  id: string;
  nom: string;
  creeLe: string;
  modifieLe: string;
  iles: IleDuMonde[];
  reglages: ReglagesMonde;
  /** Dernier calcul. Il décrit la configuration telle qu'elle était à `resultat.calculeLe`. */
  resultat?: ResultatMonde;
}

/** Paliers résidentiels d'une province, du plus dense au moins dense. */
export const paliersDeLaProvince = (province: string) =>
  economy.tiers.filter((t) => t.residenceId && worldOf(t.region) === worldOf(province))
    .sort((a, b) => b.capacityDefault - a.capacityDefault);
export const palierParDefaut = (province: string): string => paliersDeLaProvince(province)[0]?.guid ?? "";

let compteur = 0;
/** Identifiant court, unique dans la session (horodatage + compteur). */
export const nouvelId = (prefixe: string): string =>
  `${prefixe}_${Date.now().toString(36)}_${(++compteur).toString(36)}`;

export function nouvelleConfiguration(nom: string, maintenant = new Date()): ConfigurationMonde {
  const t = maintenant.toISOString();
  // le nom peut être vide le temps de l'assistant ; la normalisation lui donne un défaut
  return { version: 1, id: nouvelId("monde"), nom: nom.trim(), creeLe: t, modifieLe: t, iles: [], reglages: reglagesParDefaut() };
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
const positionValide = (p: unknown): p is { x: number; y: number } =>
  !!p && typeof p === "object" && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { y: unknown }).y);

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
      ...(estChaine(r.palier) && worldOf(tierByGuid(r.palier)?.region ?? "") === worldOf(regionOfIsland(r.ileId)) && tierByGuid(r.palier)?.residenceId
        ? { palier: r.palier } : {}),
      ...(estChaine(r.dieu) && dieuParId(r.dieu) ? { dieu: r.dieu } : {}),
      ...(Number.isInteger(r.rotation) ? { rotation: (((r.rotation as number) % 4) + 4) % 4 } : {}),
      ...(positionValide(r.position) ? { position: { x: r.position.x, y: r.position.y } } : {}),
      ...(Array.isArray(r.emplacementsInactifs) && r.emplacementsInactifs.some(estChaine)
        ? { emplacementsInactifs: [...new Set(r.emplacementsInactifs.filter(estChaine))] } : {}),
    });
  }
  const g = (c.reglages && typeof c.reglages === "object" ? c.reglages : {}) as Record<string, unknown>;
  const defaut = reglagesParDefaut();
  const reglages: ReglagesMonde = {
    objectif: g.objectif === "habitants" || g.objectif === "maisons" || g.objectif === "argent" ? g.objectif : defaut.objectif,
    routes: g.routes === "terre" || g.routes === "pavee" || g.routes === "marbre" ? g.routes : defaut.routes,
    productiviteGlobale: typeof g.productiviteGlobale === "number" && Number.isFinite(g.productiviteGlobale)
      ? Math.max(-90, Math.min(500, g.productiviteGlobale)) : 0,
  };
  // le résultat d'un calcul n'est gardé que s'il a sa forme : un fichier abîmé ne doit pas
  // faire tomber l'écran qui l'affiche
  const res = c.resultat as Partial<ResultatMonde> | undefined;
  const resultat = res && typeof res === "object" && Array.isArray(res.iles) && Array.isArray(res.flux)
    && Array.isArray(res.deficits) && res.bilan && typeof res.bilan === "object" ? (res as ResultatMonde) : undefined;
  return {
    version: 1,
    id: c.id,
    nom: estChaine(c.nom) && c.nom.trim() ? c.nom.trim() : "Sans nom",
    creeLe: estChaine(c.creeLe) ? c.creeLe : maintenant,
    modifieLe: estChaine(c.modifieLe) ? c.modifieLe : maintenant,
    iles,
    reglages,
    ...(resultat ? { resultat } : {}),
  };
}
