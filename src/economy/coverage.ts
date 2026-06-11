import { computeRadiusCoverage, type DefLookup } from "../engine/rules";
import { footprintCells } from "../engine/geometry";
import type { Layout } from "../model/types";
import { economy } from "./economy";

export interface ServiceCoverage {
  serviceId: string; // defId du bâtiment de service
  name: string;
  range: number; // portée (streetRange ou radius.range)
  hasRadius: boolean; // false => pas de rayon dans les données (non analysable)
  present: number; // nb de bâtiments de ce service posés
  housesRequiring: number; // résidences dont le tier exige ce service
  housesCovered: number;
  pct: number; // 0..100
  uncovered: string[]; // cellKeys des cases de résidence NON couvertes (surlignage)
}

export interface CoverageReport {
  services: ServiceCoverage[];
  housesTotal: number; // résidences posées
  housesFullyCovered: number; // couvertes par TOUS leurs services (à rayon connu)
  fullyCoveredPct: number;
  uncoveredAny: string[]; // cases de résidence ratées par ≥1 service requis
}

/**
 * Analyse la couverture des services publics : pour chaque type de service requis
 * par les tiers présents, quel % des résidences est dans le rayon (distance-rue),
 * et quelles cases de résidence ne sont couvertes par aucun bâtiment de ce service.
 */
export function analyzeCoverage(
  layout: Layout,
  lookup: DefLookup,
  opts: { euclidean?: boolean } = {},
): CoverageReport {
  // tier par residenceId ; service requis (avec rayon) par tier
  const tierByResidence = new Map<string, (typeof economy.tiers)[number]>();
  for (const t of economy.tiers) if (t.residenceId) tierByResidence.set(t.residenceId, t);

  // couverture (cellKeys) par defId de service = union des bâtiments de ce type
  const cov = computeRadiusCoverage(layout, lookup, opts);
  const coverByService = new Map<string, Set<string>>();
  for (const b of layout.buildings) {
    const set = cov.get(b.uid);
    if (!set) continue;
    let u = coverByService.get(b.defId);
    if (!u) coverByService.set(b.defId, (u = new Set<string>()));
    for (const k of set) u.add(k);
  }
  const presentCount = new Map<string, number>();
  for (const b of layout.buildings) presentCount.set(b.defId, (presentCount.get(b.defId) ?? 0) + 1);

  // résidences posées + leurs cases
  const residences = layout.buildings
    .map((b) => ({ b, tier: tierByResidence.get(b.defId) }))
    .filter((r) => r.tier) as { b: (typeof layout.buildings)[number]; tier: (typeof economy.tiers)[number] }[];
  const housesTotal = residences.length;

  // agrège par service requis
  const svc = new Map<string, ServiceCoverage>();
  const ensure = (id: string): ServiceCoverage => {
    let s = svc.get(id);
    if (!s) {
      const def = lookup(id);
      const range = def?.streetRange || def?.radius?.range || 0;
      svc.set(id, (s = {
        serviceId: id, name: def?.name ?? id, range, hasRadius: range > 0,
        present: presentCount.get(id) ?? 0, housesRequiring: 0, housesCovered: 0, pct: 0, uncovered: [],
      }));
    }
    return s;
  };

  let fullyCovered = 0;
  const uncoveredAnyAll = new Set<string>();

  for (const { b, tier } of residences) {
    const cells = footprintCells(lookup(b.defId)!, b.x, b.y, b.rotation).map((c) => `${c.x},${c.y}`);
    let allOk = true;
    for (const s of tier.services) {
      if (!s.building) continue;
      const rec = ensure(s.building);
      rec.housesRequiring++;
      if (!rec.hasRadius) { allOk = false; continue; } // rayon inconnu -> non analysable
      const union = coverByService.get(s.building);
      const covered = !!union && cells.some((k) => union.has(k));
      if (covered) rec.housesCovered++;
      else {
        allOk = false;
        for (const k of cells) { rec.uncovered.push(k); uncoveredAnyAll.add(k); }
      }
    }
    if (allOk) fullyCovered++;
  }

  for (const s of svc.values()) s.pct = s.housesRequiring ? Math.round((s.housesCovered / s.housesRequiring) * 100) : 100;

  const services = [...svc.values()].sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
  return {
    services,
    housesTotal,
    housesFullyCovered: fullyCovered,
    fullyCoveredPct: housesTotal ? Math.round((fullyCovered / housesTotal) * 100) : 100,
    uncoveredAny: [...uncoveredAnyAll],
  };
}
