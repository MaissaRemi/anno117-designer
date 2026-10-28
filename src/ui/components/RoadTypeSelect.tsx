import { ROAD_TYPES, type RoadType } from "../../engine/roads";

interface Props {
  value: RoadType;
  onChange: (t: RoadType) => void;
}

/**
 * Choix du type de route d'un plan. Le libellé dit pourquoi il compte : une route pavée ou en
 * marbre allonge la portée de chaque service de moitié, donc il en faut beaucoup moins.
 */
export function RoadTypeSelect({ value, onChange }: Props) {
  return (
    <div className="field">
      <span>Routes</span>
      <select value={value} onChange={(e) => onChange(e.target.value as RoadType)}>
        {ROAD_TYPES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}{r.factor !== 1 ? ` — portée ×${String(r.factor).replace(".", ",")}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
