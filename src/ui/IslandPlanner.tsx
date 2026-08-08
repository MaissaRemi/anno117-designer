import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { economy, tiers, worldOf } from "../economy/economy";
import { runIslandPlan, type AnyIslandPlanResult } from "../optimizer/runIslandPlan";
import { gridWithObstacles } from "../optimizer/halfTileAdapter";
import { makeLookup } from "../engine/rules";
import { producibleGoods as producibleGoodsSet } from "../economy/resources";
import { ResourceSelector } from "./ResourceSelector";
import { RunPanel } from "./components/RunPanel";
import { PlanPreview, PlanPreviewLegend } from "./components/PlanPreview";
import { regionOfIsland } from "../data/islands";

interface Props {
  onClose: () => void;
  asView?: boolean; // conservé pour compat ; le Plan d'île est désormais toujours un MODE
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

// paliers visés du monde courant, du plus dense au moins dense — le défaut de l'UI est le
// premier (l'ordre brut de `tiers` suit les GUID et tombait sur « Nobles »)
const tiersOfWorld = (world: string) =>
  tiers.filter((t) => t.residenceId && worldOf(t.region) === world)
    .sort((a, b) => b.capacityDefault - a.capacityDefault);

type NeedMode = "auto" | "all";

export function IslandPlanner({ onClose }: Props) {
  const applyOptimization = useStore((s) => s.applyOptimization);

  const world = useStore((s) => s.world);
  const targetTiers = useMemo(() => tiersOfWorld(world), [world]);
  const [tierGuid, setTierGuid] = useState(() => tiersOfWorld(world)[0]?.guid ?? "");
  // changer de monde change les paliers disponibles : on retombe sur le plus dense
  useEffect(() => {
    if (!targetTiers.some((t) => t.guid === tierGuid)) setTierGuid(targetTiers[0]?.guid ?? "");
  }, [targetTiers, tierGuid]);
  const [mode, setMode] = useState<"population" | "production">("population");
  const [needMode, setNeedMode] = useState<NeedMode>("auto");
  const [exploitSlots, setExploitSlots] = useState(false);
  const [localProduction, setLocalProduction] = useState(false);
  const [autoTier, setAutoTier] = useState(false);
  const [floor, setFloor] = useState(80);
  const [prodGood, setProdGood] = useState(() => {
    const first = Object.keys(economy.producers)
      .map((g) => ({ guid: g, name: economy.goodNames[g] || g }))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    return first?.guid ?? "";
  });
  const [prodRate, setProdRate] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null);
  const [result, setResult] = useState<AnyIslandPlanResult | null>(null);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usable = useStore((s) => s.layout.grid.usable.filter(Boolean).length);
  const grid = useStore((s) => s.layout.grid);
  const catalog = useStore((s) => s.catalog);
  const lookup = useMemo(() => makeLookup(catalog), [catalog]);
  const islandId = useStore((s) => s.layout.grid.islandId);
  const storedProfile = useStore((s) => (islandId ? s.islandProfiles[islandId] : undefined));
  const setIslandProfile = useStore((s) => s.setIslandProfile);
  const effProfile = storedProfile ?? { fertilities: [], mountainSlots: 0 };
  const islandRegion = regionOfIsland(islandId);

