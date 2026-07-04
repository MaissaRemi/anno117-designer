import { useStore, type Tool } from "../state/store";

const GROUPS: { id: Tool; label: string; icon: string }[][] = [
  [
    { id: "select", label: "Sélection", icon: "↖" },
    { id: "move", label: "Déplacer", icon: "✋" },
  ],
  [
    { id: "road", label: "Route", icon: "🛣" },
    { id: "field", label: "Champ (bâtiment sélectionné)", icon: "🌾" },
    { id: "erase", label: "Gomme (routes / champs)", icon: "🧽" },
  ],
  [
    { id: "draw-grid", label: "Dessiner la grille", icon: "▦" },
    { id: "erase-grid", label: "Masquer des cases", icon: "▢" },
  ],
];

/** Palette d'outils flottante (verticale) sur le canvas — remplace la barre horizontale. */
export function ToolPalette() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const selectedUid = useStore((s) => s.selectedUid);
  const setFieldOwner = useStore((s) => s.setFieldOwner);
  const rotation = useStore((s) => s.rotation);
  const rotateCurrent = useStore((s) => s.rotateCurrent);
  const showRadius = useStore((s) => s.showRadius);
  const toggleRadius = useStore((s) => s.toggleRadius);
  const diagonalBuild = useStore((s) => s.diagonalBuild);
  const toggleDiagonalBuild = useStore((s) => s.toggleDiagonalBuild);

  const pick = (t: Tool) => {
    if (t === "field") setFieldOwner(selectedUid);
    setMode(t);
  };

  return (
    <div className="tool-palette">
      {GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: "contents" }}>
          {gi > 0 && <span className="tool-sep" />}
          {group.map((t) => (
            <button
              key={t.id}
              className={"tool" + (mode === t.id ? " active" : "")}
              title={t.label}
              aria-label={t.label}
              onClick={() => pick(t.id)}
              disabled={t.id === "field" && !selectedUid}
            >
              {t.icon}
            </button>
          ))}
        </div>
      ))}
      <span className="tool-sep" />
      <button className={"tool" + (diagonalBuild ? " active" : "")} title="Construction à 45°" aria-label="45 degrés" onClick={toggleDiagonalBuild}>◇</button>
      <button className="tool tool-rot" title={`Pivoter (R) — ${diagonalBuild ? 45 : 90}°`} aria-label="Pivoter" onClick={rotateCurrent}>
        <span>⟳</span><span>{rotation}°</span>
      </button>
      <button className={"tool" + (showRadius ? " active" : "")} title="Afficher les rayons" aria-label="Rayons" onClick={toggleRadius}>◎</button>
    </div>
  );
}
