import { useState } from "react";
import { makeBuildingDef } from "../model/factories";
import type { BuildingDef } from "../model/types";
import { useStore } from "../state/store";
import { Modal } from "./Modal";

interface Props {
  initial: BuildingDef | null; // null => nouveau
  onClose: () => void;
}

const CATEGORIES = ["production", "residentiel", "public", "ornement", "militaire"];

export function CatalogEditor({ initial, onClose }: Props) {
  const addDef = useStore((s) => s.addDef);
  const updateDef = useStore((s) => s.updateDef);

  const [d, setD] = useState<BuildingDef>(initial ?? makeBuildingDef());
  const [hasField, setHasField] = useState(!!d.field);
  const [hasRadius, setHasRadius] = useState(!!d.radius);

  const set = (patch: Partial<BuildingDef>) => setD((cur) => ({ ...cur, ...patch }));

  const save = () => {
    const out: BuildingDef = {
      ...d,
      field: hasField ? d.field ?? { tiles: 8, fieldType: "ble" } : undefined,
      radius: hasRadius ? d.radius ?? { kind: "service", range: 10 } : undefined,
    };
    if (initial) updateDef(out);
    else addDef(out);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <h3>{initial ? "Éditer le bâtiment" : "Nouveau bâtiment"}</h3>

        <label>
          Nom
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <label>
          Catégorie
          <select value={d.category} onChange={(e) => set({ category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <div className="row">
          <label>
            Largeur
            <input
              type="number"
              min={1}
              value={d.size.w}
              onChange={(e) => set({ size: { ...d.size, w: clampInt(e.target.value) } })}
            />
          </label>
          <label>
            Hauteur
            <input
              type="number"
              min={1}
              value={d.size.h}
              onChange={(e) => set({ size: { ...d.size, h: clampInt(e.target.value) } })}
            />
          </label>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={d.needsRoad}
            onChange={(e) => set({ needsRoad: e.target.checked })}
          />
          Nécessite une route
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={d.rotatable}
            onChange={(e) => set({ rotatable: e.target.checked })}
          />
          Rotation possible
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={hasField} onChange={(e) => setHasField(e.target.checked)} />
          Champ / module requis
        </label>
        {hasField && (
          <div className="row indent">
            <label>
              Cases
              <input
                type="number"
                min={1}
                value={d.field?.tiles ?? 8}
                onChange={(e) =>
                  set({ field: { tiles: clampInt(e.target.value), fieldType: d.field?.fieldType ?? "ble" } })
                }
              />
            </label>
            <label>
              Type de champ
              <input
                value={d.field?.fieldType ?? "ble"}
                onChange={(e) =>
                  set({ field: { tiles: d.field?.tiles ?? 8, fieldType: e.target.value } })
                }
              />
            </label>
          </div>
        )}

        <label className="checkbox">
          <input type="checkbox" checked={hasRadius} onChange={(e) => setHasRadius(e.target.checked)} />
          Rayon (service / boost)
        </label>
        {hasRadius && (
          <div className="row indent">
            <label>
              Type
              <select
                value={d.radius?.kind ?? "service"}
                onChange={(e) =>
                  set({ radius: { kind: e.target.value as "service" | "boost", range: d.radius?.range ?? 10 } })
                }
              >
                <option value="service">service</option>
                <option value="boost">boost</option>
              </select>
            </label>
            <label>
              Portée
              <input
                type="number"
                min={1}
                value={d.radius?.range ?? 10}
                onChange={(e) =>
                  set({ radius: { kind: d.radius?.kind ?? "service", range: clampInt(e.target.value) } })
                }
              />
            </label>
          </div>
        )}

        <label>
          Couleur
          <input type="color" value={d.color} onChange={(e) => set({ color: e.target.value })} />
        </label>

        <div className="modal-actions">
          <button onClick={onClose}>Annuler</button>
          <button className="primary" onClick={save} disabled={!d.name.trim()}>
            Enregistrer
          </button>
        </div>
    </Modal>
  );
}

function clampInt(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
