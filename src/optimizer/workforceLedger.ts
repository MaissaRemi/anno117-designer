import { tierByGuid, worldOf } from "../economy/economy";
import { VITAL_ATTRS } from "../economy/attributes";
import { workforceDemand } from "../economy/workforce";
import type { HousePlot } from "./planLattice";

/**
 * CASCADE DE MAIN-D'ŒUVRE — le grand-livre qui décide quelles maisons deviennent ouvrières.
 *
 * Le problème : un atelier réclame la main-d'œuvre d'UN palier précis, et il n'existe aucune
 * substitution entre paliers. Une île peuplée uniquement de Patriciens ne fait donc tourner
 * AUCUN atelier réclamant des Plébéiens, quelle que soit sa population. Pour produire sur
 * place, il faut rétrograder une partie des maisons.
 *
 * Ce qui rend l'exercice tractable : **convertir ne démolit rien**. Les neuf résidences du
 * jeu font toutes 3×3, une conversion n'est qu'un changement de `defId`. Trois conséquences
 * qui ferment la boucle que l'on pouvait craindre :
 *
 *  1. le nombre de maisons est INVARIANT, donc le terme `maisons × malus de rang` du bilan
 *     d'attributs l'est aussi — seuls les bonus de besoins bougent ;
 *  2. la population ne peut que BAISSER, donc le rang de cité ne peut que s'adoucir : la
 *     rétroaction est négative, stabilisante. Il n'y a pas d'emballement ;
 *  3. la géométrie n'est jamais rejouée — ni routes, ni couverture, ni réseau d'eau.
 *
 * Le tri des conversions n'est PAS « descendre le plus bas possible ». Mesuré en Latium, une
 * unité de main-d'œuvre coûte 2,3 habitants si on vise les Equites, 9,7 si on vise les
 * Liberti — et rétrograder vers les Equites RAPPORTE de la sécurité incendie. Le prix
 * mélange donc habitants perdus et attributs vitaux consommés, ces derniers pondérés par
 * leur rareté : un attribut presque épuisé devient prohibitif.
 */

/** Une conversion retenue, pour restitution à l'utilisateur. */
export interface Conversion {
  from: string; // guid du palier d'origine
  to: string;   // guid du palier ouvrier
  houses: number;
  popLost: number;
}

export interface SettleResult {
  /** uid de maison → nouveau `defId` (absent = inchangée) */
  changed: Map<string, string>;
  conversions: Conversion[];
  tierCounts: Record<string, number>;
  capByTier: Record<string, number>;
  attrsSum: Record<string, number>;
  houseMoney: number;
  residents: number;
  /** ce qui reste non pourvu : > 0 = des bâtiments tourneront au ralenti en jeu */
  deficit: Record<string, number>;
  /** demande adressée à des paliers absents du monde de l'île (jamais satisfiable) */
  alien: Record<string, number>;
  /** variation du bilan d'attributs due aux SEULES conversions (hors rang de cité) */
  attrsDelta: Record<string, number>;
  /** maisons encore debout */
  houses: number;
  offer: Record<string, number>;
  demand: Record<string, number>;
  /** vivier : nombre de maisons pouvant légalement accueillir chaque palier */
  convertible: Record<string, number>;
}

const total = (r: Record<string, number>): number =>
  Object.values(r).reduce((a, b) => a + b, 0);

/** Poids du terme d'attributs face aux habitants perdus dans le prix d'une conversion. */
const ATTR_WEIGHT = 400;

export class WorkforceLedger {
  private readonly plots: HousePlot[];
  /** index dans `plots[i].opts` du palier actuellement assigné */
  private cur: Int32Array;
  private readonly grants: Record<string, number>;
  private readonly world: string;
  private demand: Record<string, number> = {};
  private nowAttrs: Record<string, number> | null = null;
  private nowPop = 0;
  private nowShort = 0;
  /** parcelles rasées après coup (emprise d'un atelier) — exclues de tous les totaux */
  private readonly dead = new Set<number>();
  private readonly byUid = new Map<string, number>();
  private readonly initialAttrs: Record<string, number>;

