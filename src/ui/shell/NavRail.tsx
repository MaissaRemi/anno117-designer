import { useStore } from "../../state/store";

const ITEMS = [
  { id: "editor", label: "Éditeur", icon: "🗺" },
  { id: "island", label: "Plan d'île", icon: "🏛" },
  { id: "multi", label: "Multi-îles", icon: "🏝" },
] as const;

/** Barre de navigation latérale : bascule entre les 3 modes de l'application. */
export function NavRail() {
  const uiMode = useStore((s) => s.uiMode);
  const setUiMode = useStore((s) => s.setUiMode);
  return (
    <nav className="nav-rail">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={"nav-item" + (uiMode === it.id ? " active" : "")}
          onClick={() => setUiMode(it.id)}
        >
          <span className="nav-ico" aria-hidden>{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
