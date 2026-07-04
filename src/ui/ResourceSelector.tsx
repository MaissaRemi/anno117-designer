import { useMemo } from "react";
import { economy } from "../economy/economy";
import type { ResourceProfile } from "../economy/resources";
import { ChipMultiSelect } from "./components/ChipMultiSelect";

interface Props {
  value: ResourceProfile;
  onChange: (next: ResourceProfile) => void;
}

/** Édite un ResourceProfile : multiselect à chips des fertilités/gisements + nb de slots
 *  montagne. Contrôlé. Réutilisé en mono-île ET multi-îles (zéro duplication). */
export function ResourceSelector({ value, onChange }: Props) {
  const options = useMemo(
    () => Object.entries(economy.fertilities).map(([v, label]) => ({ value: v, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );
  return (
    <div className="resource-selector">
      <ChipMultiSelect
        options={options}
        selected={value.fertilities}
        onChange={(ferts) => onChange({ ...value, fertilities: ferts })}
        placeholder="Ajouter une fertilité / gisement…"
      />
      <label className="rs-slots">
        <span>⛰ Slots montagne (mines)</span>
        <input type="number" min={0} value={value.mountainSlots}
          onChange={(e) => onChange({ ...value, mountainSlots: Math.max(0, parseInt(e.target.value) || 0) })} />
      </label>
    </div>
  );
}
