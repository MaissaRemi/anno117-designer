import type { BuildingDef } from "../model/types";
import type { DefLookup } from "../engine/rules";
import { economy, residentialChainExtended, tierByGuid, worldOf, goodName, type Tier } from "../economy/economy";
import { compileTierEvaluator } from "../economy/needsModel";
import { solve } from "../economy/solve";
import { workforceGrant } from "../economy/workforce";
import { institutionDefs, SHRINE_TYPE } from "../economy/attributes";
import { candidateRecipes } from "../optimizer/recipes";
import { pickKontorDef } from "../optimizer/kontor";
import { completeBasket } from "../prodlayout/complete";
import { normalizeBasket, type BasketLine } from "../prodlayout/basket";

/**
 * ═══ LA COMMANDE, ET CE QU'ELLE COÛTE EN BÂTIMENTS ════════════════════════════════════
 *
 * Étape 4 de la refonte (`docs/superpowers/plans/2026-10-26-refonte-moteur-ile.md`).
 *
 * Le moteur d'île historique ne prenait qu'un palier et décidait de tout le reste. Ici le
 * joueur COMMANDE — tant de maisons de tel palier, tels services, tels bâtiments de
 * production — et ce module rend la NOMENCLATURE : la liste exacte de ce qu'il faudra poser,
 * avec pour chaque ligne la raison de sa présence. Aucun placement : c'est le devis, pas le
 * chantier. La disposition (étape 5) prend cette liste et la pose ; elle ne la décide plus.
 *
 * Les nombres de copies de services sont des ESTIMATIONS géométriques — le placeur réel en
 * posera peut-être une de plus ou de moins. Tout le reste (maisons, production, main-d'œuvre,
 * biens) est exact au sens du modèle de données.
 */

/** Surface urbaine par maison, routes et services compris. Mesurée le 2026-10-26 sur sept
 *  plans denses : 19,8 à 23,1, médiane 21,8. */
export const SURFACE_PAR_MAISON = 22;
/** Pas du peigne horizontal (résidences 3×3) — même détour de grille que `planLattice`. */
const PAS_PEIGNE = 7;
/** Routes par case de production, mesurées sur les blueprints (`prodlayout`) : ~20 %. */
const ROUTES_PRODUCTION = 0.25;

export interface LigneMaisons {
  tierGuid: string;
  maisons: number;
}

export type ChoixServices = "minimal" | "complet" | { ids: string[] };

export interface Commande {
  /** Monde de l'île : `Roman` (Latium) ou `Celtic` (Albion). */
  region: string;
  maisons: LigneMaisons[];
  /**
   * Services des quartiers. `minimal` (défaut) : la plus petite recette qui franchit les seuils
   * du palier le plus haut commandé. `complet` : tous les services de la lignée — plus de bonus
   * par maison, plus de sol. Ou une liste explicite.
   */
  services?: ChoixServices;
  /** Institutions anti-incidents (Vigiles, Medici, puits…). Défaut : oui. */
  institutions?: boolean;
  /** Bâtiments de production demandés tels quels — le panier de `prodlayout`. */
  production?: BasketLine[];
  /** Compléter les chaînes du panier jusqu'aux matières premières. Défaut : non — c'est un
   *  geste explicite du joueur, jamais un effet de bord (doctrine de `basket.ts`). */
  completerProduction?: boolean;
  /** Biens consommés par les maisons : `importer` (défaut) ou `produire` sur l'île. */
  biensDesMaisons?: "importer" | "produire";
  /**
   * Main-d'œuvre manquante : `loger` (défaut) ajoute les maisons ouvrières nécessaires,
   * `signaler` se contente de la chiffrer. Il n'y a AUCUNE substitution entre paliers
   * (`economy/workforce.ts`) : des Patriciens ne font pas tourner un atelier de Plébéiens.
   */
  mainOeuvre?: "loger" | "signaler";
  /** Terre constructible de l'île, pour avertir si la commande ne tient pas. */
  terre?: number;
}

export type RoleLigne = "residence" | "ouvriers" | "service" | "institution" | "production" | "comptoir";

export interface LigneNomenclature {
  defId: string;
  nom: string;
  nombre: number;
  role: RoleLigne;
  /** Pourquoi cette ligne existe — c'est ce que le joueur lit pour comprendre le devis. */
  raison: string;
  /** Cases par exemplaire, champs compris. */
  emprise: number;
}

