import { useMemo } from "react";
import { economy } from "../economy/economy";
import type { ResourceProfile } from "../economy/resources";

interface Props {
  value: ResourceProfile;
  onChange: (next: ResourceProfile) => void;
}

/** Édite un ResourceProfile : cases fertilités/gisements + nb de slots montagne.
 *  Contrôlé (value/onChange). Réutilisé en mono-île ET multi-îles (zéro duplication). */
export function ResourceSelector({ value, onChange }: Props) {
  const ferts = useMemo(
    () => Object.entries(economy.fertilities).map(([guid, name]) => ({ guid, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const have = new Set(value.fertilities);
  const toggle = (guid: string) => {
    const next = new Set(have);
    if (next.has(guid)) next.delete(guid);
    else next.add(guid);
    onChange({ ...value, fertilities: [...next] });
  };
  return (
    <div className="resource-selector">
      <label className="rs-slots">
        Slots montagne (mines)
        <input
          type="number" min={0} value={value.mountainSlots}
          onChange={(e) => onChange({ ...value, mountainSlots: Math.max(0, parseInt(e.target.value) || 0) })}
          style={{ width: 60, marginLeft: 6 }}
        />
      </label>
      <div className="rs-ferts" style={{ maxHeight: 180, overflow: "auto", marginTop: 6 }}>
        {ferts.map((f) => (
          <label key={f.guid} className="checkbox" style={{ display: "block" }}>
            <input type="checkbox" checked={have.has(f.guid)} onChange={() => toggle(f.guid)} /> {f.name}
          </label>
        ))}
      </div>
    </div>
  );
}
