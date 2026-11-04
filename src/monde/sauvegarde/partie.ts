import { economy } from "../../economy/economy";
import { islandById } from "../../data/islands";
import { CRANS, nouvelleConfiguration, nouvelId, type ConfigurationMonde, type Cran, type IleDuMonde, type Propriete } from "../configuration";
import { extraireRda, fichierDeSauvegarde, lireIndexRda } from "./rda";
import { attribut, attributs, chemin, enfant, enfants, entier, entier64Texte, entiers32, filtreChemins, lireFileDb, texteUtf16, type NoeudFileDb } from "./filedb";

/**
 * IMPORT D'UNE SAUVEGARDE `.a8s` — les îles de la partie, leurs fertilités, leur propriétaire.
 *
 * Structure lue dans les sauvegardes de Rémi (Maximilia Maxima, 04/11/2026) :
 * - archive RDA → `data.a7s`, flux zlib → FileDB ;
 * - `MetaGameManager/GameSessions/#1` : une entrée par province, sa `SessionData@BinaryData`
 *   est elle-même un FileDB ;
 * - dans une province, `GameSessionManager/MapTemplate/TemplateElement/Element` : une île par
 *   élément, son fichier (`MapFilePath`, dont le nom est l'id de notre catalogue), sa rotation
 *   (`Rotation90`, quarts de tour), sa position et ses fertilités tirées
 *   (`FertilitiesPerAreaIndex`) ;
 * - `GameSessionManager/AreaInfo` : une zone par île, clés dans `@#8000`. L'id d'une zone vaut
 *   `(129 + rang de l'élément) × 64 + n° de session` ; elle porte `@OwnerProfile` (absent :
 *   personne) et ses fertilités actuelles (`Fertility@#8000`).
 *
 * Propriétaires, GUIDs lus dans assets.xml : 41 = `Profile_Human_00`, le joueur qui a créé la
 * partie ; 31099, 31101… = rivaux ; les comptoirs tiers et les îles décoratives ne sont pas dans
 * notre catalogue et sont ignorés.
 */

export const PROFIL_JOUEUR = 41;

/** Les profils humains d'une partie (assets.xml : `Profile_Human_00` à `_03`). */
export const PROFILS_HUMAINS: ReadonlyMap<number, string> = new Map([
  [41, "Joueur 1"], [600069, "Joueur 2"], [600070, "Joueur 3"], [42, "Joueur 4"],
]);

/** Les joueurs humains qui possèdent des îles : plus d'un, la partie est à plusieurs et il faut
 *  savoir lequel est l'utilisateur. */
export function joueursDeLaPartie(p: PartieLue): { guid: number; libelle: string; iles: number }[] {
  const n = new Map<number, number>();
  for (const i of p.iles) if (i.proprietaire !== undefined && PROFILS_HUMAINS.has(i.proprietaire)) n.set(i.proprietaire, (n.get(i.proprietaire) ?? 0) + 1);
  return [...n].map(([guid, iles]) => ({ guid, libelle: PROFILS_HUMAINS.get(guid)!, iles }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle));
}

export interface IleLue {
  ileId: string;
  /** Quarts de tour, tels que la sauvegarde les donne (sens non vérifié en jeu). */
  rotation: number;
  /** Position sur la carte de la province, en cases. */
  position: { x: number; y: number };
  fertilites: string[];
  /** GUID du profil propriétaire ; absent : personne. */
  proprietaire?: number;
  /** Emplacements (`ObjectId`) que le générateur de carte n'a pas activés : absents de la partie. */
  emplacementsInactifs: string[];
}

export interface PartieLue {
  iles: IleLue[];
  /** Réglages de la partie (`gamesetup.a7s`), quand ils sont lus. */
  reglages?: { consommation: Cran; entretien: Cran };
  /** Îles de la sauvegarde absentes de notre catalogue (hors comptoirs tiers et décors). */
  inconnues: string[];
}

const nomDeFichier = (p: string) => p.replace(/\\/g, "/").split("/").pop()!.replace(/\.a7m$/i, "");
const tiersOuDecor = (id: string) => /_3rdparty_|_deco_/.test(id);

