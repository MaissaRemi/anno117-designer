import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { CatalogEditor } from "./CatalogEditor";
import { BuildingIcon } from "./BuildingIcon";
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

  // Le catalogue ne montre QUE le monde actif : un bâtiment celtique n'est pas
  // constructible en Latium, l'afficher n'apporte que de la confusion. Les bâtiments sans
  // région déclarée sont communs aux deux mondes et restent toujours visibles.
  const world = useStore((s) => s.world);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return catalog.filter(
      (d) =>
        (!ql || d.name.toLowerCase().includes(ql) || (d.nameInternal ?? "").toLowerCase().includes(ql)) &&
        (!cat || d.category === cat) &&
        (!d.region || d.region === world),
    );
  }, [catalog, q, cat, world]);

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
            <BuildingIcon
              icon={d.icon}
              color={d.color}
              className="ci-icon"
              fallbackClassName="ci-swatch"
            />
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
