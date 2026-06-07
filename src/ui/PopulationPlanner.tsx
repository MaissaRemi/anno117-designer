import { useMemo, useState } from "react";
import { tiers } from "../economy/economy";
import { solve, type PopTarget, type SolveResult } from "../economy/solve";
import { useStore } from "../state/store";
import { runOptimizer } from "../optimizer/runOptimizer";
import { DEFAULT_WEIGHTS, type OptimizeRequest } from "../optimizer/types";

interface Props {
  onClose: () => void;
}

export function PopulationPlanner({ onClose }: Props) {
  const catalog = useStore((s) => s.catalog);
  const applyOptimization = useStore((s) => s.applyOptimization);
  const defName = useMemo(() => new Map(catalog.map((d) => [d.id, d.name])), [catalog]);

  const [targets, setTargets] = useState<PopTarget[]>([]);
  const [tier, setTier] = useState(tiers[0]?.guid ?? "");
  const [pop, setPop] = useState(10000);
  const [includeProduction, setIncludeProduction] = useState(true);
  const [includeServices, setIncludeServices] = useState(true);
  const [optimizeNeeds, setOptimizeNeeds] = useState(false);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [running, setRunning] = useState(false);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);

  const addTarget = () => {
    setTargets((cur) => {
      const ex = cur.find((t) => t.tier === tier);
      if (ex) return cur.map((t) => (t.tier === tier ? { ...t, pop: t.pop + pop } : t));
      return [...cur, { tier, pop }];
    });
  };

  const compute = () => {
    setResult(solve(targets, { includeProduction, includeServices, optimizeNeeds, capacities: {} }));
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
    setPlaceMsg("Placement en cours…");
    runOptimizer(req)
      .promise.then((res) => {
        applyOptimization(res);
        setPlaceMsg(`✓ Placés ${res.placed}/${res.requested} bâtiments.`);
      })
      .catch((e) => setPlaceMsg(String(e)))
      .finally(() => setRunning(false));
  };

  const tierName = (g: string) => tiers.find((t) => t.guid === g)?.name ?? g;
  const totalItems = result ? result.items.reduce((s, i) => s + i.qty, 0) : 0;

  // bonus cumulés (attribut/maison × nb de maisons), maison pleine
  const attrTotals: Record<string, number> = {};
  if (result) {
    for (const t of tiers) {
      const res = result.residencesByTier[t.guid] || 0;
      if (!res) continue;
      for (const [k, v] of Object.entries(t.perHouse || {})) {
        attrTotals[k] = (attrTotals[k] || 0) + v * res;
      }
    }
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

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal opt" onClick={(e) => e.stopPropagation()}>
        <h3>👥 Planificateur de population</h3>
        <p className="muted">
          Fixe une population cible : le modèle calcule les besoins, la main-d'œuvre en cascade, les
          bâtiments de production et d'influence, puis place le tout sur l'île.
        </p>

        <h4>Population cible</h4>
        <div className="row">
          <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ flex: 1 }}>
            {tiers.map((t) => (
              <option key={t.guid} value={t.guid}>
                {t.name} ({t.region})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={pop}
            onChange={(e) => setPop(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <button onClick={addTarget}>+ Ajouter</button>
        </div>
        <div className="opt-items">
          {targets.length === 0 && <p className="muted">Ajoute au moins une cible.</p>}
          {targets.map((t) => (
            <div key={t.tier} className="opt-item">
              <span>{tierName(t.tier)}</span>
              <span className="muted">{t.pop} hab</span>
              <button onClick={() => setTargets((c) => c.filter((x) => x.tier !== t.tier))}>✕</button>
            </div>
          ))}
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={includeProduction} onChange={(e) => setIncludeProduction(e.target.checked)} />
          Inclure la production (cascade main-d'œuvre)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={includeServices} onChange={(e) => setIncludeServices(e.target.checked)} />
          Inclure les services (besoins biens + services)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={optimizeNeeds} onChange={(e) => setOptimizeNeeds(e.target.checked)} />
          Max économie (ne remplir que les besoins rentables)
        </label>

        <div className="modal-actions">
          <button onClick={compute} disabled={targets.length === 0}>Calculer</button>
        </div>

        {result && (
          <div className="opt-result">
            {!result.converged && (
              <div style={{ color: "#ffcc66", marginBottom: 6 }}>
                ⚠ Cascade main-d'œuvre instable — bilan des besoins directs affiché (population = cible).
              </div>
            )}
            <div style={{ marginBottom: 6 }}>
              <b>💰 Économie</b> : net{" "}
              <span style={{ color: result.money.net >= 0 ? "#8bc34a" : "#ff8a85" }}>
                {result.money.net >= 0 ? "+" : ""}
                {result.money.net.toLocaleString("fr")}/min
              </span>{" "}
              <span className="muted">
                (taxe {result.money.gross.toLocaleString("fr")} − entretien{" "}
                {result.money.upkeep.toLocaleString("fr")})
              </span>
            </div>
            <b>Population</b>
            <ul className="bilan">
              {tiers
                .filter((t) => (result.populationByTier[t.guid] || 0) >= 1)
                .map((t) => (
                  <li key={t.guid}>
                    {t.name} : {Math.round(result.populationByTier[t.guid])} hab ·{" "}
                    {result.residencesByTier[t.guid] || 0} résidences
                  </li>
                ))}
            </ul>
            {Object.keys(attrTotals).length > 0 && (
              <>
                <b>Bonus (maisons pleines)</b>
                <ul className="bilan">
                  {Object.entries(ATTR_FR).map(([k, label]) =>
                    attrTotals[k] ? (
                      <li key={k}>
                        {label} : {Math.round(attrTotals[k]).toLocaleString("fr")}
                        {k === "Money" ? "/min" : ""}
                      </li>
                    ) : null,
                  )}
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