  constructor(plots: HousePlot[], grants: Record<string, number>, world: string) {
    this.plots = plots;
    this.grants = grants;
    this.world = world;
    this.cur = new Int32Array(plots.length);
    for (let i = 0; i < plots.length; i++) {
      const k = plots[i].opts.findIndex((o) => o.guid === plots[i].guid);
      this.cur[i] = k >= 0 ? k : Math.max(0, plots[i].opts.length - 1);
      this.byUid.set(plots[i].uid, i);
    }
    this.initialAttrs = this.attrsOf(this.cur);
  }

  /**
   * Retire des parcelles rasées après la construction du grand-livre (l'emprise d'un atelier
   * remplace des maisons). Elles cessent de compter, en offre comme en attributs.
   */
  drop(uids: Iterable<string>): void {
    for (const u of uids) {
      const i = this.byUid.get(u);
      if (i !== undefined) this.dead.add(i);
    }
    this.nowAttrs = null;
  }

  /**
   * Enregistre la main-d'œuvre réclamée par des bâtiments posés, ET applique aussitôt les
   * conversions nécessaires. L'assignation courante sert de point de départ au tour suivant :
   * la demande ne faisant que croître, les conversions déjà décidées restent valides — le
   * glouton ne refait donc que le travail marginal.
   */
  charge(defIds: Iterable<string>): void {
    const d = workforceDemand(defIds);
    if (!Object.keys(d).length) return;
    for (const [k, v] of Object.entries(d)) this.demand[k] = (this.demand[k] ?? 0) + v;
    const r = this.run(this.cur, this.demand);
    this.nowAttrs = r.attrs;
    this.nowPop = r.pop;
    this.nowShort = total(r.deficit);
  }

  /** Bilan d'attributs des maisons dans l'état courant (hors rang de cité). */
  private now(): { attrs: Record<string, number>; pop: number; short: number } {
    if (!this.nowAttrs) {
      const r = this.run(this.cur.slice(), this.demand);
      this.nowAttrs = r.attrs; this.nowPop = r.pop; this.nowShort = total(r.deficit);
    }
    return { attrs: this.nowAttrs, pop: this.nowPop, short: this.nowShort };
  }

  /**
   * Ce que COÛTERAIT, en attributs vitaux, le fait d'alimenter ces bâtiments en plus —
   * sans rien engager. Renvoie `null` si la demande est physiquement insatisfiable (palier
   * hors du monde de l'île, ou plus aucune maison convertible).
   *
   * C'est ce devis qui permet à la pose d'ateliers de s'arrêter d'elle-même : le budget
   * d'attributs paie à la fois l'effet de zone de l'atelier ET les maisons qu'il faudra
   * rétrograder pour le faire tourner.
   */
  quote(defIds: Iterable<string>): { attrs: Record<string, number>; popLost: number } | null {
    const extra = workforceDemand(defIds);
    if (!Object.keys(extra).length) return { attrs: {}, popLost: 0 };
    const merged: Record<string, number> = { ...this.demand };
    for (const [k, v] of Object.entries(extra)) merged[k] = (merged[k] ?? 0) + v;
    const before = this.now();
    const after = this.run(this.cur.slice(), merged);
    // Le devis ne juge QUE la demande ajoutée : un déficit qui préexistait — des services
    // déjà posés qu'aucune conversion ne peut armer — ne doit pas interdire tout le reste.
    // Sans cette nuance, un seul palier irréductible bloquait la production locale entière.
    if (total(after.deficit) > before.short + 1e-6) return null;
    const attrs: Record<string, number> = {};
    for (const k of VITAL_ATTRS) attrs[k] = (after.attrs[k] ?? 0) - (before.attrs[k] ?? 0);
    return { attrs, popLost: before.pop - after.pop };
  }