/** Les îles d'une province, depuis le FileDB de sa session. */
export function ilesDeLaSession(session: NoeudFileDb, numeroSession: number): { iles: IleLue[]; inconnues: string[] } {
  const gm = enfant(session, "GameSessionManager");
  const elements = enfants(enfant(gm, "MapTemplate"), "TemplateElement").map((te) => enfant(te, "Element"));

  // zones : id → propriétaire et fertilités actuelles
  const info = enfant(gm, "AreaInfo");
  const zones = new Map<number, { proprietaire?: number; fertilites: number[] }>();
  const cles = attributs(info, "#8000");
  enfants(info, "#1").forEach((z, k) => {
    const id = entier(cles[k]);
    if (id === undefined) return;
    zones.set(id, {
      proprietaire: entier(attribut(z, "OwnerProfile")),
      fertilites: attributs(enfant(z, "Fertility"), "#8000").map((f) => entier(f)!).filter((f) => f !== undefined),
    });
  });

  const iles: IleLue[] = [];
  const inconnues: string[] = [];
  elements.forEach((el, rang) => {
    const fichier = texteUtf16(attribut(el, "MapFilePath"));
    if (!el || !fichier) return;
    const ileId = nomDeFichier(fichier);
    if (!islandById(ileId)) {
      if (!tiersOuDecor(ileId)) inconnues.push(ileId);
      return;
    }
    const [x = 0, y = 0] = entiers32(attribut(el, "Position"));
    // fertilités tirées à la création : `#8000` alterne n° de zone de l'île et liste de GUIDs
    const tirees = attributs(enfant(el, "FertilitiesPerAreaIndex"), "#8000").filter((_, i) => i % 2 === 1).flatMap(entiers32);
    const zone = zones.get((129 + rang) * 64 + numeroSession);
    const guids = zone?.fertilites.length ? zone.fertilites : tirees;
    // `MineSlotActivation` alterne ObjectId (64 bits) et booléen d'activation
    const activ = attributs(enfant(el, "MineSlotActivation"), "#8000");
    const emplacementsInactifs: string[] = [];
    for (let k = 0; k + 1 < activ.length; k += 2) {
      const id = entier64Texte(activ[k]);
      if (id && !entier(activ[k + 1])) emplacementsInactifs.push(id);
    }
    iles.push({
      ileId,
      rotation: ((entier(attribut(el, "Rotation90")) ?? 0) % 4 + 4) % 4,
      position: { x, y },
      fertilites: [...new Set(guids.map(String))].filter((g) => g in economy.fertilities),
      emplacementsInactifs,
      ...(zone?.proprietaire !== undefined ? { proprietaire: zone.proprietaire } : {}),
    });
  });
  return { iles, inconnues };
}

/**
 * Réglages de la partie qui changent l'économie, dans `GameSetupManager/Setup…/value@id`. Les
 * numéros de cran viennent de `datasets.xml` : DCNeedConsumption et DCMaintenance, Low 0,
 * Medium 1, High 2. Les impôts (`SetupTaxes`, `LandTaxFactor` ×1 / ×1,5 / ×2) ne sont PAS lus :
 * leur effet sur l'argent des maisons n'est pas établi.
 */
export function reglagesDeLaPartie(racine: NoeudFileDb): { consommation: Cran; entretien: Cran } | undefined {
  const gm = enfant(racine, "GameSetupManager");
  const cran = (nom: string) => {
    const id = entier(attribut(chemin(gm, nom, "value"), "id"));
    return id !== undefined && id >= 0 && id <= 2 ? CRANS[id] : undefined;
  };
  const consommation = cran("SetupNeedConsumption"), entretien = cran("SetupMaintenance");
  return consommation && entretien ? { consommation, entretien } : undefined;
}

/** Lit une sauvegarde `.a8s` entière. */
export async function lirePartie(sauvegarde: Uint8Array): Promise<PartieLue> {
  const index = await lireIndexRda(sauvegarde);
  const f = index.find((x) => x.chemin.replace(/\\/g, "/").split("/").pop() === "data.a7s");
  if (!f) throw new Error("Sauvegarde sans data.a7s");
  const data = await fichierDeSauvegarde(await extraireRda(sauvegarde, f));
  const racine = lireFileDb(data, filtreChemins(
    ["MetaGameManager", "GameSessions", "*", "SessionData"],
    ["MetaGameManager", "GameSessions", "*", "SessionDesc"],
  ));
  const out: PartieLue = { iles: [], inconnues: [] };
  for (const s of enfants(chemin(racine, "MetaGameManager", "GameSessions"), "#1")) {
    const binaire = attribut(enfant(s, "SessionData"), "BinaryData");
    if (!binaire) continue;
    const numero = entier(attribut(enfant(s, "SessionDesc"), "SessionID")) ?? 0;
    const session = lireFileDb(binaire, filtreChemins(
      ["GameSessionManager", "MapTemplate", "TemplateElement", "Element"],
      ["GameSessionManager", "AreaInfo", "*", "Fertility"],
    ));
    const r = ilesDeLaSession(session, numero);
    out.iles.push(...r.iles);
    out.inconnues.push(...r.inconnues);
  }
  if (!out.iles.length) throw new Error("Aucune île reconnue dans cette sauvegarde");
  const setup = index.find((x) => x.chemin.replace(/\\/g, "/").split("/").pop() === "gamesetup.a7s");
  if (setup) {
    const r = reglagesDeLaPartie(lireFileDb(await fichierDeSauvegarde(await extraireRda(sauvegarde, setup))));
    if (r) out.reglages = r;
  }
  return out;
}

/**
 * La configuration d'un monde tirée d'une partie lue : îles, fertilités, propriétaires. `moi` :
 * le profil de l'utilisateur (le joueur 1 par défaut). Une île sans propriétaire est
 * « achetable » ; celle d'un rival ou d'un autre joueur, « adversaire ».
 */
export function configurationDepuisPartie(nom: string, p: PartieLue, moi = PROFIL_JOUEUR): ConfigurationMonde {
  const proprieteDe = (x: number | undefined): Propriete => (x === undefined ? "achetable" : x === moi ? "moi" : "indisponible");
  const c = nouvelleConfiguration(nom);
  if (p.reglages) c.reglages = { ...c.reglages, ...p.reglages };
  c.iles = p.iles.map((i): IleDuMonde => ({
    cle: nouvelId("ile"),
    ileId: i.ileId,
    propriete: proprieteDe(i.proprietaire),
    fertilites: i.fertilites,
    role: "auto",
    rotation: i.rotation,
    position: i.position,
    ...(i.emplacementsInactifs.length ? { emplacementsInactifs: i.emplacementsInactifs } : {}),
  }));
  return c;
}