export interface Nomenclature {
  lignes: LigneNomenclature[];
  /** Habitants si chaque maison est couverte par ses services. */
  habitants: number;
  /** Palier effectivement atteint par chaque ligne de maisons avec les services retenus. */
  paliers: { demande: string; atteint: string; capacite: number }[];
  /** Biens consommés par les maisons, et d'où ils viennent. */
  biens: { good: string; nom: string; parMinute: number; source: "import" | "produit" }[];
  mainOeuvre: { demande: Record<string, number>; offre: Record<string, number>; manque: Record<string, number> };
  /** Surface estimée, en cases : quartiers d'habitation et zone de production. */
  surface: { quartiers: number; production: number; total: number };
  avertissements: string[];
}

const rangeOf = (d: BuildingDef) => d.streetRange || d.radius?.range || 0;

/**
 * Copies d'un service à portée-rue pour couvrir une zone : pavage en diamants L1 de rayon
 * effectif `portée − pas du peigne`, comme le pose `planLattice`. Un bâtiment unique : une.
 */
export function copiesPourCouvrir(def: BuildingDef, surface: number): number {
  if (def.unique) return 1;
  const r = Math.max(8, rangeOf(def) - PAS_PEIGNE);
  return Math.max(1, Math.ceil(surface / (2 * r * r)));
}

const empriseDe = (d: BuildingDef): number => d.size.w * d.size.h + (d.field?.tiles ?? 0);

