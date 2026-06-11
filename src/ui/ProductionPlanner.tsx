import { useMemo, useState } from "react";
import { economy, goodName } from "../economy/economy";
import { solve, type SolveResult } from "../economy/solve";
import { useStore } from "../state/store";
import { runOptimizer } from "../optimizer/runOptimizer";
import { DEFAULT_WEIGHTS, type OptimizeRequest } from "../optimizer/types";

interface Props {
  onClose: () => void;
}

interface Target {
  good: string;
  rate: number;
}

export function ProductionPlanner({ onClose }: Props) {
  const catalog = useStore((s) => s.catalog);
  const applyOptimization = useStore((s) => s.applyOptimization);
  const defName = useMemo(() => new Map(catalog.map((d) => [d.id, d.name])), [catalog]);

  const goods = useMemo(
    () =>
      Object.keys(economy.producers)
        .map((g) => ({ good: g, name: goodName(g) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const [targets, setTargets] = useState<Target[]>([]);
  const [pickGood, setPickGood] = useState(goods[0]?.good ?? "");
  const [pickRate, setPickRate] = useState(5);
  const [includeWorkforce, setIncludeWorkforce] = useState(true);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [running, setRunning] = useState(false);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);

  const addTarget = () => {
    setTargets((cur) => {
      const ex = cur.find((t) => t.good === pickGood);
      if (ex) return cur.map((t) => (t.good === pickGood ? { ...t, rate: t.rate + pickRate } : t));
      return [...cur, { good: pickGood, rate: pickRate }];
    });
  };

  const compute = () => {
    const extra: Record<string, number> = {};
    for (const t of targets) extra[t.good] = (extra[t.good] || 0) + t.rate;
    setResult(
      solve([], { includeProduction: true, includeServices: includeWorkforce, capacities: {}, includeWorkforce }, extra),
    );
    setPlaceMsg(null);
  };

  const place = () => {
    if (!result) return;
    const s = useStore.getState();
    const layout = s.layout;
    const locked = layout.buildings.filter((b) => b.locked);
    const lockedUids = new Set(locked.map((b) => b.uid));
    const req: OptimizeRequest = {
      catalog: s.catalog,
      grid: layout.grid,
      lockedBuildings: locked,
      existingRoads: layout.roads.filter((r) => !r.gen),
      existingFields: layout.fields.filter((f) => lockedUids.has(f.ownerUid)),
      items: result.items,
      weights: { ...DEFAULT_WEIGHTS },
      timeMs: 8000,
    };
    setRunning(true);
    setPlaceMsg("Placement…");
    runOptimizer(req)
      .promise.then((res) => {
        applyOptimization(res);
        setPlaceMsg(`✓ Placés ${res.placed}/${res.requested}.`);
      })
      .catch((e) => setPlaceMsg(String(e)))
      .finally(() => setRunning(false));
  };

  const totalItems = result ? result.items.reduce((s, i) => s + i.qty, 0) : 0;

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal opt" onClick={(e) => e.stopPropagation()}>
        <h3>🏭 Objectif de production</h3>
        <p className="muted">
          Cible un débit de biens (unités/min). L'app déduit les bâtiments de production + chaînes
          amont, et (option) la main-d'œuvre et les résidents pour les faire tourner.
        </p>

        <div className="row">
          <select value={pickGood} onChange={(e) => setPickGood(e.target.value)} style={{ flex: 1 }}>
            {goods.map((g) => (
              <option key={g.good} value={g.good}>
                {g.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={pickRate}
            onChange={(e) => setPickRate(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
          />
          <span className="muted">/min</span>
          <button onClick={addTarget}>+ Ajouter</button>
        </div>

        <div className="opt-items">
          {targets.length === 0 && <p className="muted">Ajoute au moins un bien.</p>}
          {targets.map((t) => (
            <div key={t.good} className="opt-item">
              <span>{goodName(t.good)}</span>
              <span className="muted">{t.rate}/min</span>
              <button onClick={() => setTargets((c) => c.filter((x) => x.good !== t.good))}>✕</button>
            </div>
          ))}
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={includeWorkforce} onChange={(e) => setIncludeWorkforce(e.target.checked)} />
          Inclure main-d'œuvre + résidents (cascade)
        </label>

        <div className="modal-actions">
          <button onClick={compute} disabled={targets.length === 0}>Calculer</button>
        </div>

        {result && (
          <div className="opt-result">
            {!result.converged && (
              <div style={{ color: "#ffcc66", marginBottom: 6 }}>
                ⚠ Cascade main-d'œuvre instable — bilan des besoins directs affiché.
              </div>
            )}
            <div style={{ marginBottom: 6 }}>
              <b>💰 Économie</b> : net{" "}
              <span style={{ color: result.money.net >= 0 ? "#8bc34a" : "#ff8a85" }}>
                {result.money.net >= 0 ? "+" : ""}
                {result.money.net.toLocaleString("fr")}/min
              </span>{" "}
              <span className="muted">
                (taxe {result.money.gross.toLocaleString("fr")} − entretien {result.money.upkeep.toLocaleString("fr")})
              </span>
              {result.marketValue > 0 && (
                <div className="muted" style={{ fontSize: "0.9em" }}>
                  Valeur marchande des biens : ~{result.marketValue.toLocaleString("fr")}/min
                  (le net ci-dessus = taxe seule ; la vente des biens n'y est pas incluse)
                </div>
              )}
            </div>
            {includeWorkforce && (
              <>
                <b>Résidents requis</b>
                <ul className="bilan">
                  {economy.tiers
                    .filter((t) => (result.populationByTier[t.guid] || 0) >= 1)
                    .map((t) => (
                      <li key={t.guid}>
                        {t.name} : {Math.round(result.populationByTier[t.guid])} ({result.residencesByTier[t.guid] || 0} rés.)
                      </li>
                    ))}
                </ul>
              </>
            )}
            <b>Bâtiments ({totalItems})</b>
            <ul className="bilan">
              {result.items
                .slice()
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 30)
                .map((it) => (
                  <li key={it.defId}>
                    {it.qty}× {defName.get(it.defId) ?? it.defId}
                  </li>
                ))}
            </ul>
            {placeMsg && <div style={{ marginTop: 6 }}>{placeMsg}</div>}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>Fermer</button>
          <button className="primary" onClick={place} disabled={!result || running}>
            {running ? "Placement…" : "Placer sur l'île"}
          </button>
        </div>
      </div>
    </div>
  );
}
