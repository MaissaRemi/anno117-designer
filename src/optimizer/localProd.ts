import { uid } from "../model/factories";
import { footprintSize } from "../engine/geometry";
import { economy, effectOf, goodName, pickProducerInWorld } from "../economy/economy";
import { VITAL_ATTRS } from "../economy/attributes";
import type { DefLookup } from "../engine/rules";
import type { BuildingDef, GridShape, PlacedBuilding, RoadTile } from "../model/types";

/**
 * PRODUCTION FINALE SUR L'ÎLE — dépenser le budget d'attributs.
 *
 * Une île d'import fait venir ses 27 biens tout faits. On peut aussi en produire une partie
 * sur place : chaque atelier posé retire son bien du manifeste et applique son effet de zone
 * aux maisons alentour — souvent positif pour les biens de luxe (Lyrier +1 Argent +1 Bonheur),
 * franchement négatif pour l'industrie sale (Graisse −2 Bonheur −2 Incendie, cumulable).
 *
 * La règle d'arrêt n'est pas une pondération inventée mais celle du jeu, telle que posée :
 * **on continue de bâtir tant que le bilan de l'île reste positif** sur le Bonheur, l'Argent,
 * la Santé et la Sécurité incendie. Le surplus accumulé — mesuré à +1 887 en Santé et
 * +50 000 en Argent sur une île moyenne — est précisément le budget que ces ateliers dépensent.
 *
 * Un atelier coûte aussi du sol : il remplace des maisons, donc des habitants. On ne le pose
 * que si le gain (un bien de moins à acheminer) vaut cette perte, et on traite les biens du
 * manifeste par débit décroissant — les plus lourds à importer d'abord.
 */

export interface LocalProdOptions {
  /** Région de l'île : on ne pose pas une chaîne celtique sur une île romaine. */
  region?: string;
  /** Nombre maximal d'ateliers posés (garde-fou de temps). Défaut 40. */
  maxBuildings?: number;
  /**
   * GRAND-LIVRE DE MAIN-D'ŒUVRE. Un atelier ne coûte pas que du sol et un effet de zone : il
   * réclame la main-d'œuvre d'un palier précis, qu'il faut produire en RÉTROGRADANT des
   * maisons. Le budget d'attributs paie donc les deux — l'effet de zone de l'atelier ET les
   * conversions qu'il impose. Sans ce devis, on posait des ateliers qu'aucun ouvrier ne peut
   * faire tourner en jeu.
   */
  workforce?: {
    quote(defIds: string[]): { attrs: Record<string, number>; popLost: number } | null;
    charge(defIds: string[]): void;
    /** attributs qu'emportent des maisons rasées */
    razeCost(uids: string[]): Record<string, number>;
  };
}

export interface LocalWorkshop {
  defId: string;
  name: string;
  good: string;
  goodName: string;
  /** débit couvert, u/min */
  perMin: number;
  copies: number;
  /** effet de zone cumulé sur les maisons à portée */
  attrs: Record<string, number>;
  /** maisons rasées pour faire la place */
  housesLost: number;
  /** intrants consommés par ces copies, u/min — à produire ou à importer */
  inputs: { good: string; perMin: number }[];
}

export interface LocalProdResult {
  buildings: PlacedBuilding[];
  /** uids de résidences rasées pour faire place aux ateliers */
  removed: string[];
  workshops: LocalWorkshop[];
  /** delta d'attributs de l'île, effets de zone des ateliers compris */
  attrsDelta: Record<string, number>;
  /**
   * BILAN DU MANIFESTE, bien par bien : ce que l'île produit désormais elle-même (positif)
   * et ce qu'elle doit acheminer EN PLUS pour alimenter ses ateliers (négatif).
   *
   * Un atelier ne fait pas disparaître un besoin, il le DÉPLACE en amont : produire des
   * tuniques sur place, c'est cesser d'importer des tuniques et commencer à importer de la
   * laine. Ne soustraire que le bien fini surestimait le gain.
   */
  netPerMin: Record<string, number>;
  gaps: string[];
}

/** Débit d'un producteur en unités/minute, 0 si la donnée manque. */
function ratePerMin(defId: string, good: string): number {
  const p = economy.buildingProd[defId];
  const out = p?.outputs?.find((o) => o.good === good);
  if (!p?.cycleTime || !out) return 0;
  return (out.amount / p.cycleTime) * 60;
}

/**
 * Pose des ateliers de production finale tant que le bilan d'attributs de l'île le permet.
 *
 * `attrsTotal` est le bilan AVANT ateliers (rang de cité compris) ; il est consommé au fur
 * et à mesure. `demand` liste les biens à acheminer, en u/min.
 */
