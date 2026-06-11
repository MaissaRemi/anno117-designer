import { useState } from "react";
import { useStore } from "../state/store";
import { tiers } from "../economy/economy";
import { runIslandPlan } from "../optimizer/runIslandPlan";
import type { IslandPlanResult } from "../optimizer/islandPlan";

interface Props {
  onClose: () => void;
}

const ATTR_FR: Record<string, string> = {
  Money: "💰 Argent",
  Happiness: "🙂 Bonheur",
  Prestige: "🏛 Prestige",
  Knowledge: "📚 Connaissance",
  Belief: "🙏 Croyance",
  Health: "❤ Santé",
  FireSafety: "🔥 Sécurité incendie",
};

// tiers ayant une résidence = cibles valides
const targetTiers = tiers.filter((t) => t.residenceId);

export function IslandPlanner({ onClose }: Props) {
  const applyOptimization = useStore((s) => s.applyOptimization);

  const [tierGuid, setTierGuid] = useState(targetTiers[targetTiers.length - 1]?.guid ?? "");
  const [mode, setMode] = useState<"import" | "local">("import");
  const [needMode, setNeedMode] = useState<"all" | "thresholds">("all");
  // 80 % par défaut : sur les vrais contours d'île, exiger 100 % des 11 services
  // T4 partout coûte ~3× moins de maisons (le rim n'a pas la place pour les wonders)
  const [floor, setFloor] = useState(80);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [result, setResult] = useState<IslandPlanResult | null>(null);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);

  const usable = useStore((s) => s.layout.grid.usable.filter(Boolean).length);

  const run = () => {
    const s = useStore.getState();
    setRunning(true);
    setResult(null);
    setPlaceMsg(null);
    setProgress(null);
    const { promise } = runIslandPlan(
      { catalog: s.catalog, grid: s.layout.grid, tierGuid, coverageFloor: floor / 100, needMode },
      (step, total) => setProgress({ step, total }),
    );
    promise
      .then(setResult)
      .catch((e) => alert(String(e)))
      .finally(() => setRunning(false));
  };

  const place = () => {
    if (!result) return;
    applyOptimization({
      buildings: result.buildings,
      roads: result.roads,
      fields: result.fields,
      placed: result.buildings.length,
      requested: result.buildings.length,
      placedByDef: {},
      score: 0,
      breakdown: { count: result.buildings.length, roadLen: result.roads.length, bboxArea: 0, coverage: result.coverageMin / 100 },
    });
    setPlaceMsg("✓ Placé sur l'île.");
  };

  const color = (pct: number) => (pct >= 100 ? "#8bc34a" : pct >= 75 ? "#ffcc66" : "#ff8a85");

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal opt" onClick={(e) => e.stopPropagation()}>
        <h3>🏛 Plan d'île</h3>
        <p className="muted">
          Cale le <b>maximum d'habitants</b> du tier-cible sur l'île chargée ({usable} cases de terre),
          en plaçant tous les services publics pour les couvrir (best-effort). En mode import, les biens
          sont produits ailleurs : la sortie liste le <b>débit à acheminer</b> (u/min).
        </p>

        <div className="row">
          <label style={{ flex: 1 }}>
            Tier-cible
            <select value={tierGuid} onChange={(e) => setTierGuid(e.target.value)} style={{ width: "100%" }}>
              {targetTiers.map((t) => (
                <option key={t.guid} value={t.guid}>
                  {t.name} ({t.region}) · cap {t.capacityDefault}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as "import" | "local")} style={{ width: "100%" }}>
              <option value="import">Import (prod ailleurs)</option>
              <option value="local" disabled>
                Auto-suffisant (phase 2)
              </option>
            </select>
          </label>
        </div>

        <div className="row">
          <label style={{ flex: 1 }}>
            Besoins
            <select value={needMode} onChange={(e) => setNeedMode(e.target.value as "all" | "thresholds")} style={{ width: "100%" }}>
              <option value="all">Complets (max bonus/maison)</option>
              <option value="thresholds">Seuils d'upgrade (min services → + de maisons)</option>
            </select>
          </label>
        </div>

        <label className="slider">
          <span>Couverture visée</span>
          <input type="range" min={50} max={100} step={5} value={floor} onChange={(e) => setFloor(parseInt(e.target.value))} />
          <span className="muted">{floor}%</span>
        </label>

        {running && (
          <div className="opt-progress">
            Recherche du maximum… {progress ? `${progress.step}/${progress.total}` : ""}
          </div>
        )}

        {result && !running && (
          <div className="opt-result">
            <div style={{ marginBottom: 6 }}>
              <b>{result.residents.toLocaleString("fr")} habitants</b> ({result.tierName}) ·{" "}
              {result.houses} maisons · couverture min{" "}
              <b style={{ color: color(result.coverageMin) }}>{result.coverageMin}%</b>
              {!result.feasible && <span style={{ color: "#ffcc66" }}> (best-effort)</span>}
            </div>
            <div style={{ marginBottom: 6 }}>
              💰 net <span style={{ color: result.money.net >= 0 ? "#8bc34a" : "#ff8a85" }}>
                {result.money.net >= 0 ? "+" : ""}{result.money.net.toLocaleString("fr")}/min
              </span>{" "}
              <span className="muted">(taxe {result.money.gross.toLocaleString("fr")} − entretien {result.money.upkeep.toLocaleString("fr")})</span>
            </div>

            <b>📦 À acheminer ({result.importGoods.length} biens)</b>
            <ul className="bilan">
              {result.importGoods.slice(0, 30).map((g) => (
                <li key={g.good}>
                  {g.perMin.toLocaleString("fr")}/min · {g.name}
                </li>
              ))}
            </ul>

            {Object.keys(result.attributes).length > 0 && (
              <>
                <b>Bonus cumulés</b>
                <ul className="bilan">
                  {Object.entries(ATTR_FR).map(([k, label]) =>
                    result.attributes[k] ? (
                      <li key={k}>
                        {label} : {result.attributes[k].toLocaleString("fr")}{k === "Money" ? "/min" : ""}
                      </li>
                    ) : null,
                  )}
                </ul>
              </>
            )}

            {result.gaps.length > 0 && (
              <div className="warn">
                ⚠ Trous : {result.gaps.join(" · ")}
              </div>
            )}
            {placeMsg && <div style={{ marginTop: 6 }}>{placeMsg}</div>}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>Fermer</button>
          <button onClick={run} disabled={running || !tierGuid}>
            {running ? "Calcul…" : "Calculer"}
          </button>
          <button className="primary" onClick={place} disabled={!result || running}>
            Placer sur l'île
          </button>
        </div>
      </div>
    </div>
  );
}
