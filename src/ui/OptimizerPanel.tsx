import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { runOptimizer } from "../optimizer/runOptimizer";
import { computeChain, mergeItems } from "../optimizer/chain";
import { DEFAULT_WEIGHTS, type OptimizeRequest, type OptimizeResult, type RequestItem, type Weights } from "../optimizer/types";

interface Props {
  onClose: () => void;
}

const WEIGHT_LABELS: { key: keyof Weights; label: string }[] = [
  { key: "count", label: "Max bâtiments" },
  { key: "coverage", label: "Couverture rayon" },
  { key: "compact", label: "Compacité" },
  { key: "roads", label: "Routes min" },
];

export function OptimizerPanel({ onClose }: Props) {
  const catalog = useStore((s) => s.catalog);
  const applyOptimization = useStore((s) => s.applyOptimization);

  const [items, setItems] = useState<RequestItem[]>([]);
  const [pickDef, setPickDef] = useState<string>(catalog[0]?.id ?? "");
  const [pickQty, setPickQty] = useState(10);
  const chainable = useMemo(
    () => catalog.filter((d) => d.production && d.production.inputs.length > 0),
    [catalog],
  );
  const [chainDef, setChainDef] = useState<string>(chainable[0]?.id ?? "");
  const [chainQty, setChainQty] = useState(3);
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
  const [timeSec, setTimeSec] = useState(5);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ best: number; placed: number; requested: number } | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);

  const defName = useMemo(() => new Map(catalog.map((d) => [d.id, d.name])), [catalog]);

  const addItem = () => {
    if (!pickDef || pickQty < 1) return;
    setItems((cur) => {
      const ex = cur.find((i) => i.defId === pickDef);
      if (ex) return cur.map((i) => (i.defId === pickDef ? { ...i, qty: i.qty + pickQty } : i));
      return [...cur, { defId: pickDef, qty: pickQty }];
    });
  };

  const addChain = () => {
    if (!chainDef) return;
    const its = computeChain(catalog, chainDef, chainQty);
    setItems((cur) => mergeItems(cur, its));
  };

  const totalRequested = items.reduce((s, i) => s + i.qty, 0);
  const waterDefs = useMemo(() => new Set(catalog.filter((d) => d.placement === "water").map((d) => d.id)), [catalog]);
  const waterItems = items.filter((i) => waterDefs.has(i.defId));

  const run = () => {
    const s = useStore.getState();
    const layout = s.layout;
    const lockedBuildings = layout.buildings.filter((b) => b.locked);
    const lockedUids = new Set(lockedBuildings.map((b) => b.uid));
    const existingFields = layout.fields.filter((f) => lockedUids.has(f.ownerUid));
    const req: OptimizeRequest = {
      catalog: s.catalog,
      grid: layout.grid,
      lockedBuildings,
      existingRoads: layout.roads.filter((r) => !r.gen), // ignore les routes auto précédentes
      existingFields,
      items,
      weights,
      timeMs: timeSec * 1000,
    };
    setRunning(true);
    setResult(null);
    setProgress(null);
    const { promise } = runOptimizer(req, (p) =>
      setProgress({ best: p.best, placed: p.placed, requested: p.requested }),
    );
    promise
      .then((res) => {
        setResult(res);
        applyOptimization(res);
      })
      .catch((e) => alert(String(e)))
      .finally(() => setRunning(false));
  };

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal opt" onClick={(e) => e.stopPropagation()}>
        <h3>⚙ Optimiseur de disposition</h3>

        <p className="muted">
          Place automatiquement les bâtiments (+ routes + champs) dans la grille, autour des bâtiments
          verrouillés. Conserve les routes déjà dessinées.
        </p>

        <h4>Bâtiments à placer</h4>
        <div className="row">
          <select value={pickDef} onChange={(e) => setPickDef(e.target.value)} style={{ flex: 1 }}>
            {catalog.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.size.w}×{d.size.h})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={pickQty}
            onChange={(e) => setPickQty(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <button onClick={addItem}>+ Ajouter</button>
        </div>

        {chainable.length > 0 && (
          <>
            <h4>… ou ajouter une chaîne de production</h4>
            <div className="row">
              <select value={chainDef} onChange={(e) => setChainDef(e.target.value)} style={{ flex: 1 }}>
                {chainable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={chainQty}
                onChange={(e) => setChainQty(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <button onClick={addChain}>+ Chaîne</button>
            </div>
            <p className="muted">Ajoute le bâtiment final + tout l'amont aux bons ratios.</p>
          </>
        )}

        <div className="opt-items">
          {items.length === 0 && <p className="muted">Aucun bâtiment. Ajoute-en au moins un.</p>}
          {items.map((it) => (
            <div key={it.defId} className="opt-item">
              <span>{defName.get(it.defId) ?? it.defId}</span>
              <span className="muted">×{it.qty}</span>
              <button onClick={() => setItems((c) => c.filter((i) => i.defId !== it.defId))}>✕</button>
            </div>
          ))}
          {items.length > 0 && <div className="muted">Total : {totalRequested}</div>}
          {waterItems.length > 0 && (
            <div className="warn">
              🌊 {waterItems.reduce((s, i) => s + i.qty, 0)} bâtiment(s) côtier(s) (
              {waterItems.map((i) => defName.get(i.defId)).join(", ")}) — l'optimiseur ne place que
              sur la terre ; pose-les à la main sur la mer.
            </div>
          )}
        </div>

        <h4>Objectifs (poids)</h4>
        {WEIGHT_LABELS.map(({ key, label }) => (
          <label key={key} className="slider">
            <span>{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={weights[key]}
              onChange={(e) => setWeights((w) => ({ ...w, [key]: parseFloat(e.target.value) }))}
            />
            <span className="muted">{weights[key].toFixed(1)}</span>
          </label>
        ))}

        <label className="slider">
          <span>Budget temps</span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={timeSec}
            onChange={(e) => setTimeSec(parseInt(e.target.value))}
          />
          <span className="muted">{timeSec}s</span>
        </label>

        {running && progress && (
          <div className="opt-progress">
            Calcul… placés {progress.placed}/{progress.requested} · score {progress.best.toFixed(1)}
          </div>
        )}
        {result && !running && (
          <div className="opt-result">
            ✓ Placés {result.placed}/{result.requested} · routes {result.roads.length} · couverture{" "}
            {(result.breakdown.coverage * 100).toFixed(0)}%
            {result.placed < result.requested && (
              <div className="warn">
                ⚠ {result.requested - result.placed} bâtiment(s) non placé(s) : grille trop petite ou
                trop fragmentée. Agrandis l'île, réduis la quantité, ou augmente le budget temps.
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>
            Fermer
          </button>
          <button className="primary" onClick={run} disabled={running || items.length === 0}>
            {running ? "Calcul…" : "Lancer"}
          </button>
        </div>
      </div>
    </div>
  );
}
