import { useMemo, useRef, useState } from "react";
import { islands } from "../data/islands";
import { buildIslandGrid } from "../data/islandGrid";
import { useStore } from "../state/store";
import { economy, tiers } from "../economy/economy";
import { emptyProfile } from "../economy/resources";
import { ResourceSelector } from "./ResourceSelector";
import { runMultiIslandPlan } from "../optimizer/runMultiIslandPlan";
import type { IslandInput, MultiIslandResult, Role } from "../optimizer/multiIslandPlan";

const targetTiers = tiers.filter((t) => t.residenceId);

/** Onglet MULTI-ÎLES : déclare ses îles + ressources, laisse le programme assigner les
 *  rôles (population/production) et dimensionner/placer. Réutilise le store party (SP-A),
 *  ResourceSelector, buildIslandGrid et le planner mono-île — zéro duplication. */
export function MultiIslandPanel() {
  const catalog = useStore((s) => s.catalog);
  const partyIslands = useStore((s) => s.partyIslands);
  const islandProfiles = useStore((s) => s.islandProfiles);
  const addPartyIsland = useStore((s) => s.addPartyIsland);
  const removePartyIsland = useStore((s) => s.removePartyIsland);
  const setIslandProfile = useStore((s) => s.setIslandProfile);

  const [tierGuid, setTierGuid] = useState(targetTiers[targetTiers.length - 1]?.guid ?? "");
  const [pins, setPins] = useState<Record<string, Role | "auto">>({});
  const [result, setResult] = useState<MultiIslandResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const available = useMemo(() => islands.filter((i) => !partyIslands.includes(i.id)), [partyIslands]);
  const nameOf = (id: string) => islands.find((i) => i.id === id)?.name ?? id;

  const run = (mode: "dimension" | "place") => {
    setRunning(true); setError(null); setResult(null);
    cancelRef.current?.();
    const islandInputs: IslandInput[] = partyIslands
      .map((id) => {
        const grid = buildIslandGrid(id);
        if (!grid) return null;
        const pin = pins[id];
        return {
          islandId: id, grid, profile: islandProfiles[id] ?? emptyProfile(),
          ...(pin && pin !== "auto" ? { pinnedRole: pin } : {}),
        } satisfies IslandInput;
      })
      .filter((i): i is IslandInput => i !== null);
    const { promise, cancel } = runMultiIslandPlan({ catalog, tierGuid, mode, islands: islandInputs });
    cancelRef.current = cancel;
    promise
      .then(setResult)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setRunning(false); cancelRef.current = null; });
  };

  return (
    <div className="multi-island" style={{ padding: 16, overflow: "auto" }}>
      <h3>🏝🏝 Multi-îles</h3>
      <p className="muted">
        Déclare les îles de ta partie et leurs ressources. Le programme assigne les rôles
        (population / production) pour maximiser la population totale, la production étant
        contrainte par les ressources déclarées de chaque île.
      </p>

      <div className="row">
        <label style={{ flex: 2 }}>
          Ajouter une île
          <select value="" onChange={(e) => { if (e.target.value) addPartyIsland(e.target.value); }} style={{ width: "100%" }}>
            <option value="">— choisir —</option>
            {available.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.size.w}×{i.size.h})</option>)}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Tier-cible
          <select value={tierGuid} onChange={(e) => setTierGuid(e.target.value)} style={{ width: "100%" }}>
            {targetTiers.map((t) => <option key={t.guid} value={t.guid}>{t.name}</option>)}
          </select>
        </label>
      </div>

      {partyIslands.length === 0 && <p className="muted">Aucune île dans la partie — ajoute-en une.</p>}
      {partyIslands.map((id) => (
        <div key={id} className="island-card" style={{ border: "1px solid var(--border,#333)", borderRadius: 8, padding: 8, margin: "8px 0" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <b>{nameOf(id)}</b>
            <span>
              <select value={pins[id] ?? "auto"} onChange={(e) => setPins((p) => ({ ...p, [id]: e.target.value as Role | "auto" }))}>
                <option value="auto">rôle auto</option>
                <option value="population">forcer population</option>
                <option value="production">forcer production</option>
                <option value="unused">exclure</option>
              </select>
              <button onClick={() => removePartyIsland(id)} title="Retirer de la partie" style={{ marginLeft: 6 }}>✕</button>
            </span>
          </div>
          <ResourceSelector value={islandProfiles[id] ?? emptyProfile()} onChange={(pr) => setIslandProfile(id, pr)} />
        </div>
      ))}

      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button onClick={() => run("dimension")} disabled={running || !partyIslands.length}>Dimensionner</button>
        <button className="primary" onClick={() => run("place")} disabled={running || !partyIslands.length}>Placer tout</button>
      </div>

      {running && <div className="opt-progress">Calcul multi-îles…</div>}
      {error && <div className="warn">⚠ {error}</div>}
      {result && !running && (
        <div className="opt-result" style={{ marginTop: 8 }}>
          <b>Population totale : {result.totalPopulation.toLocaleString("fr")} habitants</b>
          <table style={{ width: "100%", marginTop: 6 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Île</th><th>Rôle</th><th style={{ textAlign: "left" }}>Détail</th></tr></thead>
            <tbody>
              {result.assignments.map((a) => (
                <tr key={a.islandId}>
                  <td>{nameOf(a.islandId)}</td>
                  <td style={{ textAlign: "center" }}>{a.role}</td>
                  <td>{a.role === "population"
                    ? `${(a.residents ?? 0).toLocaleString("fr")} hab.`
                    : a.role === "production"
                      ? (a.producedGoods ?? []).map((g) => economyGoodName(g)).join(", ") || "—"
                      : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.gaps.length > 0 && (
            <div className="warn" style={{ marginTop: 6 }}>⚠ {result.gaps.join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

const economyGoodName = (g: string) => economy.goodNames[g] || g;
