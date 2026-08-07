import { useEffect, useMemo, useRef } from "react";
import { decodeMask, islands, regionOfIsland, WORLDS, worldLabel, type Island } from "../data/islands";
import { useStore } from "../state/store";
import { Modal } from "./Modal";

interface Props {
  onClose: () => void;
}

function IslandThumb({ island, size = 64 }: { island: Island; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { w, h } = island.size;
    const mask = decodeMask(island.mask, w, h);
    ctx.clearRect(0, 0, size, size);
    const scale = size / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;
    // échantillonnage : 1 px de sortie
    const img = ctx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const gx = Math.floor((px - ox) / scale);
        const gy = Math.floor((py - oy) / scale);
        const land = gx >= 0 && gy >= 0 && gx < w && gy < h && mask[gy * w + gx];
        const o = (py * size + px) * 4;
        if (land) {
          img.data[o] = 124;
          img.data[o + 1] = 179;
          img.data[o + 2] = 66;
          img.data[o + 3] = 255;
        } else {
          img.data[o + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [island, size]);
  return <canvas ref={ref} width={size} height={size} className="island-thumb" />;
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
