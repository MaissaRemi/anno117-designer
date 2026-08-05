import { makeLookup, validateFields, validateLayout } from "../engine/rules";
import { useStore } from "../state/store";
import { BuildingIcon } from "./BuildingIcon";

export function SidePanel() {
  const layout = useStore((s) => s.layout);
  const catalog = useStore((s) => s.catalog);
  const selectedUid = useStore((s) => s.selectedUid);
  const removeBuilding = useStore((s) => s.removeBuilding);
  const rotateBuilding = useStore((s) => s.rotateBuilding);
  const toggleLock = useStore((s) => s.toggleLock);
  const setMode = useStore((s) => s.setMode);
  const setFieldOwner = useStore((s) => s.setFieldOwner);

  const b = layout.buildings.find((x) => x.uid === selectedUid);
  if (!b) {
    return (
      <div className="panel">
        <h3>Sélection</h3>
        <p className="muted">Aucun bâtiment sélectionné. Utilise l'outil Sélection.</p>
      </div>
    );
  }
  const lookup = makeLookup(catalog);
  const def = lookup(b.defId);
  if (!def) return <div className="panel">Définition introuvable.</div>;

  const issues = validateLayout(layout, lookup).get(b.uid);
  const field = def.field ? validateFields(layout, lookup, b) : null;

  const paintField = () => {
    setFieldOwner(b.uid);
    setMode("field");
  };

  return (
    <div className="panel">
      <div className="sp-head">
        <BuildingIcon
          icon={def.icon}
          color={def.color}
          className="sp-icon"
          fallbackClassName="sp-swatch"
        />
        <h3>{def.name}</h3>
      </div>
      <p className="muted">
        {def.category}
        {def.region ? ` · ${def.region}` : ""} · {def.size.w}×{def.size.h} · pos ({b.x},{b.y}) ·{" "}
        {b.rotation}°
      </p>

      {def.production && (def.production.outputs.length > 0 || def.production.inputs.length > 0) && (
        <div className="prod">
          {def.production.inputs.length > 0 && (
            <div>
              <span className="muted">Entrées :</span>{" "}
              {def.production.inputs.map((i) => i.good).join(", ")}
            </div>
          )}
          {def.production.outputs.length > 0 && (
            <div>
              <span className="muted">Sortie :</span>{" "}
              {def.production.outputs.map((o) => o.good).join(", ")}
              {def.production.cycleTime ? ` (${def.production.cycleTime}s)` : ""}
            </div>
          )}
        </div>
      )}

      <div className="status">
        {issues && !issues.ok ? (
          <ul className="issues">
            {issues.overlap && <li>⛔ Hors grille ou chevauchement</li>}
            {issues.road && <li>🛣 Pas de route adjacente</li>}
            {field && !field.ok && (
              <li>
                🌾 Champ {field.count}/{field.required}
                {!field.connected && " · non connecté"}
                {!field.touchesBuilding && " · ne touche pas le bâtiment"}
              </li>
            )}
          </ul>
        ) : (
          <p className="ok">✓ Valide</p>
        )}
      </div>

      <div className="btn-row">
        <button onClick={() => rotateBuilding(b.uid)} disabled={!def.rotatable}>
          ⟳ Pivoter
        </button>
        <button className={b.locked ? "active" : ""} onClick={() => toggleLock(b.uid)}>
          {b.locked ? "🔒 Verrouillé" : "🔓 Libre"}
        </button>
      </div>

      {def.field && (
        <button className="wide" onClick={paintField}>
          🌾 Peindre le champ ({field?.count ?? 0}/{def.field.tiles})
        </button>
      )}

      <button className="wide danger" onClick={() => removeBuilding(b.uid)}>
        🗑 Supprimer
      </button>
    </div>
  );
}
