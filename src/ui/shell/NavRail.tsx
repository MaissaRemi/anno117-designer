import { useStore } from "../../state/store";
import { WORLDS } from "../../data/islands";

const ITEMS = [
  { id: "editor", label: "Éditeur", icon: "🗺" },
  { id: "island", label: "Plan d'île", icon: "🏛" },
  { id: "multi", label: "Multi-îles", icon: "🏝" },
] as const;

/** Barre de navigation latérale : modes de l'application + bascule de MONDE. */
export function NavRail() {
  const uiMode = useStore((s) => s.uiMode);
  const setUiMode = useStore((s) => s.setUiMode);
  const world = useStore((s) => s.world);
  const setWorld = useStore((s) => s.setWorld);
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
      {/* Le Latium et l'Albion n'ont ni les mêmes bâtiments, ni les mêmes paliers, ni les
          mêmes chaînes. L'interface ne montre que le monde actif — catalogue, îles et
          paliers visés suivent cette bascule. */}
      <div className="world-switch" title="Monde de jeu : Latium (romain) ou Albion (celtique)">
        {WORLDS.map((w) => (
          <button
            key={w.region}
            className={world === w.region ? "active" : ""}
            onClick={() => setWorld(w.region)}
          >
            {w.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
