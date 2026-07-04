import { useMemo, useState } from "react";
import { filterOptions, type Opt } from "./chipFilter";

interface Props {
  options: Opt[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

/** Multiselect à chips : puces des sélectionnés (× pour retirer) + recherche + liste d'ajout.
 *  Contrôlé. Réutilisé partout (ressources d'île, etc.). */
export function ChipMultiSelect({ options, selected, onChange, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const byVal = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const matches = useMemo(() => filterOptions(options, q, selected).slice(0, 50), [options, q, selected]);
  const add = (v: string) => { onChange([...selected, v]); setQ(""); };
  const remove = (v: string) => onChange(selected.filter((x) => x !== v));
  return (
    <div className={"chip-input" + (open ? " focus" : "")}>
      {selected.map((v) => (
        <span key={v} className="chip">
          {byVal.get(v) ?? v}
          <span className="chip-x" onMouseDown={(e) => { e.preventDefault(); remove(v); }} aria-label="retirer">×</span>
        </span>
      ))}
      <input
        className="chip-search"
        value={q}
        placeholder={selected.length ? "" : (placeholder ?? "Ajouter…")}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && matches.length > 0 && (
        <div className="chip-dropdown">
          {matches.map((o) => (
            <div key={o.value} className="chip-opt" onMouseDown={(e) => { e.preventDefault(); add(o.value); }}>{o.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