  const producibleGoodsList = useMemo(() => {
    const set = producibleGoodsSet(effProfile, islandRegion);
    return Object.keys(economy.producers)
      .filter((g) => set.has(g))
      .map((g) => ({ guid: g, name: economy.goodNames[g] || g }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effProfile.fertilities.join(","), islandRegion]);

  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);

  const run = () => {
    const s = useStore.getState();
    setRunning(true); setResult(null); setPlaceMsg(null); setProgress(null); setError(null);
    cancelRef.current?.();
    const locked = s.layout.buildings.filter((b) => b.locked);
    const grid = gridWithObstacles(s.layout.grid, locked, makeLookup(s.catalog));
    const { promise, cancel } = runIslandPlan(
      {
        catalog: s.catalog, grid, mode, tierGuid, coverageFloor: floor / 100, needMode,
        exploitSlots,
        localProduction,
        autoTier,
        ...(mode === "production"
          ? { productionGood: prodGood, productionRate: prodRate, islandFertilities: effProfile.fertilities.length ? effProfile.fertilities : undefined }
          : {}),
      },
      (step, total) => setProgress({ step, total }),
    );
    cancelRef.current = cancel;
    promise
      .then(setResult)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setRunning(false); cancelRef.current = null; });
  };

  const place = () => {
    if (!result) return;
    const coverage = result.mode === "import" ? result.coverageMin / 100 : result.prodsCovered / Math.max(1, result.prodsTotal);
    applyOptimization({
      buildings: result.buildings, roads: result.roads, fields: result.fields,
      aqueducts: result.mode === "import" ? result.aqueducts : undefined,
      placed: result.buildings.length, requested: result.buildings.length,
      placedByDef: {}, score: 0,
      breakdown: { count: result.buildings.length, roadLen: result.roads.length, bboxArea: 0, coverage },
    });
    onClose(); // → bascule vers l'éditeur pour voir le layout
  };

  const color = (pct: number) => (pct >= 100 ? "#8bc34a" : pct >= 75 ? "#ffcc66" : "#ff8a85");
  const noIsland = !islandId;

  return (
    <div className="mode-pane">
      <div className="pane-config">
        <h3>🏛 Plan d'île</h3>
        <p className="muted" style={{ marginTop: 4 }}>
          Cale le maximum d'habitants du tier-cible sur l'île chargée ({usable} cases de terre).
          En mode import, la sortie liste le débit de biens à acheminer.
        </p>
        {noIsland && <div className="warn">Charge une île d'abord (bouton « Charger une île » en haut).</div>}

        <div className="field">
          <span>Archetype d'île</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "population" | "production")}>
            <option value="population">🏠 Population (import des biens)</option>
            <option value="production">🏭 Production (export, main-d'œuvre locale)</option>
          </select>
        </div>

        {mode === "population" && (
          <>
            <div className="field">
              <span>Tier-cible</span>
              <select value={tierGuid} onChange={(e) => setTierGuid(e.target.value)}>
                {targetTiers.map((t) => <option key={t.guid} value={t.guid}>{t.name} · cap {t.capacityDefault}</option>)}
              </select>
            </div>
            <div className="field">
              <span>Services</span>
              <select value={needMode} onChange={(e) => setNeedMode(e.target.value as NeedMode)}>
                <option value="auto">Recette optimisée (max d'habitants)</option>
                <option value="all">Tous les services (max de bonus par maison)</option>
              </select>
              <span className="muted" style={{ fontSize: 11 }}>
                {needMode === "auto"
                  ? "Essaie plusieurs jeux de services et garde celui qui loge le plus de monde. Une recette maigre héberge moins par maison, mais laisse la place à bien plus de maisons."
                  : "Pose les 12 types de service du palier. Bonus maximal par maison, mais ils mangent ~⅓ de l'île."}
              </span>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={exploitSlots} onChange={(e) => setExploitSlots(e.target.checked)} />
              <span>
                Exploiter les emplacements libres
                <span className="muted" style={{ display: "block", fontSize: 11 }}>
                  Mines, carrières, argile… sur les emplacements de montagne, rivière et marais que
                  les aqueducs n'utilisent pas — l'eau reste prioritaire. Pose aussi les entrepôts
                  nécessaires pour que la production sorte.
                </span>
              </span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={localProduction} onChange={(e) => setLocalProduction(e.target.checked)} />
              <span>
                Produire sur l'île
                <span className="muted" style={{ display: "block", fontSize: 11 }}>
                  Pose des ateliers pour fabriquer une partie des biens au lieu de tout importer.
                  Ils remplacent des maisons et pèsent sur les attributs : on s'arrête dès que le
                  bilan de l'île passerait sous zéro.
                </span>
              </span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={autoTier} onChange={(e) => setAutoTier(e.target.checked)} />
              <span>
                Chercher le meilleur palier
                <span className="muted" style={{ display: "block", fontSize: 11 }}>
                  Un palier plus haut ne loge pas forcément plus de monde : ses services mangent
                  plus de sol et son malus de rang de cité est plus lourd. Mesuré en Albion, viser
                  les Aldermen loge 2,25 fois plus que viser les Nobles. Coûte un plan complet par
                  palier de la lignée.
                </span>
              </span>
            </label>
            <label className="slider">
              <span style={{ color: "var(--muted)", fontSize: 12 }}>% maisons au tier</span>
              <input type="range" min={50} max={100} step={5} value={floor} onChange={(e) => setFloor(parseInt(e.target.value))} />
              <span className="muted">{floor}%</span>
            </label>
          </>
        )}

        {mode === "production" && (
          <>
            <div className="field">
              <span>Bien à produire</span>
              <select value={prodGood} onChange={(e) => setProdGood(e.target.value)}>
                {producibleGoodsList.map((g) => <option key={g.guid} value={g.guid}>{g.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span>Débit (u/min)</span>
              <input type="number" min={0.5} step={0.5} value={prodRate} onChange={(e) => setProdRate(parseFloat(e.target.value) || 1)} />
            </div>
            {islandId && (
              <div className="field">
                <span>Ressources de l'île <span className="muted">(contraignent les biens produisibles)</span></span>
                <ResourceSelector value={effProfile} onChange={(p) => setIslandProfile(islandId, p)} />
              </div>
            )}
          </>
        )}

        <RunPanel running={running} progress={progress} error={error}
          actions={[{ label: running ? "Calcul…" : "Calculer", primary: true, onClick: run, disabled: !tierGuid || noIsland }]} />
      </div>

      <div className="pane-result">
        {!result && !running && <p className="muted">Lance un calcul pour voir le résultat ici.</p>}
        {result && !running && result.buildings.length === 0 && (
          <div className="warn">Aucun plan trouvé{result.gaps?.length ? ` — ${result.gaps[0]}` : " (île trop petite ou fragmentée)"}.</div>
        )}

        {/* Sur écran large : la carte à gauche (elle reste visible pendant qu'on fait défiler
            le bilan), les chiffres à droite. En dessous de 1100 px, on empile. */}
        <div className="result-split">
        {result && !running && result.buildings.length > 0 && (
          <div className="result-map">
            <PlanPreview
              grid={grid}
              buildings={result.buildings}
              roads={result.roads}
              aqueducts={result.mode === "import" ? result.aqueducts : undefined}
              lookup={lookup}
            />
            {result.mode === "import" && <PlanPreviewLegend tierCounts={result.tierCounts} />}
          </div>
        )}
        <div className="result-stats">

        {result && !running && result.mode === "import" && (
          <div className="opt-result">
            <div style={{ marginBottom: 6 }}>
              <b>{result.residents.toLocaleString("fr")} habitants</b> <span className="muted">(mixte)</span> ·{" "}
              <b style={{ color: color(result.fullyCoveredPct) }}>{result.fullyCovered}</b>/{result.houses} au tier-cible ({result.tierName}, {result.fullyCoveredPct}%)
              {!result.feasible && <span style={{ color: "#ffcc66" }}> (best-effort)</span>}
              <div className="muted" style={{ fontSize: "0.85em" }}>
                {[...tiers].filter((t) => result.tierCounts[t.guid]).sort((a, b) => b.capacityDefault - a.capacityDefault)
                  .map((t) => `${t.name} ${result.tierCounts[t.guid].toLocaleString("fr")}`).join(" · ")}
                {" · "}couverture min {result.coverageMin}%
              </div>
            </div>
            <div style={{ marginBottom: 6 }}>
              {result.viable
                ? <span style={{ color: "#8bc34a" }}>✔ Bilan de l'île positif</span>
                : <span style={{ color: "#ff8a85" }}>✘ Bilan de l'île en déficit</span>}
              <span className="muted"> — </span>
              {["Happiness", "Money", "Health", "FireSafety"].map((k) => {
                const v = result.attrsTotal[k] ?? 0;
                const lbl: Record<string, string> = { Happiness: "🙂", Money: "💰", Health: "❤", FireSafety: "🔥" };
                return (
                  <span key={k} style={{ color: v >= 0 ? "#8bc34a" : "#ff8a85", marginRight: 8 }}>
                    {lbl[k]} {v >= 0 ? "+" : ""}{Math.round(v).toLocaleString("fr")}
                  </span>
                );
              })}
              <div className="muted" style={{ fontSize: "0.85em" }}>
                total sur toutes les maisons, malus de rang de cité compris
              </div>
            </div>
            {/* MAIN-D'ŒUVRE. Un atelier réclame la main-d'œuvre d'un palier précis, sans
                substitution possible : le plan rétrograde donc une part des maisons. Rien
                n'est démoli — les neuf résidences du jeu font toutes 3×3. */}
            {result.mode === "import" && Object.keys(result.workforce.demand).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {Object.keys(result.workforce.deficit).length || Object.keys(result.workforce.alien).length
                  ? <span style={{ color: "#ff8a85" }}>✘ Main-d'œuvre insuffisante</span>
                  : <span style={{ color: "#8bc34a" }}>✔ Main-d'œuvre couverte</span>}
                <div className="muted" style={{ fontSize: "0.85em" }}>
                  {Object.entries(result.workforce.demand)
                    .map(([g, d]) => {
                      const t = tiers.find((x) => x.guid === g);
                      const o = result.workforce.offer[g] ?? 0;
                      return `${t?.name ?? g} ${Math.round(d)}/${Math.round(o)}`;
                    })
                    .join(" · ")}
                  {result.workforce.conversions.length > 0 && (
                    <>
                      <br />
                      {result.workforce.conversions.map((c) => {
                        const a = tiers.find((x) => x.guid === c.from)?.name ?? c.from;
                        const b = tiers.find((x) => x.guid === c.to)?.name ?? c.to;
                        return `${c.houses} ${a} → ${b}`;
                      }).join(" · ")}
                      {" — maisons ouvrières"}
                    </>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginBottom: 6 }}>
              💰 net <span style={{ color: result.money.net >= 0 ? "#8bc34a" : "#ff8a85" }}>{result.money.net >= 0 ? "+" : ""}{result.money.net.toLocaleString("fr")}/min</span>{" "}
              <span className="muted">(taxe {result.money.gross.toLocaleString("fr")} − entretien {result.money.upkeep.toLocaleString("fr")})</span>
            </div>
            {result.water && (
              <div style={{ marginBottom: 6 }}>
                💧 Eau : {result.water.sources} source{result.water.sources > 1 ? "s" : ""} · {result.water.used}/{result.water.capacity} u ·{" "}
                {result.water.consumers.filter((c) => c.connected).length}/{result.water.consumers.length} raccordés
              </div>
            )}
            {result.workshops.length > 0 && (
              <>
                <b>🏭 Produit sur l'île ({result.workshops.length})</b>
                <ul className="bilan">
                  {result.workshops.map((w, i) => (
                    <li key={i}>
                      {w.name} ×{w.copies} · {w.perMin.toFixed(2)}/min {w.goodName}
                      <span className="muted"> — {w.razed.length} maison(s)</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.exploited.length > 0 && (
              <>
                <b>⛏ Emplacements exploités ({result.exploited.length})</b>
                <ul className="bilan">
                  {result.exploited.map((e, i) => (
                    <li key={i} style={{ color: e.served ? undefined : "#ffcc66" }}>
                      {e.name} ({e.slotType}) · {e.perMin.toLocaleString("fr")}/min {e.goodName}
                      {!e.served && " — sans entrepôt à portée"}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <b>📦 À acheminer ({result.importGoods.length} biens)</b>
            <ul className="bilan">{result.importGoods.slice(0, 30).map((g) => <li key={g.good}>{g.perMin.toLocaleString("fr")}/min · {g.name}</li>)}</ul>
            {Object.keys(result.attributes).length > 0 && (
              <>
                <b>Bonus cumulés</b>
                <ul className="bilan">{Object.entries(ATTR_FR).map(([k, label]) => result.attributes[k] ? <li key={k}>{label} : {result.attributes[k].toLocaleString("fr")}{k === "Money" ? "/min" : ""}</li> : null)}</ul>
              </>
            )}
            {result.gaps.length > 0 && <div className="warn">⚠ Trous : {result.gaps.join(" · ")}</div>}
          </div>
        )}

        {result && !running && result.mode === "production" && (
          <div className="opt-result">
            <div style={{ marginBottom: 6 }}>
              <b>{result.ratePerMin.toLocaleString("fr")}/min · {economy.goodNames[result.good] || result.good}</b> · {result.prodsTotal} prods · {result.houses} maisons ouvrières
            </div>
            <div style={{ marginBottom: 6 }}>
              🚚 Entrepôts : {result.warehousesPlaced} · <b style={{ color: color((100 * result.prodsCovered) / Math.max(1, result.prodsTotal)) }}>{result.prodsCovered}/{result.prodsTotal}</b> prods couvertes
            </div>
            <div style={{ marginBottom: 6 }}>
              💰 profit export <b style={{ color: result.exportNet >= 0 ? "#8bc34a" : "#ff8a85" }}>{result.exportNet >= 0 ? "+" : ""}{result.exportNet.toLocaleString("fr")}/min</b> · posés {result.placed}/{result.requested}
            </div>
            <b>👷 Population requise</b>
            <ul className="bilan">{Object.entries(result.solution.populationByTier).filter(([, p]) => p > 0).map(([t, p]) => <li key={t}>{tiers.find((x) => x.guid === t)?.name ?? t} : {Math.ceil(p).toLocaleString("fr")}</li>)}</ul>
            {result.requiredFertilities.length > 0 && (
              <div style={{ marginBottom: 6 }}>🌱 Fertilités : {result.requiredFertilities.map((f) => <span key={f.guid} style={{ color: f.available ? "#8bc34a" : "#ff8a85" }}>{f.available ? "✓" : "✗"} {f.name} </span>)}</div>
            )}
            {result.gaps.length > 0 && <div className="warn">⚠ {result.gaps.join(" · ")}</div>}
          </div>
        )}

        {result && !running && result.buildings.length > 0 && (
          <button className="primary" onClick={place} style={{ marginTop: 12 }}>Placer sur l'île →</button>
        )}
        {placeMsg && <div className="muted" style={{ marginTop: 6 }}>{placeMsg}</div>}
        </div>
        </div>
      </div>
    </div>
  );
}
