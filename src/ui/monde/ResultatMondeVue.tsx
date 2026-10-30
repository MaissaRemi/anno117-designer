import { useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { buildIslandGrid } from "../../data/islandGrid";
import { islandById } from "../../data/islands";
import { goodName } from "../../economy/economy";
import { makeLookup } from "../../engine/rules";
import type { ConfigurationMonde } from "../../monde/configuration";
import type { IleCalculee, ResultatMonde } from "../../monde/calcul";
import { PlanPreview } from "../components/PlanPreview";

/**
 * LE RÉSULTAT D'UN CALCUL DE MONDE : le bilan, chaque île (son plan, ce qu'elle produit et
 * consomme, ses manques), les flux entre îles, et ce qui manque au monde, avec la raison.
 */

const fr = (v: number) => v.toLocaleString("fr", { maximumFractionDigits: 2 });
const nomCourt = (ileId: string) => (islandById(ileId)?.name ?? ileId).replace(/ \((Roman|Celtic)\)$/, "");
const ROLES: Record<IleCalculee["role"], string> = { principale: "Île principale", production: "Île de production", inutilisee: "Sans production" };

export function ResultatMondeVue({ c, r }: { c: ConfigurationMonde; r: ResultatMonde }) {
  const nomDe = (cle: string) => {
    const i = c.iles.find((x) => x.cle === cle);
    return i ? i.libelle ?? nomCourt(i.ileId) : cle;
  };
  // les flux, regroupés par route
  const routes = useMemo(() => {
    const m = new Map<string, { de: string; vers: string; biens: { good: string; parMinute: number }[]; total: number }>();
    for (const f of r.flux) {
      const k = `${f.de}>${f.vers}`;
      const x = m.get(k) ?? { de: f.de, vers: f.vers, biens: [], total: 0 };
      x.biens.push({ good: f.good, parMinute: f.parMinute });
      x.total += f.parMinute;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [r.flux]);

  return (
    <div className="monde-resultat">
      <div className="monde-bilan">
        <div><b>{fr(r.bilan.habitants)}</b><span className="muted">habitants</span></div>
        <div><b>{fr(r.bilan.argent)}</b><span className="muted">argent / min (îles principales)</span></div>
        <div><b>{fr(r.bilan.maisons)}</b><span className="muted">maisons</span></div>
        <div><b>{routes.length}</b><span className="muted">routes commerciales</span></div>
        <div className={r.deficits.length ? "manque" : ""}><b>{r.deficits.length}</b><span className="muted">bien(s) en manque</span></div>
      </div>
      <p className="muted">Calculé le {new Date(r.calculeLe).toLocaleString("fr")}. Sans navires : les flux sont des débits en régime établi.</p>
      {r.avertissements.map((a) => <div key={a} className="warn">{a}</div>)}

      <h4>Îles</h4>
      <div className="monde-iles-resultat">
        {r.iles.map((i) => <CarteIle key={i.cle} c={c} i={i} nom={nomDe(i.cle)} />)}
      </div>

      {r.deficits.length > 0 && (
        <>
          <h4>Ce qui manque au monde</h4>
          <table className="monde-table">
            <thead><tr><th>Bien</th><th>u/min</th><th>Pourquoi</th></tr></thead>
            <tbody>
              {r.deficits.map((d) => <tr key={d.good}><td>{goodName(d.good)}</td><td>{fr(d.parMinute)}</td><td className="muted">{d.raison}</td></tr>)}
            </tbody>
          </table>
        </>
      )}

      <h4>Routes commerciales</h4>
      {!routes.length && <p className="muted">Aucun échange entre îles.</p>}
      {routes.map((rt) => (
        <div key={`${rt.de}>${rt.vers}`} className="monde-route">
          <b>{nomDe(rt.de)} → {nomDe(rt.vers)}</b>
          <span className="muted"> · {fr(rt.total)} u/min</span>
          <div className="muted">{rt.biens.map((b) => `${goodName(b.good)} ${fr(b.parMinute)}`).join(" · ")}</div>
        </div>
      ))}

      {r.bilan.surplus.length > 0 && (
        <p className="muted">Surplus (produit mais consommé nulle part) : {r.bilan.surplus.map((b) => `${goodName(b.good)} ${fr(b.parMinute)}`).join(" · ")}</p>
      )}
    </div>
  );
}

function CarteIle({ c, i, nom }: { c: ConfigurationMonde; i: IleCalculee; nom: string }) {
  const [voir, setVoir] = useState(false);
  const catalog = useStore((s) => s.catalog);
  const loadIsland = useStore((s) => s.loadIsland);
  const applyOptimization = useStore((s) => s.applyOptimization);
  const setUiMode = useStore((s) => s.setUiMode);
  const lookup = useMemo(() => makeLookup(catalog), [catalog]);
  const ile = c.iles.find((x) => x.cle === i.cle);
  const grille = useMemo(() => (voir && ile ? buildIslandGrid(ile.ileId) : undefined), [voir, ile]);

  const ouvrir = () => {
    if (!i.plan || !ile) return;
    loadIsland(ile.ileId);
    applyOptimization({
      buildings: i.plan.buildings, roads: i.plan.roads, fields: i.plan.fields, aqueducts: i.plan.aqueducts, roadType: i.plan.roadType,
      placed: i.plan.buildings.length, requested: i.plan.buildings.length, placedByDef: {}, score: 0,
      breakdown: { count: i.plan.buildings.length, roadLen: i.plan.roads.length, bboxArea: 0, coverage: 1 },
    });
    setUiMode("editor");
  };

  return (
    <div className={`monde-carte-ile ${i.role}`}>
      <div className="monde-barre">
        <b>{nom}</b>
        <span className="muted">{ROLES[i.role]}{i.palier ? ` · ${i.palier}` : ""}</span>
      </div>
      {i.role !== "inutilisee" && (
        <div className="muted">
          {fr(i.habitants)} habitants · {fr(i.maisons)} maisons{i.argent !== undefined ? ` · ${fr(i.argent)} argent/min` : ""}
        </div>
      )}
      {i.produit.length > 0 && (
        <div className="muted"><b>Produit</b> : {i.produit.map((b) => `${goodName(b.good)} ${fr(b.parMinute)}`).join(" · ")}</div>
      )}
      {i.role === "principale" && <div className="muted"><b>Consomme</b> : {i.consomme.length} biens, {fr(i.consomme.reduce((s, b) => s + b.parMinute, 0))} u/min</div>}
      {i.role === "production" && i.consomme.length > 0 && (
        <div className="muted"><b>Reçoit</b> : {i.consomme.map((b) => `${goodName(b.good)} ${fr(b.parMinute)}`).join(" · ")}</div>
      )}
      {i.role === "inutilisee" && <div className="muted">Aucun bien ne lui a été confié.</div>}
      {i.manques.length > 0 && (
        <details>
          <summary className="warn-texte">
            {i.manques.length} {i.role === "principale" ? "remarque(s) sur le plan" : "manque(s) à la pose"}
          </summary>
          <ul className="muted">{i.manques.map((m, k) => <li key={k}>{m}</li>)}</ul>
        </details>
      )}
      {i.plan && (
        <div className="monde-barre" style={{ marginTop: 6 }}>
          <button type="button" onClick={() => setVoir((v) => !v)}>{voir ? "Masquer le plan" : "Voir le plan"}</button>
          <button type="button" className="primary" onClick={ouvrir}>Ouvrir dans l'éditeur</button>
        </div>
      )}
      {voir && grille && i.plan && (
        <PlanPreview grid={grille} buildings={i.plan.buildings} roads={i.plan.roads} aqueducts={i.plan.aqueducts} lookup={lookup} roadType={i.plan.roadType} size={420} />
      )}
    </div>
  );
}
