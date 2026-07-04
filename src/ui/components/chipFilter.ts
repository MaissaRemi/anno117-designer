export interface Opt { value: string; label: string; }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtre pur : options dont le label matche `query` (insensible casse/accents), hors déjà sélectionnés. */
export function filterOptions(options: Opt[], query: string, selected: string[]): Opt[] {
  const q = norm(query.trim());
  const sel = new Set(selected);
  return options.filter((o) => !sel.has(o.value) && (!q || norm(o.label).includes(q)));
}