export function planLocalProduction(
  grid: GridShape,
  lookup: DefLookup,
  buildings: PlacedBuilding[],
  roads: RoadTile[],
  residenceIds: ReadonlySet<string>,
  demand: { good: string; perMin: number }[],
  attrsTotal: Readonly<Record<string, number>>,
  opts: LocalProdOptions = {},
): LocalProdResult {
  const W = grid.w, H = grid.h, N = W * H;
  const maxBuildings = opts.maxBuildings ?? 40;
  const out: LocalProdResult = { buildings: [], removed: [], workshops: [], attrsDelta: {}, netPerMin: {}, gaps: [] };

  // --- occupation courante ------------------------------------------------------------
  const roadAt = new Uint8Array(N);
  for (const r of roads) if (r.x >= 0 && r.y >= 0 && r.x < W && r.y < H) roadAt[r.y * W + r.x] = 1;
  const owner = new Int32Array(N).fill(-1);
  const all = [...buildings];
  const stamp = (b: PlacedBuilding, idx: number) => {
    const d = lookup(b.defId);
    if (!d) return;
    const fp = footprintSize(d, b.rotation);
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const x = b.x + i, y = b.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H) owner[y * W + x] = idx;
    }
  };
  all.forEach(stamp);

  // centres des maisons — cibles des effets de zone (portée EUCLIDIENNE)
  const houses = buildings
    .map((b, i) => ({ b, i }))
    .filter((h) => residenceIds.has(h.b.defId))
    .map((h) => {
      const d = lookup(h.b.defId)!;
      const fp = footprintSize(d, h.b.rotation);
      return { uid: h.b.uid, x: h.b.x + fp.w / 2, y: h.b.y + fp.h / 2, alive: true };
    });

  const budget: Record<string, number> = {};
  for (const k of VITAL_ATTRS) budget[k] = attrsTotal[k] ?? 0;
  const removed = new Set<string>();

  /** Effet de zone d'un atelier posé en (x,y) sur les maisons encore debout. */
  const zoneImpact = (def: BuildingDef, x: number, y: number): Record<string, number> => {
    const fx = effectOf(def.id);
    const acc: Record<string, number> = {};
    if (!fx || fx.scope !== "radius") return acc;
    const fp = footprintSize(def, 0);
    const cx = x + fp.w / 2, cy = y + fp.h / 2, r2 = fx.range * fx.range;
    let n = 0;
    for (const h of houses) {
      if (!h.alive) continue;
      const dx = h.x - cx, dy = h.y - cy;
      if (dx * dx + dy * dy <= r2) n++;
    }
    for (const [k, v] of Object.entries(fx.attrs)) acc[k] = v * n;
    return acc;
  };

  /** Emplacement libre ou occupé par des RÉSIDENCES seulement (elles seront rasées). */
  const fits = (def: BuildingDef, x: number, y: number): boolean => {
    const fp = footprintSize(def, 0);
    if (x < 0 || y < 0 || x + fp.w > W || y + fp.h > H) return false;
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
      const c = (y + j) * W + (x + i);
      if (!grid.usable[c] || roadAt[c]) return false;
      const o = owner[c];
      if (o >= 0 && !residenceIds.has(all[o].defId)) return false;
    }
    return true;
  };

  // barycentre des maisons : on construit au plus près du tissu, là où les effets portent
  let gx = 0, gy = 0;
  for (const h of houses) { gx += h.x; gy += h.y; }
  gx = houses.length ? gx / houses.length : W / 2;
  gy = houses.length ? gy / houses.length : H / 2;

  const place = (def: BuildingDef): { x: number; y: number } | null => {
    const maxR = Math.max(W, H);
    for (let r = 0; r <= maxR; r += 2) {
      for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(gx + dx), y = Math.round(gy + dy);
        if (fits(def, x, y)) return { x, y };
      }
    }
    return null;
  };

  // --- biens du manifeste, du plus lourd au plus léger ---------------------------------
  const wanted = [...demand].sort((a, b) => b.perMin - a.perMin || a.good.localeCompare(b.good));
  // La file s'allonge au fil de la remontée de chaîne (cf. plus bas). `queued` évite de
  // traiter deux fois un bien réclamé par plusieurs ateliers, et coupe les cycles.
  const queued = new Set(wanted.map((d) => d.good));
  for (const d of wanted) {
    if (out.buildings.length >= maxBuildings) break;
    // `pickProducerInWorld`, pas `pickProducer` : ce dernier RETOMBE sur l'autre monde
    // quand la région ne produit pas le bien. On posait ainsi 12 ateliers romains sur une
    // île celtique — non constructibles en jeu, et réclamant une main-d'œuvre plébéienne
    // qu'Albion ne peut pas fournir. Le bien reste simplement au manifeste d'import.
    const defId = opts.region ? pickProducerInWorld(d.good, opts.region) : undefined;
    if (!defId) continue;
    const def = lookup(defId);
    if (!def || def.slotType) continue; // les productions à emplacement passent par slotPlan
    const rate = ratePerMin(defId, d.good);
    if (rate <= 0) continue;
    const copies = Math.min(4, Math.ceil(d.perMin / rate)); // borné : on ne bétonne pas l'île
    const ws: LocalWorkshop = {
      defId, name: def.name, good: d.good, goodName: goodName(d.good),
      perMin: 0, copies: 0, attrs: {}, housesLost: 0, inputs: [],
    };
    for (let c = 0; c < copies; c++) {
      if (out.buildings.length >= maxBuildings) break;
      const pos = place(def);
      if (!pos) break;
      const impact = zoneImpact(def, pos.x, pos.y);
      // DEVIS DE MAIN-D'ŒUVRE : ce que coûterait, en attributs, la rétrogradation des maisons
      // nécessaires pour armer cet atelier. `null` = demande insatisfiable (palier absent de
      // l'île, ou plus aucune maison convertible) — on renonce à ce bien.
      const wf = opts.workforce?.quote([defId]);
      if (opts.workforce && !wf) break;
      // Maisons qui disparaîtraient sous l'emprise — repérées AVANT de trancher : elles
      // emportent leurs propres bonus d'attributs, et les ignorer faisait dépenser un budget
      // déjà consommé. C'est ce qui rendait le plan non viable après coup.
      const fp = footprintSize(def, 0);
      // Un ensemble, pas une liste : une maison 3×3 occupe jusqu'à neuf cases de l'emprise
      // et serait sinon facturée neuf fois.
      const doomedSet = new Set<string>();
      for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) {
        const cell = (pos.y + j) * W + (pos.x + i);
        const o = owner[cell];
        if (o >= 0 && residenceIds.has(all[o].defId) && !removed.has(all[o].uid)) doomedSet.add(all[o].uid);
      }
      const doomed = [...doomedSet];
      const razed = opts.workforce?.razeCost(doomed) ?? {};
      const total = (k: string) => (impact[k] ?? 0) + (wf?.attrs[k] ?? 0) - (razed[k] ?? 0);
      // le budget tiendrait-il ? sinon on renonce à CE bien et on passe au suivant
      const wouldBreak = VITAL_ATTRS.some((k) => budget[k] + total(k) < 0);
      if (wouldBreak) break;
      opts.workforce?.charge([defId]);
      // pose : les résidences sous l'emprise sont rasées
      for (const u of doomed) {
        removed.add(u);
        ws.housesLost++;
        const h = houses.find((x) => x.uid === u);
        if (h) h.alive = false;
      }
      // Le budget encaisse AUSSI le coût des conversions et des maisons rasées. Seul
      // `impact` remonte dans `attrsDelta` : les deux autres sont comptés par le
      // grand-livre au règlement final, les additionner ici les compterait deux fois.
      for (const k of VITAL_ATTRS) budget[k] = (budget[k] ?? 0) + (wf?.attrs[k] ?? 0) - (razed[k] ?? 0);
      const b: PlacedBuilding = { uid: uid("prod"), defId, x: pos.x, y: pos.y, rotation: 0, locked: false };
      const idx = all.length;
      all.push(b);
      stamp(b, idx);
      out.buildings.push(b);
      for (const [k, v] of Object.entries(impact)) {
        budget[k] = (budget[k] ?? 0) + v;
        out.attrsDelta[k] = (out.attrsDelta[k] ?? 0) + v;
        ws.attrs[k] = (ws.attrs[k] ?? 0) + v;
      }
      ws.copies++;
      ws.perMin += rate;
    }
    if (!ws.copies) continue;

    // ═══ REMONTÉE DE CHAÎNE ═══════════════════════════════════════════════════════════
    // Un atelier consomme. Produire des tuniques sur place, c'est cesser d'importer des
    // tuniques et commencer à importer de la laine — et jusqu'ici seule la première moitié
    // était comptée. On inscrit donc l'intrant au bilan, ET on l'ajoute à la file : s'il
    // reste du budget et de la place, son propre producteur sera posé au tour suivant, ce
    // qui referme la chaîne d'un cran de plus. Le budget d'attributs, le quota de bâtiments
    // et la main-d'œuvre bornent naturellement la remontée.
    out.netPerMin[ws.good] = (out.netPerMin[ws.good] ?? 0) + ws.perMin;
    const prod = economy.buildingProd[defId];
    if (prod?.cycleTime) {
      for (const inp of prod.inputs) {
        const need = (inp.amount / prod.cycleTime) * 60 * ws.copies;
        if (need <= 0) continue;
        ws.inputs.push({ good: inp.good, perMin: Math.round(need * 100) / 100 });
        out.netPerMin[inp.good] = (out.netPerMin[inp.good] ?? 0) - need;
        if (!queued.has(inp.good)) { queued.add(inp.good); wanted.push({ good: inp.good, perMin: need }); }
      }
    }
    out.workshops.push(ws);
  }

  out.removed = [...removed];
  if (!out.workshops.length) out.gaps.push("Aucun atelier local posable (place ou budget d'attributs insuffisant)");
  return out;
}
