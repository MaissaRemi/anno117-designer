import { economy, tierByGuid, worldOf, type Tier } from "./economy";

/**
 * MAIN-D'ŒUVRE — le pool d'ouvriers d'une île.
 *
 * Mécanique du jeu (extraite des archives, cf. GAME_MECHANICS.md §5 bis) :
 *
 * - Chaque palier de population fournit UN bien de main-d'œuvre qui lui est propre
 *   (`PopulationLevel/ConnectedWorkforce`), en quantité `habitants × facteur`. Le facteur
 *   décroît avec le palier : 0,5 au premier, puis 0,3 · 0,2 · 0,1.
 * - Ces biens portent `IsWorkforce=1` et `StorageLevel=Area` : le pool est PAR ÎLE. Rien ne
 *   circule entre îles — `WorkforceTransferConfig` ne décrit que l'animation des dockers.
 * - Un atelier réclame la main-d'œuvre d'UN palier précis. Vérifié sur les 151 bâtiments
 *   extraits : aucun n'en réclame deux. La contrainte est donc un simple système
 *   d'inégalités, une par palier.
 * - **Aucune substitution.** Un palier supérieur ne remplace jamais un palier inférieur :
 *   une île de Patriciens purs ne fait tourner AUCUN atelier réclamant des Plébéiens. Seuls
 *   des objets de spécialiste peuvent déplacer un bâtiment vers le haut, et ils sortent du
 *   cadre d'un plan.
 * - Une part de main-d'œuvre est OFFERTE par le comptoir, sans aucune maison.
 *
 * Ce module est pur : ni géométrie, ni placement.
 */

/** Réglage de difficulté de la partie — le comptoir n'offre pas autant dans les trois. */
export type Difficulty = "plenty" | "medium" | "spare";

/** Bien de main-d'œuvre → palier qui le fournit. */
const tierOfGood = new Map<string, Tier>();
for (const t of economy.tiers) if (t.workforce) tierOfGood.set(t.workforce, t);

/**
 * Main-d'œuvre NETTE offerte par un bâtiment, par palier. Le comptoir en offre ET en
 * consomme : le net n'est pas monotone en niveau (25 net au niveau 1, 27 au niveau 2 qui
 * offre 35 mais en prélève 8, 38 au niveau 3). On rend donc le net, pas le brut.
 */
export function workforceGrant(
  defId: string | undefined,
  difficulty: Difficulty = "medium",
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!defId) return out;
  const grant = economy.workforceGrants?.[defId];
  if (!grant) return out;
  for (const [good, amounts] of Object.entries(grant)) {
    const tier = tierOfGood.get(good);
    if (!tier) continue;
    const gross = amounts[difficulty] ?? amounts.medium ?? 0;
    const net = gross - (amounts.cost ?? 0);
    if (net) out[tier.guid] = (out[tier.guid] ?? 0) + net;
  }
  return out;
}

/** Main-d'œuvre réclamée par un ensemble de bâtiments posés, par palier. */
export function workforceDemand(defIds: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of defIds) {
    for (const w of economy.buildingWorkforce[id] ?? []) {
      out[w.tier] = (out[w.tier] ?? 0) + w.amount;
    }
  }
  return out;
}

/** Ce qui manque, palier par palier. Vide = l'île peut faire tourner tout ce qu'elle a posé. */
export function workforceDeficit(
  demand: Record<string, number>,
  supply: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [guid, d] of Object.entries(demand)) {
    const miss = d - (supply[guid] ?? 0);
    if (miss > 1e-6) out[guid] = miss;
  }
  return out;
}

/**
 * Paliers dont la main-d'œuvre est HORS DU MONDE de l'île.
 *
 * Un atelier romain posé sur une île d'Albion réclame des Plébéiens, qui n'y existent pas :
 * aucune conversion ne peut le satisfaire. C'est le symptôme du repli inter-monde de
 * `pickProducer` — le vrai correctif est en amont (`pickProducerInWorld`), mais la cascade
 * doit savoir reconnaître une demande impossible plutôt que de boucler dessus.
 */
export function alienDemand(
  demand: Record<string, number>,
  world: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [guid, d] of Object.entries(demand)) {
    const t = tierByGuid(guid);
    if (!t || worldOf(t.region) !== world) out[guid] = d;
  }
  return out;
}

