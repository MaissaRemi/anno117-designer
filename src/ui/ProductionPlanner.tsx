import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { economy, pickProducerInWorld, worldOf } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { regionOfIsland } from "../data/islands";
import { gridWithObstacles } from "../optimizer/halfTileAdapter";
import { nomenclature, type Commande } from "../commande/nomenclature";
import { resumeEffets } from "../economy/dieux";
import { runPlanifier } from "../commande/runPlanifier";
import type { ResultatCommande } from "../commande/planifier";
import { RunPanel } from "./components/RunPanel";
import { PlanPreview } from "./components/PlanPreview";
import { RoadTypeSelect } from "./components/RoadTypeSelect";
import { DieuSelect, type ChoixDevotion } from "./components/DieuSelect";
import { ChipMultiSelect } from "./components/ChipMultiSelect";
import type { RoadType } from "../engine/roads";

/**
 * ÎLE DE PRODUCTION — le joueur demande des biens et un débit, le moteur de la commande pose.
 *
 * Conception : `docs/superpowers/specs/2026-10-30-ile-de-production-design.md`. Les biens
 * deviennent les bâtiments de leurs chaînes (`nomenclature`, objectif), avec la productivité du
 * dieu et celle que le joueur saisit (recherche, objets). Les matières que l'île ne peut pas
 * produire — fertilité non déclarée, emplacements de montagne ou de rivière trop peu nombreux —
 * sont importées, et le rapport dit pourquoi. La pose est celle de « Ma commande ».
 */

interface LigneBien { good: string; parMinute: number }

const ROLES: Record<string, string> = {
  ouvriers: "Maisons ouvrières", service: "Services", institution: "Institutions",
  production: "Production", comptoir: "Comptoir",
};

