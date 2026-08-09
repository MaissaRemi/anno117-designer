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
import { bestDeityAttrs } from "../economy/attributes";

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

/** Paliers de dévotion proposés — ceux de l'échelle du jeu (`economy.patrons`). */
const DEVOTIONS = [0, 250, 1500, 4500, 25000, 250000];
/** Population par maison que Cérès rend à cette dévotion, pour l'afficher sans deviner. */
const DEVOTION_POP = (d: number) => bestDeityAttrs(d).Population ?? 0;

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
  /** Liste de vœux : ateliers demandés, DANS L'ORDRE — c'est la priorité. */
  const [wishes, setWishes] = useState<{ defId: string; count: number }[]>([]);
  /** Préférence par TYPE d'emplacement (montagne, rivière, marais). */
  const [slotWish, setSlotWish] = useState<Record<string, string>>({});
  const [wishSearch, setWishSearch] = useState("");
  const [floor, setFloor] = useState(80);
  // Déficit vital toléré PAR MAISON. 0 = veto strict, le comportement historique. Voir
  // `optimizer/viability.ts` : au-delà de 30 000 habitants le malus de rang de cité dépasse
  // ce qu'une maison peut encaisser, et sans cette soupape aucune grande île ne se peuple.
  const [tolerance, setTolerance] = useState(0);
  // Dévotion de l'île : elle débloque par paliers les effets de la divinité tutélaire, qui
  // valent pour l'île entière et ne coûtent ni sol ni permis. Voir `economy.patrons`.
  const [devotion, setDevotion] = useState(0);
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

  /**
   * Ateliers proposables : du monde de l'île, hors emplacement de terrain, et dont le bien
   * produit est réellement productible ici d'après les fertilités déclarées. On ne propose pas
   * ce que le moteur écartera de toute façon.
   */
  const wishCandidates = useMemo(() => {
    const producible = producibleGoodsSet(effProfile, islandRegion);
    const q = wishSearch.trim().toLowerCase();
    return catalog
      .filter((d) => !d.slotType && (!d.region || worldOf(d.region) === worldOf(islandRegion)))
      .filter((d) => {
        const out = economy.buildingProd[d.id]?.outputs?.[0]?.good;
        return !!out && producible.has(out);
      })
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, effProfile.fertilities.join(","), islandRegion, wishSearch]);

  /** Types d'emplacement RÉELLEMENT présents sur l'île — souvent un ou deux. */
  const slotTypes = useMemo(
    () => [...new Set((grid.slots ?? []).map((sl) => sl.type))].sort(),
    [grid.slots],
  );
  const slotChoices = (type: string) => catalog
    .filter((d) => d.slotType === type && (!d.region || worldOf(d.region) === worldOf(islandRegion)))
    .sort((a, b) => a.name.localeCompare(b.name));

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
        ...(tolerance > 0 ? { tolerance } : {}),
        ...(devotion > 0 ? { devotion } : {}),
        ...(wishes.length || Object.keys(slotWish).length
          ? { wanted: { workshops: wishes, slots: slotWish } }
          : {}),
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
            {localProduction && (
              <div className="field" style={{ display: "block" }}>
                <span>
                  Bâtiments voulus{" "}
                  <span className="muted" style={{ fontWeight: 400 }}>— servis en premier, dans l'ordre</span>
                </span>
                <input
                  type="search" placeholder="Rechercher un atelier…" value={wishSearch}
                  onChange={(e) => setWishSearch(e.target.value)}
                  style={{ width: "100%", marginTop: 4 }}
                />
                {wishSearch.trim().length >= 2 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {wishCandidates.slice(0, 8).map((d) => (
                      <button
                        key={d.id} type="button" style={{ fontSize: 11, padding: "2px 6px" }}
                        onClick={() => {
                          setWishes((w) => (w.some((x) => x.defId === d.id) ? w : [...w, { defId: d.id, count: 1 }]));
                          setWishSearch("");
                        }}
                      >+ {d.name}</button>
                    ))}
                    {!wishCandidates.length && <span className="muted" style={{ fontSize: 11 }}>aucun atelier productible ici</span>}
                  </div>
                )}
                {wishes.map((w, i) => (
                  <div key={w.defId} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ flex: 1, fontSize: 12 }}>{lookup(w.defId)?.name ?? w.defId}</span>
                    <input
                      type="number" min={1} max={20} value={w.count} style={{ width: 52 }}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
                        setWishes((prev) => prev.map((x, j) => (j === i ? { ...x, count: n } : x)));
                      }}
                    />
                    <button
                      type="button" title="Monter (priorité)" disabled={i === 0}
                      onClick={() => setWishes((prev) => {
                        const n = [...prev];
                        [n[i - 1], n[i]] = [n[i], n[i - 1]];
                        return n;
                      })}
                    >↑</button>
                    <button type="button" title="Retirer" onClick={() => setWishes((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                {exploitSlots && slotTypes.map((t) => (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 12, minWidth: 92 }}>Emplacements {t}</span>
                    <select
                      value={slotWish[t] ?? ""} style={{ flex: 1 }}
                      onChange={(e) => setSlotWish((prev) => {
                        const n = { ...prev };
                        if (e.target.value) n[t] = e.target.value; else delete n[t];
                        return n;
                      })}
                    >
                      <option value="">au choix du moteur</option>
                      {slotChoices(t).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                ))}
                <span className="muted" style={{ display: "block", fontSize: 11, marginTop: 6 }}>
                  Une liste de vœux est servie AVANT le choix automatique du moteur : le plan
                  peut donc loger MOINS de monde qu'avec « Produire sur l'île » seule. Ce qui ne
                  tient pas dans le budget ou la main-d'œuvre est annoncé dans les trous, avec
                  sa cause. Une préférence d'emplacement ne peut que restreindre — jamais poser
                  un bâtiment d'un autre monde ou sans son gisement.
                </span>
              </div>
            )}
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
            <label className="slider">
              <span style={{ color: "var(--muted)", fontSize: 12 }}>Risque toléré</span>
              <input type="range" min={0} max={50} step={5} value={Math.round(tolerance * 10)}
                onChange={(e) => setTolerance(parseInt(e.target.value) / 10)} />
              <span className="muted">{tolerance === 0 ? "aucun" : `−${tolerance.toFixed(1)}`}</span>
            </label>
            <label className="slider">
              <span style={{ color: "var(--muted)", fontSize: 12 }}>Dévotion</span>
              <input type="range" min={0} max={5} step={1} value={DEVOTIONS.indexOf(devotion)}
                onChange={(e) => setDevotion(DEVOTIONS[parseInt(e.target.value)] ?? 0)} />
              <span className="muted">{devotion === 0 ? "aucune" : devotion.toLocaleString("fr")}</span>
            </label>
            <span className="muted" style={{ fontSize: 11 }}>
              {devotion === 0
                ? "Sans dévotion, la divinité tutélaire ne rend que l'effet de zone de son autel."
                : `Cérès l'emporte : Population +${DEVOTION_POP(devotion)} sur CHAQUE maison de l'île, sans sol ni permis.`}
              {" "}Attention, l'effet est à double tranchant : plus d'habitants par maison
              alourdit le malus de rang de cité, donc le garde-fou rase davantage. Mesuré sur la
              carte continentale — sans tolérance la dévotion FAIT PERDRE 20 %, avec une
              tolérance de 3 elle fait gagner 34 % (70 057 → 93 622 habitants). Les deux
              réglages se tiennent.
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {tolerance === 0
                ? "Aucun attribut vital ne peut être négatif : une seule maison en déficit fait raser jusqu'au retour à zéro. C'est le comportement strict."
                : `Chaque maison peut être en déficit de ${tolerance.toFixed(1)} sur un attribut vital. `
                  + "En jeu la sécurité incendie est un TAUX DE RISQUE, pas une interdiction : "
                  + "plus d'incendies et d'émeutes, mais une ville bien plus grande."}
              {" "}Le malus de rang de cité s'applique par maison et atteint −7 dès 30 000 habitants,
              alors qu'une maison plafonne à +7 : sans tolérance, aucune ville romaine ne dépasse
              ce seuil, quelle que soit la surface. Mesuré sur la carte continentale du DLC :
              7 186 habitants sans risque, 34 257 à −1,0, 70 057 à −3,0.
            </span>
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
                {" · "}
                <span title="Part des maisons desservies par le service le moins bien réparti. C'est un descriptif du plan, PAS une note : mesuré, le meilleur plan a souvent MOINS de couverture — une recette maigre laisse la place à bien plus de maisons, qui logent bien plus de monde. Le chiffre qui compte est celui des habitants.">
                  couverture min {result.coverageMin}% <span className="muted">ⓘ</span>
                </span>
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
