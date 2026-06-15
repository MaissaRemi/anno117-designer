import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { economy, tiers } from "../economy/economy";
import { runIslandPlan, type AnyIslandPlanResult } from "../optimizer/runIslandPlan";

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
  const [mode, setMode] = useState<"population" | "production">("population");
  const [needMode, setNeedMode] = useState<"all" | "thresholds">("all");
  // 80 % par défaut : sur les vrais contours d'île, exiger 100 % des 11 services
  // T4 partout coûte ~3× moins de maisons (le rim n'a pas la place pour les wonders)
  const [floor, setFloor] = useState(80);
  // défaut = premier bien produisible, fixé UNE fois (l'affiché == l'envoyé)
  const [prodGood, setProdGood] = useState(() => {
    const first = Object.keys(economy.producers)
      .map((g) => ({ guid: g, name: economy.goodNames[g] || g }))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    return first?.guid ?? "";
  });
  const [prodRate, setProdRate] = useState(10);
  const [islandFerts, setIslandFerts] = useState<string[]>([]); // fertilités déclarées de l'île
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [result, setResult] = useState<AnyIslandPlanResult | null>(null);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);

  const usable = useStore((s) => s.layout.grid.usable.filter(Boolean).length);

  // biens produisibles (un producteur connu), triés par nom FR
  const producibleGoods = useMemo(
    () => Object.keys(economy.producers)
      .map((g) => ({ guid: g, name: economy.goodNames[g] || g }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const allFertilities = useMemo(
    () => Object.entries(economy.fertilities).map(([guid, name]) => ({ guid, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const run = () => {
    const s = useStore.getState();
    setRunning(true);
    setResult(null);
    setPlaceMsg(null);
    setProgress(null);
    const { promise } = runIslandPlan(
      {
        catalog: s.catalog, grid: s.layout.grid, mode, tierGuid,
        coverageFloor: floor / 100, needMode,
        // params production joints seulement quand ils servent
        ...(mode === "production"
          ? { productionGood: prodGood, productionRate: prodRate, islandFertilities: islandFerts.length ? islandFerts : undefined }
          : {}),
      },
      (step, total) => setProgress({ step, total }),
    );
    promise
      .then(setResult)
      .catch((e) => alert(String(e)))
      .finally(() => setRunning(false));
  };

  const place = () => {
    if (!result) return;
    const coverage = result.mode === "import" ? result.coverageMin / 100 : result.prodsCovered / Math.max(1, result.prodsTotal);
    applyOptimization({
      buildings: result.buildings,
      roads: result.roads,
      fields: result.fields,
      aqueducts: result.mode === "import" ? result.aqueducts : undefined,
      placed: result.buildings.length,
      requested: result.buildings.length,
      placedByDef: {},
      score: 0,
      breakdown: { count: result.buildings.length, roadLen: result.roads.length, bboxArea: 0, coverage },
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
            Archetype d'île
            <select value={mode} onChange={(e) => setMode(e.target.value as "population" | "production")} style={{ width: "100%" }}>
              <option value="population">🏠 Population (import des biens)</option>
              <option value="production">🏭 Production (export, main-d'œuvre locale)</option>
            </select>
          </label>
          {mode === "population" && (
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
          )}
        </div>

        {mode === "population" && (
          <>
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
              <span>% maisons au tier-cible</span>
              <input type="range" min={50} max={100} step={5} value={floor} onChange={(e) => setFloor(parseInt(e.target.value))} />
              <span className="muted">{floor}%</span>
            </label>
            <p className="muted" style={{ fontSize: "0.8em", margin: "2px 0 0" }}>
              Fraction des maisons recevant TOUS leurs besoins (montent au tier) ; le reste tient
              au tier inférieur. 100 % = densité moindre (le bord d'île ne loge pas tous les services).
            </p>
          </>
        )}

        {mode === "production" && (
          <div className="row">
            <label style={{ flex: 2 }}>
              Bien à produire
              <select value={prodGood} onChange={(e) => setProdGood(e.target.value)} style={{ width: "100%" }}>
                {producibleGoods.map((g) => (
                  <option key={g.guid} value={g.guid}>{g.name}</option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              Débit (u/min)
              <input
                type="number" min={0.5} step={0.5} value={prodRate}
                onChange={(e) => setProdRate(parseFloat(e.target.value) || 1)}
                style={{ width: "100%" }}
              />
            </label>
          </div>
        )}

        {mode === "production" && (
          <label style={{ display: "block", marginTop: 6 }}>
            Fertilités/gisements de l'île <span className="muted">(vide = ne pas vérifier)</span>
            <select
              multiple value={islandFerts}
              onChange={(e) => setIslandFerts([...e.target.selectedOptions].map((o) => o.value))}
              style={{ width: "100%", height: 90 }}
            >
              {allFertilities.map((f) => <option key={f.guid} value={f.guid}>{f.name}</option>)}
            </select>
          </label>
        )}

        {running && (
          <div className="opt-progress">
            Recherche du maximum… {progress ? `${progress.step}/${progress.total}` : ""}
          </div>
        )}

        {result && !running && result.mode === "import" && (
          <div className="opt-result">
            <div style={{ marginBottom: 6 }}>
              <b>{result.residents.toLocaleString("fr")} habitants</b> ({result.tierName}) ·{" "}
              <b style={{ color: color(result.fullyCoveredPct) }}>{result.fullyCovered}</b>/{result.houses} maisons
              {" "}au tier ({result.fullyCoveredPct}% complètes)
              {!result.feasible && <span style={{ color: "#ffcc66" }}> (best-effort)</span>}
              <div className="muted" style={{ fontSize: "0.85em" }}>
                couverture min par service {result.coverageMin}% · {result.houses - result.fullyCovered} maisons partielles (tier inférieur)
              </div>
            </div>
            <div style={{ marginBottom: 6 }}>
              💰 net <span style={{ color: result.money.net >= 0 ? "#8bc34a" : "#ff8a85" }}>
                {result.money.net >= 0 ? "+" : ""}{result.money.net.toLocaleString("fr")}/min
              </span>{" "}
              <span className="muted">(taxe {result.money.gross.toLocaleString("fr")} − entretien {result.money.upkeep.toLocaleString("fr")})</span>
            </div>

            {result.water && (
              <div style={{ marginBottom: 6 }}>
                💧 Eau : {result.water.sources} source{result.water.sources > 1 ? "s" : ""} ·{" "}
                {result.water.used}/{result.water.capacity} u ·{" "}
                {result.water.consumers.filter((c) => c.connected).length}/{result.water.consumers.length} raccordés
                {result.aqueducts.length > 0 && (
                  <span className="muted"> · {result.aqueducts.length} cases de conduite</span>
                )}
              </div>
            )}

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

        {result && !running && result.mode === "production" && (
          <div className="opt-result">
            <div style={{ marginBottom: 6 }}>
              <b>{result.ratePerMin.toLocaleString("fr")}/min · {economy.goodNames[result.good] || result.good}</b>{" "}
              · {result.prodsTotal} bâtiments de prod · {result.houses} maisons ouvrières
            </div>
            <div style={{ marginBottom: 6 }}>
              🚚 Entrepôts : {result.warehousesPlaced} ·{" "}
              <b style={{ color: color((100 * result.prodsCovered) / Math.max(1, result.prodsTotal)) }}>
                {result.prodsCovered}/{result.prodsTotal}
              </b>{" "}
              prods à portée de charrette
            </div>
            <div style={{ marginBottom: 6 }}>
              💰 net <span style={{ color: result.solution.money.net >= 0 ? "#8bc34a" : "#ff8a85" }}>
                {result.solution.money.net >= 0 ? "+" : ""}{Math.round(result.solution.money.net).toLocaleString("fr")}/min
              </span>{" "}
              <span className="muted">· valeur marchande {Math.round(result.solution.marketValue).toLocaleString("fr")}/min</span>
              {" "}· posés {result.placed}/{result.requested}
            </div>
            <b>👷 Population requise</b>
            <ul className="bilan">
              {Object.entries(result.solution.populationByTier).filter(([, p]) => p > 0).map(([t, p]) => (
                <li key={t}>{tiers.find((x) => x.guid === t)?.name ?? t} : {Math.ceil(p).toLocaleString("fr")}</li>
              ))}
            </ul>
            {result.requiredFertilities.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                🌱 Fertilités requises :{" "}
                {result.requiredFertilities.map((f) => (
                  <span key={f.guid} style={{ color: f.available ? "#8bc34a" : "#ff8a85" }}>
                    {f.available ? "✓" : "✗"} {f.name}{" "}
                  </span>
                ))}
              </div>
            )}
            {result.gaps.length > 0 && (
              <div className="warn">⚠ {result.gaps.join(" · ")}</div>
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