/** La nomenclature d'une commande. Fonction pure et déterministe. */
export function nomenclature(commande: Commande, catalog: BuildingDef[], lookup: DefLookup): Nomenclature {
  const avertissements: string[] = [];
  const monde = worldOf(commande.region);
  const nom = (id: string) => lookup(id)?.name ?? id;

  // ─── MAISONS COMMANDÉES ─────────────────────────────────────────────────────────────
  const maisons = new Map<string, number>(); // tierGuid → maisons
  for (const l of commande.maisons) {
    const t = tierByGuid(l.tierGuid);
    if (!t?.residenceId) { avertissements.push(`Palier inconnu ou sans résidence : ${l.tierGuid}`); continue; }
    if (worldOf(t.region) !== monde) {
      avertissements.push(`${t.name} n'existe pas dans ce monde : ligne ignorée`);
      continue;
    }
    const n = Math.max(0, Math.trunc(l.maisons));
    if (n) maisons.set(t.guid, (maisons.get(t.guid) ?? 0) + n);
  }

  // Le palier le plus dense commandé fixe la lignée, donc les services possibles.
  const sommet = [...maisons.keys()].map((g) => tierByGuid(g)!)
    .sort((a, b) => b.capacityDefault - a.capacityDefault)[0];
  const chaine: Tier[] = sommet ? residentialChainExtended(sommet.guid) : [];

  // ─── SERVICES : LA RECETTE ──────────────────────────────────────────────────────────
  // Chaque palier se juge dans SA lignée : en Albion, les ouvriers natifs (Forgerons,
  // Aldermen) ne sont pas dans la lignée romanisée des Nobles. Un évaluateur par palier logé.
  const choix = commande.services ?? "minimal";
  const evals = new Map<string, { chaine: Tier[]; ev: ReturnType<typeof compileTierEvaluator> }>();
  const evalDe = (g: string) => {
    let e = evals.get(g);
    if (!e) {
      const ch = residentialChainExtended(g);
      e = { chaine: ch, ev: compileTierEvaluator(ch, { goodsMet: true }) };
      evals.set(g, e);
    }
    return e;
  };
  const recetteMinimale = (g: string): string[] =>
    [...(candidateRecipes(residentialChainExtended(g), lookup, { keep: 1, keepFallback: 0, keepOpened: 0 })[0]?.serviceIds ?? [])];
  let servicesIds: string[] = [];
  if (sommet) {
    if (choix === "complet") {
      servicesIds = [...new Set(chaine.flatMap((t) => t.services.map((s) => s.building)))]
        .filter((id): id is string => !!id && !!lookup(id) && rangeOf(lookup(id)!) > 0);
    } else if (choix === "minimal") {
      servicesIds = recetteMinimale(sommet.guid);
    } else {
      servicesIds = choix.ids.filter((id) => {
        const ok = !!lookup(id);
        if (!ok) avertissements.push(`Service inconnu : ${id}`);
        return ok;
      });
    }
  }
  const masqueDe = (ev: ReturnType<typeof compileTierEvaluator>) => {
    let m = 0;
    for (const id of servicesIds) {
      const b = ev.bitOf.get(id);
      if (b !== undefined) m |= 1 << b;
    }
    return m;
  };
  /** Le palier franchit-il ses seuils avec les services retenus ? */
  const ouvre = (t: Tier): boolean => {
    const { chaine: ch, ev } = evalDe(t.guid);
    return ev.evaluateAt(ch.length - 1, masqueDe(ev)) !== null;
  };
  /** Palier réellement atteint par une maison de `t` : lui-même, sinon le meilleur de sa lignée. */
  const atteintDe = (t: Tier): Tier => (ouvre(t) ? t : evalDe(t.guid).ev.evaluate(masqueDe(evalDe(t.guid).ev)).tier);
  const capaciteDe = (t: Tier): number => {
    const { chaine: ch, ev } = evalDe(t.guid);
    const m = masqueDe(ev);
    return ev.evaluateAt(ch.length - 1, m)?.cap ?? ev.evaluate(m).cap;
  };
  const capacite = new Map<string, number>();

  // ─── PRODUCTION : PANIER, COMPLÉTION, BIENS DES MAISONS ─────────────────────────────
  const production = new Map<string, { nombre: number; raison: string }>();
  const ajouterProd = (defId: string, nombre: number, raison: string) => {
    if (nombre <= 0) return;
    const cur = production.get(defId);
    production.set(defId, { nombre: (cur?.nombre ?? 0) + nombre, raison: cur ? `${cur.raison} ; ${raison}` : raison });
  };
  let panier = normalizeBasket(commande.production ?? []);
  for (const l of panier.lines) ajouterProd(l.defId, l.count, "demandé");
  if (commande.completerProduction && panier.lines.length) {
    const complet = completeBasket(panier, lookup);
    for (const l of complet.lines) {
      const avant = panier.lines.find((x) => x.defId === l.defId)?.count ?? 0;
      ajouterProd(l.defId, l.count - avant, "complète une chaîne demandée");
    }
    panier = complet;
  }

  const residentsDe = (m: Map<string, number>) => {
    const out: Record<string, number> = {};
    for (const [g, n] of m) out[g] = n * (capacite.get(g) ?? tierByGuid(g)!.capacityDefault);
    return out;
  };
  const produire = commande.biensDesMaisons === "produire";
  const biensDe = (m: Map<string, number>) => {
    const res = residentsDe(m);
    const caps: Record<string, number> = {};
    for (const [g] of m) caps[g] = capacite.get(g) ?? tierByGuid(g)!.capacityDefault;
    return solve(
      Object.entries(res).map(([tier, pop]) => ({ tier, pop })),
      {
        includeProduction: produire, includeServices: false, includeWorkforce: false, capacities: caps,
        region: commande.region, strictWorld: true,
      },
    );
  };

  // ─── MAIN-D'ŒUVRE : POINT FIXE ──────────────────────────────────────────────────────
  // Les maisons ouvrières agrandissent le quartier, donc ses services, qui réclament à leur
  // tour de la main-d'œuvre. Quelques tours suffisent : chaque tour n'ajoute que le reliquat.
  //
  // Et un palier ouvrier a ses PROPRES seuils : la recette minimale des Patriciens ne loge pas
  // un Plébéien. Mesuré : 16 maisons de Plébéiens « commandées » par la main-d'œuvre, et aucune
  // à son palier. Si un palier ouvrier n'est pas ouvert, sa recette minimale rejoint les
  // services, et l'on recommence — sauf liste explicite du joueur, qui est respectée et signalée.
  const kontor = pickKontorDef(catalog, commande.region);
  const offreComptoir = workforceGrant(kontor?.id);
  const ouvriers = new Map<string, number>();
  let lignesServices: LigneNomenclature[] = [];
  let lignesInstitutions: LigneNomenclature[] = [];
  let prodBesoins: Record<string, number> = {};
  let sol = solve([], { includeProduction: false, includeServices: false, includeWorkforce: false, capacities: {} });
  let demande: Record<string, number> = {}, offre: Record<string, number> = {}, manque: Record<string, number> = {};
  for (let passe = 0; passe < 3; passe++) {
    ouvriers.clear();
    capacite.clear();
    for (const [g] of maisons) capacite.set(g, capaciteDe(atteintDe(tierByGuid(g)!)));
    for (let tour = 0; tour < 8; tour++) {
      const toutes = new Map(maisons);
      for (const [g, n] of ouvriers) toutes.set(g, (toutes.get(g) ?? 0) + n);
      const nMaisons = [...toutes.values()].reduce((a, b) => a + b, 0);
      const surfaceQuartiers = nMaisons * SURFACE_PAR_MAISON;

      lignesServices = servicesIds.map((id) => {
        const d = lookup(id)!;
        return {
          defId: id, nom: d.name, nombre: copiesPourCouvrir(d, surfaceQuartiers), role: "service" as const,
          raison: `besoin du palier, portée ${rangeOf(d)}`, emprise: empriseDe(d),
        };
      });
      lignesInstitutions = commande.institutions === false ? [] : institutionDefs(commande.region)
        .filter((i) => { const d = lookup(i.defId); return !!d && d.uniqueType !== SHRINE_TYPE; })
        .map((i) => {
          const d = lookup(i.defId)!;
          const effets = Object.entries(i.attrs).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ");
          return {
            defId: i.defId, nom: d.name, nombre: copiesPourCouvrir(d, surfaceQuartiers), role: "institution" as const,
            raison: `compense le rang de cité (${effets})`, emprise: empriseDe(d),
          };
        });
      sol = biensDe(toutes);
      prodBesoins = produire ? sol.productionCounts : {};

      const charge: Record<string, number> = {};
      const facturer = (defId: string, n: number) => { if (n > 0) charge[defId] = (charge[defId] ?? 0) + n; };
      for (const [id, p] of production) facturer(id, p.nombre);
      for (const [id, n] of Object.entries(prodBesoins)) facturer(id, n);
      for (const l of [...lignesServices, ...lignesInstitutions]) facturer(l.defId, l.nombre);
      demande = {};
      for (const [id, n] of Object.entries(charge)) {
        for (const w of economy.buildingWorkforce[id] ?? []) demande[w.tier] = (demande[w.tier] ?? 0) + n * w.amount;
      }
      offre = { ...offreComptoir };
      for (const [g, pop] of Object.entries(residentsDe(toutes))) {
        const t = tierByGuid(g)!;
        offre[g] = (offre[g] ?? 0) + pop * t.factor;
      }
      manque = {};
      for (const [g, d] of Object.entries(demande)) {
        const m = d - (offre[g] ?? 0);
        if (m > 1e-6) manque[g] = m;
      }
      if (commande.mainOeuvre === "signaler" || !Object.keys(manque).length) break;
      let ajout = false;
      for (const [g, m] of Object.entries(manque)) {
        const t = tierByGuid(g);
        if (!t?.residenceId || worldOf(t.region) !== monde) continue; // signalé plus bas
        if (!capacite.has(g)) capacite.set(g, capaciteDe(t));
        const parMaison = (capacite.get(g) ?? t.capacityDefault) * t.factor;
        const n = Math.ceil(m / Math.max(1e-6, parMaison));
        if (n > 0) { ouvriers.set(g, (ouvriers.get(g) ?? 0) + n); ajout = true; }
      }
      if (!ajout) break;
    }
    const fermes = [...ouvriers.keys()].map((g) => tierByGuid(g)!).filter((t) => !ouvre(t));
    if (!fermes.length) break;
    if (typeof choix === "object") {
      for (const t of fermes) avertissements.push(`${t.name} (main-d'œuvre) : les services choisis ne franchissent pas ses seuils`);
      break;
    }
    const avant = servicesIds.length;
    servicesIds = [...new Set([...servicesIds, ...fermes.flatMap((t) => recetteMinimale(t.guid))])];
    if (servicesIds.length === avant) break;
  }

  // ─── PALIER ATTEINT ET CAPACITÉ, LIGNE PAR LIGNE ────────────────────────────────────
  const paliers: Nomenclature["paliers"] = [];
  for (const [guid] of maisons) {
    const t = tierByGuid(guid)!;
    const atteint = atteintDe(t);
    paliers.push({ demande: t.name, atteint: atteint.name, capacite: capacite.get(guid)! });
    if (atteint.guid !== guid) {
      avertissements.push(`${t.name} : les services retenus ne franchissent pas ses seuils —`
        + ` les maisons resteront ${atteint.name}`);
    }
  }

  // ─── LIGNES ─────────────────────────────────────────────────────────────────────────
  const lignes: LigneNomenclature[] = [];
  for (const [g, n] of maisons) {
    const t = tierByGuid(g)!, d = lookup(t.residenceId!)!;
    lignes.push({ defId: d.id, nom: d.name, nombre: n, role: "residence", raison: "commandé", emprise: empriseDe(d) });
  }
  for (const [g, n] of ouvriers) {
    const t = tierByGuid(g)!, d = lookup(t.residenceId!)!;
    lignes.push({
      defId: d.id, nom: d.name, nombre: n, role: "ouvriers",
      raison: `main-d'œuvre ${t.name} des ateliers et services`, emprise: empriseDe(d),
    });
  }
  lignes.push(...lignesServices, ...lignesInstitutions);
  for (const [id, p] of production) {
    lignes.push({ defId: id, nom: nom(id), nombre: p.nombre, role: "production", raison: p.raison, emprise: empriseDe(lookup(id)!) });
  }
  for (const [id, n] of Object.entries(prodBesoins)) {
    if (!n) continue;
    const d = lookup(id);
    if (!d) { avertissements.push(`Producteur absent du catalogue : ${id}`); continue; }
    lignes.push({ defId: id, nom: d.name, nombre: n, role: "production", raison: "biens des maisons", emprise: empriseDe(d) });
  }
  if (kontor) {
    lignes.push({ defId: kontor.id, nom: kontor.name, nombre: 1, role: "comptoir", raison: "racine du réseau, entrée des imports", emprise: empriseDe(kontor) });
  }

  // ─── HORS DU MONDE, MAIN-D'ŒUVRE IMPOSSIBLE ─────────────────────────────────────────
  for (const l of lignes) {
    const reg = lookup(l.defId)?.region;
    if (reg && worldOf(reg) !== monde) avertissements.push(`${l.nom} appartient à l'autre monde : il ne se construit pas ici`);
  }
  for (const [g, m] of Object.entries(manque)) {
    const t = tierByGuid(g);
    if (!t || worldOf(t.region) !== monde) {
      avertissements.push(`${Math.ceil(m)} main-d'œuvre ${t?.name ?? g} réclamée, palier absent de ce monde`);
    } else if (commande.mainOeuvre === "signaler") {
      avertissements.push(`Main-d'œuvre ${t.name} : ${Math.ceil(m)} manquante(s) — production au ralenti`);
    }
  }

  // ─── BIENS, HABITANTS, SURFACE ──────────────────────────────────────────────────────
  const biens: Nomenclature["biens"] = Object.entries(sol.goodsPerMin)
    .filter(([, v]) => v > 1e-9)
    .map(([good, v]) => ({
      good, nom: goodName(good), parMinute: Math.round(v * 100) / 100,
      source: (produire && !(good in sol.imports) ? "produit" : "import") as "produit" | "import",
    }))
    .sort((a, b) => b.parMinute - a.parMinute);
  const toutes = new Map(maisons);
  for (const [g, n] of ouvriers) toutes.set(g, (toutes.get(g) ?? 0) + n);
  const habitants = Math.round(Object.values(residentsDe(toutes)).reduce((a, b) => a + b, 0));
  const nMaisons = [...toutes.values()].reduce((a, b) => a + b, 0);
  const quartiers = nMaisons * SURFACE_PAR_MAISON;
  const prodCases = lignes.filter((l) => l.role === "production").reduce((s, l) => s + l.nombre * l.emprise, 0);
  const surfaceProduction = Math.round(prodCases * (1 + ROUTES_PRODUCTION));
  const total = quartiers + surfaceProduction + (kontor ? empriseDe(kontor) : 0);
  if (commande.terre !== undefined && total > commande.terre) {
    avertissements.push(`La commande demande ~${total} cases pour ${commande.terre} de terre constructible`);
  }

  return {
    lignes,
    habitants,
    paliers,
    biens,
    mainOeuvre: { demande, offre, manque },
    surface: { quartiers, production: surfaceProduction, total },
    avertissements,
  };
}
