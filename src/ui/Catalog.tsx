import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { CatalogEditor } from "./CatalogEditor";
import type { BuildingDef } from "../model/types";

const CATS = ["production", "public", "residentiel", "ornement", "militaire"];

export function Catalog() {
  const catalog = useStore((s) => s.catalog);
  const selectedDefId = useStore((s) => s.selectedDefId);
  const setSelectedDef = useStore((s) => s.setSelectedDef);
  const removeDef = useStore((s) => s.removeDef);
  const [editing, setEditing] = useState<BuildingDef | "new" | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [region, setRegion] = useState<string>("");

  const regions = useMemo(
    () => Array.from(new Set(catalog.map((d) => d.region).filter(Boolean))) as string[],
    [catalog],
  );

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return catalog.filter(
      (d) =>
        (!ql || d.name.toLowerCase().includes(ql) || (d.nameInternal ?? "").toLowerCase().includes(ql)) &&
        (!cat || d.category === cat) &&
        (!region || d.region === region),
    );
  }, [catalog, q, cat, region]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Catalogue ({filtered.length})</h3>
        <button onClick={() => setEditing("new")}>+ Bâtiment</button>
      </div>

      <input
        className="search"
        placeholder="Rechercher…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="filters">
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Toutes catégories</option>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {regions.length > 0 && (
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Toutes régions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="catalog-list">
        {filtered.length === 0 && <p className="muted">Aucun résultat.</p>}
        {filtered.map((d) => (
          <div
            key={d.id}
            className={"catalog-item" + (d.id === selectedDefId ? " active" : "")}
            onClick={() => setSelectedDef(d.id)}
            title={d.nameInternal ?? d.name}
          >
            {d.icon ? (
              <img className="ci-icon" src={`/${d.icon}`} alt="" loading="lazy" />
            ) : (
              <span className="swatch" style={{ background: d.color }} />
            )}
            <span className="ci-name">
              {d.name}
              <small>
                {" "}
                {d.size.w}×{d.size.h}
                {d.field ? ` · champ ${d.field.tiles}` : ""}
                {d.radius ? ` · ◎${d.radius.range}` : ""}
                {d.needsRoad ? " · 🛣" : ""}
              </small>
            </span>
            <span className="ci-actions">
              <button
                title="Éditer"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(d);
                }}
              >
                ✎
              </button>
              <button
                title="Supprimer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Supprimer « ${d.name} » du catalogue ?`)) removeDef(d.id);
                }}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>

      {editing && (
        <CatalogEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
