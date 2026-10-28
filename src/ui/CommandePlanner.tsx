import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { tiers, worldOf } from "../economy/economy";
import { makeLookup } from "../engine/rules";
import { regionOfIsland } from "../data/islands";
import { gridWithObstacles } from "../optimizer/halfTileAdapter";
import { isProducer } from "../prodlayout/chain";
import { nomenclature, type ChoixServices, type Commande } from "../commande/nomenclature";
import { runPlanifier } from "../commande/runPlanifier";
import type { ResultatCommande } from "../commande/planifier";
import { RunPanel } from "./components/RunPanel";
import { PlanPreview } from "./components/PlanPreview";
import { RoadTypeSelect } from "./components/RoadTypeSelect";
import type { RoadType } from "../engine/roads";

/**
 * ONGLET COMMANDE — le joueur commande, le moteur dispose.
 *
 * À gauche la commande : maisons par palier, services, bâtiments de production. Le DEVIS
 * (`nomenclature`) se recalcule à chaque frappe — quelques millisecondes : on voit ce que la
 * commande coûtera en bâtiments, en surface et en main-d'œuvre avant de lancer la pose. À droite
 * le plan posé, ligne par ligne : demandé, posé, et ce qui manque, chiffré.
 */

interface LigneMaisons { tierGuid: string; maisons: number }
interface LigneProd { defId: string; count: number }

const ROLES: Record<string, string> = {
  residence: "Maisons", ouvriers: "Maisons ouvrières", service: "Services", institution: "Institutions",
  production: "Production", comptoir: "Comptoir",
};
const ATTRS: Record<string, string> = { Happiness: "🙂 Bonheur", Money: "💰 Argent", Health: "❤ Santé", FireSafety: "🔥 Incendie" };