  /** Applique la cascade pour de bon et rend le nouvel état de l'île. */
  settle(): SettleResult {
    const r = this.run(this.cur, this.demand);
    const changed = new Map<string, string>();
    const conv = new Map<string, Conversion>();
    const tierCounts: Record<string, number> = {};
    const capByTier: Record<string, number> = {};
    const attrsSum: Record<string, number> = {};
    for (const k of VITAL_ATTRS) attrsSum[k] = 0;
    let houseMoney = 0, residents = 0, houses = 0;
    for (let i = 0; i < this.plots.length; i++) {
      if (this.dead.has(i)) continue;
      const p = this.plots[i];
      const o = p.opts[this.cur[i]];
      if (!o) continue;
      if (o.guid !== p.guid) {
        changed.set(p.uid, o.defId);
        const key = `${p.guid}>${o.guid}`;
        const c = conv.get(key) ?? { from: p.guid, to: o.guid, houses: 0, popLost: 0 };
        const was = p.opts.find((x) => x.guid === p.guid);
        c.houses++;
        c.popLost += (was?.cap ?? 0) - o.cap;
        conv.set(key, c);
      }
      houses++;
      tierCounts[o.guid] = (tierCounts[o.guid] ?? 0) + 1;
      capByTier[o.guid] = (capByTier[o.guid] ?? 0) + o.cap;
      residents += o.cap;
      houseMoney += o.money;
      for (const k of VITAL_ATTRS) attrsSum[k] += o.attrs[k] ?? 0;
    }
    return {
      changed,
      conversions: [...conv.values()].sort((a, b) => b.houses - a.houses),
      tierCounts, capByTier, attrsSum, houseMoney,
      residents: Math.round(residents),
      deficit: r.deficit,
      alien: r.alien,
      attrsDelta: Object.fromEntries(
        VITAL_ATTRS.map((k) => [k, (attrsSum[k] ?? 0) - (this.initialAttrs[k] ?? 0)]),
      ),
      houses,
      offer: this.supplyOf(this.cur),
      demand: { ...this.demand },
      convertible: this.convertible(),
    };
  }

  /**
   * Attributs qu'emportent des maisons rasées, dans leur affectation COURANTE. Sert à faire
   * payer d'avance, au budget, l'emprise d'un atelier sur le tissu résidentiel.
   */
  razeCost(uids: Iterable<string>): Record<string, number> {
    const c: Record<string, number> = {};
    for (const k of VITAL_ATTRS) c[k] = 0;
    for (const u of uids) {
      const i = this.byUid.get(u);
      if (i === undefined || this.dead.has(i)) continue;
      const o = this.plots[i].opts[this.cur[i]];
      if (!o) continue;
      for (const k of VITAL_ATTRS) c[k] += o.attrs[k] ?? 0;
    }
    return c;
  }

  /** Combien de maisons vivantes pourraient accueillir chaque palier. */
  private convertible(): Record<string, number> {
    const c: Record<string, number> = {};
    for (let i = 0; i < this.plots.length; i++) {
      if (this.dead.has(i)) continue;
      for (const o of this.plots[i].opts) c[o.guid] = (c[o.guid] ?? 0) + 1;
    }
    return c;
  }

  /** Offre du pool : comptoir + habitants × facteur du palier. */
  private supplyOf(assign: Int32Array): Record<string, number> {
    const s: Record<string, number> = { ...this.grants };
    for (let i = 0; i < this.plots.length; i++) {
      if (this.dead.has(i)) continue;
      const o = this.plots[i].opts[assign[i]];
      if (!o) continue;
      const t = tierByGuid(o.guid);
      if (!t?.workforce) continue;
      s[o.guid] = (s[o.guid] ?? 0) + o.cap * t.factor;
    }
    return s;
  }

