import { useMemo } from "react";
import { islands, regionOfIsland, WORLDS, worldLabel } from "../data/islands";
import { useStore } from "../state/store";
import { Modal } from "./Modal";
import { IslandThumb } from "./components/IslandThumb";

interface Props {
  onClose: () => void;
}

export function IslandPicker({ onClose }: Props) {
  const loadIsland = useStore((s) => s.loadIsland);
  const hasWork = useStore((s) => s.layout.buildings.length > 0 || s.layout.roads.length > 0);
  const world = useStore((s) => s.world);
  const setWorld = useStore((s) => s.setWorld);
  // Les îles DLC sont romaines : elles suivent le Latium.
  const list = useMemo(
    () => islands.filter((i) => regionOfIsland(i.id) === world),
    [world],
  );

  // On ne demande confirmation que s'il y a QUELQUE CHOSE À PERDRE. Sur une grille vide,
  // une boîte de dialogue à chaque clic n'est qu'un obstacle — et une fenêtre native
  // refusée (navigateur qui les bloque) donnait l'impression que le bouton ne marchait pas.
  const choose = (id: string) => {
    if (hasWork && !confirm("Charger cette île ? La disposition actuelle sera remplacée.")) return;
    loadIsland(id);
    onClose();
  };

  return (
    <Modal className="islands" onClose={onClose}>
      <div className="panel-head">
          <h3>🏝 Îles — {worldLabel(world)} ({list.length})</h3>
          {/* La bascule vit aussi dans la barre de navigation, mais cette fenêtre la
              recouvre : sans copie ici, on ne pouvait tout simplement pas atteindre les
              îles d'Albion depuis le sélecteur. */}
          <div className="world-switch" role="group" aria-label="Monde de jeu">
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
        </div>

        <div className="island-grid">
          {list.map((isl) => (
            <button key={isl.id} className="island-card" onClick={() => choose(isl.id)} title={isl.id}>
              <IslandThumb island={isl} />
              <span className="island-name">{isl.name}</span>
              <span className="muted">
                {isl.size.w}×{isl.size.h}
              </span>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
    </Modal>
  );
}