export function ProductionPlanner() {
  const catalog = useStore((s) => s.catalog);
  const grid = useStore((s) => s.layout.grid);
  const islandId = grid.islandId;
  const world = useStore((s) => s.world);
  const applyOptimization = useStore((s) => s.applyOptimization);
  const setUiMode = useStore((s) => s.setUiMode);
  const storedProfile = useStore((s) => (islandId ? s.islandProfiles[islandId] : undefined));
  const setIslandProfile = useStore((s) => s.setIslandProfile);
  const lookup = useMemo(() => makeLookup(catalog), [catalog]);
  const region = islandId ? worldOf(regionOfIsland(islandId)) : world;
  const fertilites = useMemo(() => storedProfile?.fertilities ?? [], [storedProfile]);

  /** Biens qu'un bâtiment de ce monde produit, par nom. */
  const biensDuMonde = useMemo(
    () => Object.keys(economy.producers)
      .filter((g) => pickProducerInWorld(g, region))
      .map((g) => ({ good: g, nom: economy.goodNames[g] || g }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    [region],
  );
  const optionsFertilites = useMemo(
    () => Object.entries(economy.fertilities).map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [],
  );

  const [biens, setBiens] = useState<LigneBien[]>([]);
  // changer de monde invalide les biens d'un autre monde
  useEffect(() => {
    setBiens((l) => l.filter((b) => biensDuMonde.some((x) => x.good === b.good)));
  }, [biensDuMonde]);
  const [routes, setRoutes] = useState<RoadType>("pavee");
  const [dieu, setDieu] = useState("");
  const [devotion, setDevotion] = useState<ChoixDevotion>("foi");
  const [prodGlobale, setProdGlobale] = useState(0);
  const [prodParAtelier, setProdParAtelier] = useState<Record<string, number>>({});

  // Les emplacements de terrain de l'île bornent mines et exploitations de rivière.
  const emplacements = useMemo(() => {
    const n: Record<string, number> = {};
    for (const s of grid.slots ?? []) n[s.type] = (n[s.type] ?? 0) + 1;
    return n;
  }, [grid.slots]);
  const commande: Commande = useMemo(() => {
    const parAtelier = Object.fromEntries(Object.entries(prodParAtelier).filter(([, v]) => v));
    return {
      region,
      maisons: [],
      objectif: biens.filter((b) => b.parMinute > 0),
      routes,
      ...(prodGlobale || Object.keys(parAtelier).length ? { productivite: { globale: prodGlobale, parAtelier } } : {}),
      ...(fertilites.length ? { fertilites } : {}),
      ...(islandId ? { emplacements } : {}),
      ...(dieu ? { dieu } : {}),
      ...(devotion === "foi" ? {} : { devotion }),
    };
  }, [region, biens, routes, prodGlobale, prodParAtelier, fertilites, islandId, emplacements, dieu, devotion]);
  const devis = useMemo(() => nomenclature(commande, catalog, lookup), [commande, catalog, lookup]);
  const ateliers = devis.lignes.filter((l) => l.role === "production");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultatCommande | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);

  const lancer = () => {
    const s = useStore.getState();
    setRunning(true); setError(null); setResult(null);
    cancelRef.current?.();
    const locked = s.layout.buildings.filter((b) => b.locked);
    const g = gridWithObstacles(s.layout.grid, locked, makeLookup(s.catalog));
    const { promise, cancel } = runPlanifier({ grid: g, commande, catalog: s.catalog });
    cancelRef.current = cancel;
    promise
      .then(setResult)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setRunning(false); cancelRef.current = null; });
  };

  const poser = () => {
    if (!result) return;
    applyOptimization({
      buildings: result.buildings, roads: result.roads, fields: result.fields, aqueducts: result.aqueducts,
      roadType: result.roadType,
      placed: result.buildings.length, requested: result.buildings.length, placedByDef: {}, score: 0,
      breakdown: { count: result.buildings.length, roadLen: result.roads.length, bboxArea: 0, coverage: 1 },
    });
    setUiMode("editor");
  };

  const nomBien = (g: string) => economy.goodNames[g] || g;
  const libres = biensDuMonde.filter((b) => !biens.some((x) => x.good === b.good));

  return (
    <div className="mode-pane">
      <div className="pane-config">
        {!islandId && <div className="warn">Charge une île d'abord (bouton « Charger une île » en haut).</div>}

        <h4>Biens à produire</h4>
        {biens.map((l, i) => (
          <div className="ligne-commande" key={l.good}>
            <select value={l.good} onChange={(e) => setBiens((b) => b.map((x, k) => (k === i ? { ...x, good: e.target.value } : x)))}>
              {[{ good: l.good, nom: nomBien(l.good) }, ...libres].map((b) => <option key={b.good} value={b.good}>{b.nom}</option>)}
            </select>
            <input type="number" min={0} step={0.5} value={l.parMinute}
              onChange={(e) => setBiens((b) => b.map((x, k) => (k === i ? { ...x, parMinute: Math.max(0, Number(e.target.value) || 0) } : x)))} />
            <span className="muted">/min</span>
            <button type="button" title="Retirer" onClick={() => setBiens((b) => b.filter((_, k) => k !== i))}>✕</button>
          </div>
        ))}
        <button type="button" disabled={!libres.length}
          onClick={() => setBiens((b) => [...b, { good: libres[0].good, parMinute: 10 }])}>+ Bien</button>

        <RoadTypeSelect value={routes} onChange={setRoutes} />
        <DieuSelect dieu={dieu} onDieu={setDieu} devotion={devotion} onDevotion={setDevotion} vide="aucun" />

        <div className="field" style={{ display: "block" }}
          title="Ce que la partie a débloqué : une matière dont la fertilité ou le gisement manque est importée. Rien de déclaré : tout est supposé présent.">
          <span>Fertilités et gisements de l'île <span className="muted">(vide : tout supposé présent)</span></span>
          {islandId && (
            <ChipMultiSelect options={optionsFertilites} selected={fertilites}
              onChange={(f) => setIslandProfile(islandId, { ...(storedProfile ?? { fertilities: [], mountainSlots: 0 }), fertilities: f })}
              placeholder="Ajouter une fertilité / un gisement…" />
          )}
        </div>

        <details className="avance">
          <summary>Productivité (recherche, objets)</summary>
          <p className="muted" style={{ fontSize: 11, margin: "4px 0" }}>
            Points de pourcentage, ajoutés à ceux du dieu. Ces bonus ne sont pas dans les données du jeu extraites : à toi de les reporter.
          </p>
          <div className="ligne-commande">
            <span className="nom">Tous les ateliers</span>
            <input type="number" step={5} value={prodGlobale} onChange={(e) => setProdGlobale(Number(e.target.value) || 0)} />
            <span className="muted">%</span>
          </div>
          {ateliers.map((l) => (
            <div className="ligne-commande" key={l.defId}>
              <span className="nom" title={l.nom}>{l.nom}</span>
              <input type="number" step={5} value={prodParAtelier[l.defId] ?? 0}
                onChange={(e) => setProdParAtelier((p) => ({ ...p, [l.defId]: Number(e.target.value) || 0 }))} />
              <span className="muted">%</span>
            </div>
          ))}
        </details>

        {biens.length > 0 && (
          <div className="opt-result" style={{ marginTop: 8 }}>
            <b>Devis</b> — {devis.lignes.reduce((s, l) => s + l.nombre, 0).toLocaleString("fr")} bâtiments,
            ~{devis.surface.total.toLocaleString("fr")} cases
            {devis.dieu && (
              <div className="muted" style={{ fontSize: "0.85em" }}>
                {devis.dieu.nom} à {devis.dieu.devotion.toLocaleString("fr")} : {resumeEffets(devis.dieu.productivitePct, devis.dieu.ateliers, devis.dieu.residence)}
              </div>
            )}
            <ul className="muted" style={{ fontSize: "0.85em", margin: "4px 0 0 16px", padding: 0 }}>
              {devis.objectif.map((o) => (
                <li key={o.good}>{o.nom} : {o.parMinute}/min{o.produit < o.parMinute ? `, dont ${o.produit} produits sur l'île` : ""}</li>
              ))}
              {Object.entries(ROLES).map(([role, label]) => {
                const ls = devis.lignes.filter((l) => l.role === role);
                if (!ls.length) return null;
                return <li key={role}>{label} : {ls.map((l) => `${l.nombre} ${l.nom}`).join(", ")}</li>;
              })}
            </ul>
            {devis.imports.length > 0 && (
              <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
                À importer : {devis.imports.map((m) => `${m.nom} ${m.parMinute}/min (${m.raison})`).join(" · ")}
              </div>
            )}
            {devis.avertissements.map((a) => <div key={a} className="warn" style={{ fontSize: "0.85em" }}>{a}</div>)}
          </div>
        )}

        <RunPanel running={running} error={error}
          actions={[{ label: running ? "Calcul…" : "Disposer sur l'île", primary: true, onClick: lancer, disabled: !islandId || !ateliers.length }]} />
      </div>

      <div className="pane-result">
        {!result && !running && <p className="muted">Choisis des biens, puis lance la disposition pour voir le plan ici.</p>}
        {result && !running && (
          <div className="result-split">
            <div className="result-map">
              <PlanPreview grid={grid} buildings={result.buildings} roads={result.roads} aqueducts={result.aqueducts} lookup={lookup} roadType={result.roadType} />
            </div>
            <div className="result-stats">
              <div className="opt-result">
                <div style={{ marginBottom: 6 }}>
                  {result.servi
                    ? <span style={{ color: "#8bc34a" }}>✔ Production entièrement posée et reliée</span>
                    : <span style={{ color: "#ffcc66" }}>⚠ Production posée en partie</span>}
                  {" · "}{result.habitants.toLocaleString("fr")} ouvriers logés
                  {" · "}{result.production.entrepots} entrepôt(s)
                  {" · "}
                  <span title={`impôts ${result.argent.impots.toLocaleString("fr")}, entretien ${result.argent.entretien.toLocaleString("fr")}`}>
                    {result.argent.net.toLocaleString("fr")} argent/min
                  </span>
                </div>
                <table className="muted" style={{ fontSize: "0.85em", width: "100%", marginBottom: 6 }}>
                  <thead><tr><th style={{ textAlign: "left" }}>Bien</th><th>demandé</th><th>sur l'île</th><th>posé</th></tr></thead>
                  <tbody>
                    {result.objectif.map((o) => (
                      <tr key={o.good} style={{ color: o.pose < o.parMinute ? "#ff8a85" : undefined }}>
                        <td>{o.nom}</td>
                        <td style={{ textAlign: "center" }}>{o.parMinute}/min</td>
                        <td style={{ textAlign: "center" }}>{o.produit}/min</td>
                        <td style={{ textAlign: "center" }}>{o.pose}/min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.imports.length > 0 && (
                  <div className="muted" style={{ fontSize: "0.85em", marginBottom: 6 }}>
                    À importer : {result.imports.map((m) => `${m.nom} ${m.parMinute}/min (${m.raison})`).join(" · ")}
                  </div>
                )}
                {result.manques.length > 0 && (
                  <div className="warn" style={{ marginBottom: 6 }}>
                    {result.manques.map((m) => <div key={m}>{m}</div>)}
                  </div>
                )}
                <table className="muted" style={{ fontSize: "0.85em", width: "100%" }}>
                  <thead><tr><th style={{ textAlign: "left" }}>Bâtiment</th><th>demandé</th><th>posé</th></tr></thead>
                  <tbody>
                    {result.lignes.filter((l) => l.role !== "comptoir").map((l) => (
                      <tr key={`${l.role}-${l.defId}`} style={{ color: l.pose < l.demande && (l.role === "ouvriers" || l.role === "production") ? "#ff8a85" : undefined }}>
                        <td>{l.nom}</td><td style={{ textAlign: "center" }}>{l.demande}</td><td style={{ textAlign: "center" }}>{l.pose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.avertissements.map((a) => <div key={a} className="muted" style={{ fontSize: "0.85em" }}>⚠ {a}</div>)}
                <button type="button" className="primary" style={{ marginTop: 8 }} onClick={poser}>Placer sur l'île</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
