import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import type { BuildingDef } from "../model/types";

interface Props {
  onClose: () => void;
}

/**
 * Audit des données : liste tous les bâtiments marqués SANS route
 * (`needsRoad === false`). Pour chacun, un bouton permet de corriger la donnée
 * (« non, celui-ci a besoin d'une route ») → `needsRoad = true`. Le bâtiment
 * disparaît alors de la liste. Sert à vérifier l'extraction `<StreetActivation/>`.
 */
export function RoadAudit({ onClose }: Props) {
  const catalog = useStore((s) => s.catalog);
  const updateDef = useStore((s) => s.updateDef);
  const [query, setQuery] = useState("");
  const [fixedCount, setFixedCount] = useState(0);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((d) => !d.needsRoad)
      .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.category ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
  }, [catalog, query]);

  const roadRootCount = list.filter((d) => d.roadRoot).length;

  const requireRoad = (def: BuildingDef) => {
    updateDef({ ...def, needsRoad: true });
    setFixedCount((c) => c + 1);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal opt" onClick={(e) => e.stopPropagation()}>
        <h3>🛣 Audit : bâtiments sans route</h3>
        <p className="muted">
          {list.length} bâtiment(s) marqué(s) <b>sans route</b> (donnée <code>needsRoad=false</code>,
          extraite de <code>&lt;StreetActivation/&gt;</code>). Si l'un d'eux a en réalité besoin d'une
          route obligatoire, clique « A besoin d'une route » pour corriger la donnée.
          {roadRootCount > 0 && (
            <> {roadRootCount} sont des <b>comptoirs/entrepôts</b> (racine du réseau, normal qu'ils n'« exigent » pas de route).</>
          )}
        </p>

        <input
          type="text"
          placeholder="Filtrer (nom ou catégorie)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", marginBottom: 8 }}
        />

        {fixedCount > 0 && (
          <div className="opt-result" style={{ marginTop: 0 }}>
            ✓ {fixedCount} bâtiment(s) corrigé(s) (needsRoad → true). Pense à exporter le catalogue (JSON)
            pour conserver la correction.
          </div>
        )}

        <div className="audit-list">
          {list.length === 0 && <p className="muted">Aucun bâtiment sans route (ou tous filtrés).</p>}
          {list.map((d) => (
            <div key={d.id} className="audit-row">
              {d.icon && <img src={d.icon} alt="" width={24} height={24} />}
              <span className="audit-name">{d.name}</span>
              <span className="muted">
                {d.size.w}×{d.size.h}
                {d.category ? ` · ${d.category}` : ""}
                {d.region ? ` · ${d.region}` : ""}
                {d.roadRoot ? " · 🏪 comptoir" : ""}
                {d.placement === "water" ? " · 🌊 côtier" : ""}
                {d.field ? ` · 🌾${d.field.tiles}` : ""}
              </span>
              <button className="primary" onClick={() => requireRoad(d)} title="Corriger : needsRoad = true">
                🛣 A besoin d'une route
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