  /**
   * Le glouton. Mute `assign` : passer une copie pour un simple devis.
   *
   * Terminaison : chaque tour consomme une parcelle du vivier fini `plots × paliers`, et une
   * parcelle déjà au palier visé n'est jamais reprise. Le compteur de garde n'est qu'un
   * filet — la boucle s'arrête d'elle-même quand le déficit est couvert ou le vivier vide.
   */
  private run(assign: Int32Array, demand: Record<string, number>) {
    // Une demande adressée à un palier d'un AUTRE monde n'est jamais satisfiable : aucune
    // maison de l'île ne peut fournir ce bien. On l'isole plutôt que de boucler dessus.
    const alien: Record<string, number> = {};
    const local: Record<string, number> = {};
    for (const [guid, v] of Object.entries(demand)) {
      const t = tierByGuid(guid);
      if (!t || worldOf(t.region) !== this.world) alien[guid] = v;
      else local[guid] = v;
    }

    let supply = this.supplyOf(assign);
    const attrs = this.attrsOf(assign);
    let pop = this.popOf(assign);

    for (let guard = 0; guard < 20_000; guard++) {
      // le palier le plus déficitaire en premier
      let target = "", worst = 1e-6;
      for (const [guid, d] of Object.entries(local)) {
        const miss = d - (supply[guid] ?? 0);
        if (miss > worst) { worst = miss; target = guid; }
      }
      if (!target) break;

      // rareté de chaque attribut vital : un attribut presque épuisé rend prohibitive toute
      // conversion qui y touche. Les μ ne font que croître à mesure qu'on dépense.
      const mu: Record<string, number> = {};
      for (const k of VITAL_ATTRS) mu[k] = 1 / Math.max(1, attrs[k] ?? 0);

      let bestI = -1, bestK = -1, bestPrice = Infinity;
      for (let i = 0; i < this.plots.length; i++) {
        if (this.dead.has(i)) continue;
        const opts = this.plots[i].opts;
        const from = opts[assign[i]];
        if (!from || from.guid === target) continue;
        const k = opts.findIndex((o) => o.guid === target);
        if (k < 0) continue;
        const to = opts[k];
        const tTo = tierByGuid(to.guid), tFrom = tierByGuid(from.guid);
        if (!tTo?.workforce) continue;
        const gain = to.cap * tTo.factor;
        if (gain <= 0) continue;
        // GARDE D'ADMISSIBILITÉ : ne pas creuser un déficit chez le palier d'origine en
        // comblant celui d'ailleurs — c'est la seule façon dont la boucle pourrait osciller.
        const lost = tFrom?.workforce ? from.cap * tFrom.factor : 0;
        if (lost > 0 && (supply[from.guid] ?? 0) - lost < (local[from.guid] ?? 0)) continue;
        let price = from.cap - to.cap; // habitants perdus
        for (const key of VITAL_ATTRS) {
          const d = (to.attrs[key] ?? 0) - (from.attrs[key] ?? 0);
          if (d < 0) price += ATTR_WEIGHT * mu[key] * -d;
        }
        price /= gain;
        if (price < bestPrice) { bestPrice = price; bestI = i; bestK = k; }
      }
      if (bestI < 0) break; // vivier épuisé : le déficit restant est irréductible

      const opts = this.plots[bestI].opts;
      const from = opts[assign[bestI]], to = opts[bestK];
      const tFrom = tierByGuid(from.guid), tTo = tierByGuid(to.guid);
      if (tFrom?.workforce) supply[from.guid] = (supply[from.guid] ?? 0) - from.cap * tFrom.factor;
      if (tTo?.workforce) supply[to.guid] = (supply[to.guid] ?? 0) + to.cap * tTo.factor;
      for (const k of VITAL_ATTRS) attrs[k] = (attrs[k] ?? 0) + (to.attrs[k] ?? 0) - (from.attrs[k] ?? 0);
      pop += to.cap - from.cap;
      assign[bestI] = bestK;
    }

    supply = this.supplyOf(assign);
    const deficit: Record<string, number> = {};
    for (const [guid, d] of Object.entries(local)) {
      const miss = d - (supply[guid] ?? 0);
      if (miss > 1e-6) deficit[guid] = Math.round(miss * 100) / 100;
    }
    const short = Object.keys(deficit).length > 0 || Object.keys(alien).length > 0;
    return { attrs, pop, deficit, alien, short };
  }

  private attrsOf(assign: Int32Array): Record<string, number> {
    const a: Record<string, number> = {};
    for (const k of VITAL_ATTRS) a[k] = 0;
    for (let i = 0; i < this.plots.length; i++) {
      if (this.dead.has(i)) continue;
      const o = this.plots[i].opts[assign[i]];
      if (!o) continue;
      for (const k of VITAL_ATTRS) a[k] += o.attrs[k] ?? 0;
    }
    return a;
  }

  private popOf(assign: Int32Array): number {
    let p = 0;
    for (let i = 0; i < this.plots.length; i++) {
      if (this.dead.has(i)) continue;
      p += this.plots[i].opts[assign[i]]?.cap ?? 0;
    }
    return p;
  }
}
