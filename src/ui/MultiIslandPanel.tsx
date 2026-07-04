import { useMemo, useRef, useState } from "react";
import { islands } from "../data/islands";
import { buildIslandGrid } from "../data/islandGrid";
import { useStore } from "../state/store";
import { economy, tiers } from "../economy/economy";
import { emptyProfile } from "../economy/resources";
import { ResourceSelector } from "./ResourceSelector";
import { RunPanel } from "./components/RunPanel";
import { runMultiIslandPlan } from "../optimizer/runMultiIslandPlan";
import type { Assignment, IslandInput, MultiIslandResult, Role } from "../optimizer/multiIslandPlan";
import type { OptimizeResult } from "../optimizer/types";

const targetTiers = tiers.filter((t) => t.residenceId);
const goodName = (g: string) => economy.goodNames[g] || g;

/** Mappe un plan d'île (import ou production) vers un OptimizeResult applicable à l'éditeur. */
function planToOptimizeResult(plan: NonNullable<Assignment["plan"]>): OptimizeResult {
  const aqueducts = "aqueducts" in plan ? plan.aqueducts : undefined;
  return {
    buildings: plan.buildings, roads: plan.roads, fields: plan.fields, aqueducts,
    placed: plan.buildings.length, requested: plan.buildings.length,
    placedByDef: {}, score: 0,
    breakdown: { count: plan.buildings.length, roadLen: plan.roads.length, bboxArea: 0, coverage: 0 },
  };
}

/** Mode MULTI-ÎLES : party board (îles + ressources à chips) → assignation des rôles +
 *  dimensionnement/placement (RunPanel partagé) + drill-down « Voir » vers l'éditeur. */
export function MultiIslandPanel() {
  const catalog = useStore((s) => s.catalog);
  const partyIslands = useStore((s) => s.partyIslands);
  const islandProfiles = useStore((s) => s.islandProfiles);
  const addPartyIsland = useStore((s) => s.addPartyIsland);
  const removePartyIsland = useStore((s) => s.removePartyIsland);
  const setIslandProfile = useStore((s) => s.setIslandProfile);
  const loadIsland = useStore((s) => s.loadIsland);
  const applyOptimization = useStore((s) => s.applyOptimization);
  const setUiMode = useStore((s) => s.setUiMode);

  const [tierGuid, setTierGuid] = useState(targetTiers[targetTiers.length - 1]?.guid ?? "");
  const [pins, setPins] = useState<Record<string, Role | "auto">>({});
  const [result, setResult] = useState<MultiIslandResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const available = useMemo(() => islands.filter((i) => !partyIslands.includes(i.id)), [partyIslands]);
  const nameOf = (id: string) => islands.find((i) => i.id === id)?.name ?? id;
  const sizeOf = (id: string) => { const i = islands.find((x) => x.id === id); return i ? `${i.size.w}×${i.size.h}` : ""; };

  const run = (mode: "dimension" | "place") => {
    setRunning(true); setError(null); setResult(null);
    cancelRef.current?.();
    const islandInputs: IslandInput[] = partyIslands
      .map((id) => {
        const grid = buildIslandGrid(id);
        if (!grid) return null;
        const pin = pins[id];
        return { islandId: id, grid, profile: islandProfiles[id] ?? emptyProfile(), ...(pin && pin !== "auto" ? { pinnedRole: pin } : {}) } satisfies IslandInput;
      })
      .filter((i): i is IslandInput => i !== null);
    const { promise, cancel } = runMultiIslandPlan({ catalog, tierGuid, mode, islands: islandInputs });
    cancelRef.current = cancel;
    promise
      .then(setResult)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setRunning(false); cancelRef.current = null; });
  };

  const drillDown = (a: Assignment) => {
    if (!a.plan) return;
    loadIsland(a.islandId);
    applyOptimization(planToOptimizeResult(a.plan));
    setUiMode("editor");
  };

  return (
    <div className="pane-full">
      <h3>🏝 Multi-îles</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        Déclare les îles de ta partie et leurs ressources. Le programme assigne les rôles
        (population / production, contrainte par les ressources déclarées) pour maximiser la
        population totale.
      </p>

      <div className="row" style={{ marginTop: 12 }}>
        <label className="field" style={{ flex: 2 }}>
          <span>Ajouter une île</span>
          <select value="" onChange={(e) => { if (e.target.value) addPartyIsland(e.target.value); }}>
            <option value="">— choisir —</option>
            {available.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.size.w}×{i.size.h})</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Tier-cible</span>
          <select value={tierGuid} onChange={(e) => setTierGuid(e.target.value)}>
            {targetTiers.map((t) => <option key={t.guid} value={t.guid}>{t.name}</option>)}
          </select>
        </label>
      </div>

      {partyIslands.length === 0 && <p className="muted">Aucune île dans la partie — ajoute-en une ci-dessus.</p>}
      {partyIslands.map((id) => (
        <div key={id} className="party-card">
          <div className="party-head">
            <b>{nameOf(id)} <span className="muted">{sizeOf(id)}</span></b>
            <span style={{ display: "flex", gap: 8 }}>
              <select value={pins[id] ?? "auto"} onChange={(e) => setPins((p) => ({ ...p, [id]: e.target.value as Role | "auto" }))}>
                <option value="auto">rôle auto</option>
                <option value="population">forcer population</option>
                <option value="production">forcer production</option>
                <option value="unused">exclure</option>
              </select>
              <button className="btn-ghost" onClick={() => removePartyIsland(id)} title="Retirer de la partie" aria-label="Retirer">✕</button>
            </span>
          </div>
          <ResourceSelector value={islandProfiles[id] ?? emptyProfile()} onChange={(pr) => setIslandProfile(id, pr)} />
        </div>
      ))}

      <RunPanel running={running} error={error} actions={[
        { label: "Dimensionner", onClick: () => run("dimension"), disabled: !partyIslands.length },
        { label: "Placer tout", primary: true, onClick: () => run("place"), disabled: !partyIslands.length },
      ]} />

      {result && !running && (
        <div className="result">
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-label">Population totale</div>
              <div className="metric-val good">{result.totalPopulation.toLocaleString("fr")}</div>
            </div>
          </div>
          <table>
            <thead><tr><th>Île</th><th>Rôle</th><th>Détail</th><th></th></tr></thead>
            <tbody>
              {result.assignments.map((a) => (
                <tr key={a.islandId}>
                  <td>{nameOf(a.islandId)}</td>
                  <td><span className={"role-pill role-" + a.role}>{a.role}</span></td>
                  <td>{a.role === "population"
                    ? `${(a.residents ?? 0).toLocaleString("fr")} hab.`
                    : a.role === "production"
                      ? ((a.producedGoods ?? []).map(goodName).join(", ") || "—")
                      : "—"}</td>
                  <td>{a.plan && <button className="btn-ghost" onClick={() => drillDown(a)} title="Charger le layout dans l'éditeur">Voir →</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.gaps.length > 0 && <ul className="gap-list">{result.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