export function CommandePlanner() {
  const catalog = useStore((s) => s.catalog);
  const grid = useStore((s) => s.layout.grid);
  const islandId = grid.islandId;
  const world = useStore((s) => s.world);
  const applyOptimization = useStore((s) => s.applyOptimization);
  const setUiMode = useStore((s) => s.setUiMode);
  const lookup = useMemo(() => makeLookup(catalog), [catalog]);
  const region = islandId ? worldOf(regionOfIsland(islandId)) : world;

  const paliers = useMemo(
    () => tiers.filter((t) => t.residenceId && worldOf(t.region) === region).sort((a, b) => b.capacityDefault - a.capacityDefault),
    [region],
  );
  const producteurs = useMemo(
    () => catalog.filter((d) => isProducer(d.id) && (!d.region || worldOf(d.region) === region))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog, region],
  );

  const [maisons, setMaisons] = useState<LigneMaisons[]>(() => (paliers[0] ? [{ tierGuid: paliers[0].guid, maisons: 100 }] : []));
  // changer de monde invalide les paliers d'un autre monde : on repart du plus dense
  useEffect(() => {
    setMaisons((m) => (m.every((l) => paliers.some((p) => p.guid === l.tierGuid)) ? m
      : paliers[0] ? [{ tierGuid: paliers[0].guid, maisons: 100 }] : []));
  }, [paliers]);
  const [services, setServices] = useState<"minimal" | "complet">("minimal");
  const [institutions, setInstitutions] = useState(true);
  const [production, setProduction] = useState<LigneProd[]>([]);
  const [completer, setCompleter] = useState(true);
  const [biens, setBiens] = useState<"importer" | "produire">("importer");
  const [mainOeuvre, setMainOeuvre] = useState<"loger" | "signaler">("loger");
  const [routes, setRoutes] = useState<RoadType>("pavee");
  const [recherche, setRecherche] = useState("");

  const terre = useMemo(() => {
    const n = grid.usable.filter(Boolean).length;
    return (grid.cellsPerTile ?? 1) === 2 ? Math.round(n / 4) : n;
  }, [grid]);
  const commande: Commande = useMemo(() => ({
    region,
    maisons: maisons.filter((l) => l.maisons > 0),
    services: services as ChoixServices,
    institutions,
    production: production.filter((l) => l.count > 0),
    completerProduction: completer,
    biensDesMaisons: biens,
    mainOeuvre,
    routes,
    terre: islandId ? terre : undefined,
  }), [region, maisons, services, institutions, production, completer, biens, mainOeuvre, routes, islandId, terre]);
  const devis = useMemo(() => nomenclature(commande, catalog, lookup), [commande, catalog, lookup]);

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

  const candidats = recherche.trim().length >= 2
    ? producteurs.filter((d) => d.name.toLowerCase().includes(recherche.trim().toLowerCase())).slice(0, 8)
    : [];
  const nom = (id: string) => lookup(id)?.name ?? id;
  const nbBatiments = devis.lignes.reduce((s, l) => s + l.nombre, 0);

  return (
    <div className="mode-pane">
      <div className="pane-config">
        <h3>📋 Commande</h3>
        <p className="muted" style={{ marginTop: 4 }}>
          Dis ce que tu veux sur l'île ; le moteur calcule la liste exacte des bâtiments, puis les
          dispose en quartiers et en chaînes de production.
        </p>
        {!islandId && <div className="warn">Charge une île d'abord (bouton « Charger une île » en haut).</div>}

        <h4>Maisons</h4>
        {maisons.map((l, i) => (
          <div className="ligne-commande" key={i}>
            <select value={l.tierGuid} onChange={(e) => setMaisons((m) => m.map((x, k) => (k === i ? { ...x, tierGuid: e.target.value } : x)))}>
              {paliers.map((t) => <option key={t.guid} value={t.guid}>{t.name}</option>)}
            </select>
            <input type="number" min={0} step={10} value={l.maisons}
              onChange={(e) => setMaisons((m) => m.map((x, k) => (k === i ? { ...x, maisons: Math.max(0, Number(e.target.value) || 0) } : x)))} />
            <span className="muted">maisons</span>
            <button type="button" title="Retirer" onClick={() => setMaisons((m) => m.filter((_, k) => k !== i))}>✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setMaisons((m) => [...m, { tierGuid: paliers[0]?.guid ?? "", maisons: 50 }])}>+ Palier</button>

        <div className="field">
          <span>Services</span>
          <select value={services} onChange={(e) => setServices(e.target.value as "minimal" | "complet")}>
            <option value="minimal">Recette minimale (le moins de sol)</option>
            <option value="complet">Tous les services (plus d'habitants par maison)</option>
          </select>
        </div>
        <RoadTypeSelect value={routes} onChange={setRoutes} />
        <label className="checkbox">
          <input type="checkbox" checked={institutions} onChange={(e) => setInstitutions(e.target.checked)} />
          <span>Institutions (vigiles, médecins, puits…)</span>
        </label>

        <h4>Production</h4>
        <input type="search" placeholder="Ajouter un bâtiment de production…" value={recherche}
          onChange={(e) => setRecherche(e.target.value)} style={{ width: "100%" }} />
        {candidats.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {candidats.map((d) => (
              <button key={d.id} type="button" style={{ fontSize: 11, padding: "2px 6px" }}
                onClick={() => {
                  setProduction((p) => (p.some((x) => x.defId === d.id) ? p : [...p, { defId: d.id, count: 1 }]));
                  setRecherche("");
                }}>+ {d.name}</button>
            ))}
          </div>
        )}
        {production.map((l, i) => (
          <div className="ligne-commande" key={l.defId}>
            <span className="nom" title={nom(l.defId)}>{nom(l.defId)}</span>
            <input type="number" min={0} value={l.count}
              onChange={(e) => setProduction((p) => p.map((x, k) => (k === i ? { ...x, count: Math.max(0, Number(e.target.value) || 0) } : x)))} />
            <button type="button" title="Retirer" onClick={() => setProduction((p) => p.filter((_, k) => k !== i))}>✕</button>
          </div>
        ))}
        <label className="checkbox">
          <input type="checkbox" checked={completer} onChange={(e) => setCompleter(e.target.checked)} />
          <span>Compléter les chaînes jusqu'aux matières premières</span>
        </label>
        <div className="field">
          <span>Biens consommés par les maisons</span>
          <select value={biens} onChange={(e) => setBiens(e.target.value as "importer" | "produire")}>
            <option value="importer">Importés (le comptoir les reçoit)</option>
            <option value="produire">Produits sur l'île</option>
          </select>
        </div>
        <div className="field">
          <span>Main-d'œuvre manquante</span>
          <select value={mainOeuvre} onChange={(e) => setMainOeuvre(e.target.value as "loger" | "signaler")}>
            <option value="loger">Loger les ouvriers (maisons ajoutées)</option>
            <option value="signaler">Seulement la signaler</option>
          </select>
        </div>

        <div className="opt-result" style={{ marginTop: 8 }}>
          <b>Devis</b> — {nbBatiments.toLocaleString("fr")} bâtiments, {devis.habitants.toLocaleString("fr")} habitants,
          ~{devis.surface.total.toLocaleString("fr")} cases{islandId ? ` sur ${terre.toLocaleString("fr")}` : ""}
          <ul className="muted" style={{ fontSize: "0.85em", margin: "4px 0 0 16px", padding: 0 }}>
            {Object.entries(ROLES).map(([role, label]) => {
              const ls = devis.lignes.filter((l) => l.role === role);
              if (!ls.length) return null;
              return <li key={role}>{label} : {ls.map((l) => `${l.nombre} ${l.nom}`).join(", ")}</li>;
            })}
          </ul>
          {devis.avertissements.map((a) => <div key={a} className="warn" style={{ fontSize: "0.85em" }}>{a}</div>)}
        </div>

        <RunPanel running={running} error={error}
          actions={[{ label: running ? "Calcul…" : "Disposer sur l'île", primary: true, onClick: lancer, disabled: !islandId || !nbBatiments }]} />
      </div>

      <div className="pane-result">
        {!result && !running && <p className="muted">Lance la disposition pour voir le plan ici.</p>}
        {result && !running && (
          <div className="result-split">
            <div className="result-map">
              <PlanPreview grid={grid} buildings={result.buildings} roads={result.roads} aqueducts={result.aqueducts} lookup={lookup} roadType={result.roadType} />
            </div>
            <div className="result-stats">
              <div className="opt-result">
                <div style={{ marginBottom: 6 }}>
                  {result.servi
                    ? <span style={{ color: "#8bc34a" }}>✔ Commande entièrement servie</span>
                    : <span style={{ color: "#ffcc66" }}>⚠ Commande servie en partie</span>}
                  {" · "}<b>{result.habitants.toLocaleString("fr")} habitants</b>
                  {" · "}{result.production.blueprints} chaîne(s), {result.production.entrepots} entrepôt(s)
                </div>
                {result.manques.length > 0 && (
                  <div className="warn" style={{ marginBottom: 6 }}>
                    {result.manques.map((m) => <div key={m}>{m}</div>)}
                  </div>
                )}
                <table className="muted" style={{ fontSize: "0.85em", width: "100%" }}>
                  <thead><tr><th style={{ textAlign: "left" }}>Bâtiment</th><th>demandé</th><th>posé</th></tr></thead>
                  <tbody>
                    {result.lignes.filter((l) => l.role !== "comptoir").map((l) => (
                      <tr key={`${l.role}-${l.defId}`} style={{ color: l.pose < l.demande && (l.role === "residence" || l.role === "ouvriers" || l.role === "production") ? "#ff8a85" : undefined }}>
                        <td>{l.nom}</td><td style={{ textAlign: "center" }}>{l.demande}</td><td style={{ textAlign: "center" }}>{l.pose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 6 }}>
                  {result.viable
                    ? <span style={{ color: "#8bc34a" }}>✔ Bilan d'attributs positif</span>
                    : <span style={{ color: "#ff8a85" }}>✘ Bilan d'attributs en déficit (indicatif)</span>}
                  <div className="muted" style={{ fontSize: "0.85em" }}>
                    {Object.entries(ATTRS).map(([k, label]) => {
                      const v = result.bilan[k] ?? 0;
                      const n = Object.values(result.maisonsParPalier).reduce((a, b) => a + b, 0) || 1;
                      return <span key={k} style={{ marginRight: 8, color: v < 0 ? "#ff8a85" : undefined }}>{label} {(v / n).toFixed(1)}/maison</span>;
                    })}
                  </div>
                </div>
                {result.nomenclature.biens.some((b) => b.source === "import") && (
                  <div className="muted" style={{ fontSize: "0.85em", marginTop: 6 }}>
                    À importer : {result.nomenclature.biens.filter((b) => b.source === "import").slice(0, 12)
                      .map((b) => `${b.nom} ${b.parMinute}/min`).join(" · ")}
                  </div>
                )}
                {result.avertissements.map((a) => <div key={a} className="muted" style={{ fontSize: "0.85em" }}>⚠ {a}</div>)}
                <div className="muted" style={{ fontSize: "0.85em", marginTop: 6 }}>
                  Sol de l'île : maisons {result.qualite.pct.residence} % · services {result.qualite.pct.service} %
                  · production {result.qualite.pct.production} % · routes {result.qualite.pct.roads} % · libre {result.qualite.pct.free} %
                </div>
                <button type="button" className="primary" style={{ marginTop: 8 }} onClick={poser}>Placer sur l'île</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
