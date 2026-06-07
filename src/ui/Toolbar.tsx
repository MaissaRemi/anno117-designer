import { useStore, type Tool } from "../state/store";

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "select", label: "↖ Sélection", title: "Sélectionner un bâtiment" },
  { id: "move", label: "✋ Déplacer", title: "Déplacer un bâtiment (non verrouillé)" },
  { id: "draw-grid", label: "▦ Dessiner", title: "Peindre les cases utilisables" },
  { id: "erase-grid", label: "▢ Masquer", title: "Retirer des cases de la grille" },
  { id: "road", label: "🛣 Route", title: "Peindre des routes" },
  { id: "field", label: "🌾 Champ", title: "Peindre le champ du bâtiment sélectionné" },
  { id: "erase", label: "🧽 Gomme", title: "Effacer routes / champs" },
];

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const rotateCurrent = useStore((s) => s.rotateCurrent);
  const rotation = useStore((s) => s.rotation);
  const showRadius = useStore((s) => s.showRadius);
  const toggleRadius = useStore((s) => s.toggleRadius);
  const selectedUid = useStore((s) => s.selectedUid);
  const setFieldOwner = useStore((s) => s.setFieldOwner);

  const pick = (t: Tool) => {
    if (t === "field") setFieldOwner(selectedUid);
    setMode(t);
  };

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={mode === t.id ? "active" : ""}
          title={t.title}
          onClick={() => pick(t.id)}
          disabled={t.id === "field" && !selectedUid}
        >
          {t.label}
        </button>
      ))}
      <span className="sep" />
      <button title="Pivoter la pose (R)" onClick={rotateCurrent}>
        ⟳ {rotation}°
      </button>
      <button className={showRadius ? "active" : ""} onClick={toggleRadius} title="Afficher les rayons">
        ◎ Rayons
      </button>
    </div>
  );
}
