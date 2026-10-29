import { lazy, Suspense } from "react";
import { useStore } from "../state/store";
import { IslandPlanner } from "./IslandPlanner";
import { MultiIslandPanel } from "./MultiIslandPanel";

// L'onglet Commande embarque la nomenclature, les îlots et les blueprints : chargé à la demande,
// il garde le paquet principal sous la limite du build (700 kB) au lieu de la porter à 784.
const CommandePlanner = lazy(() => import("./CommandePlanner").then((m) => ({ default: m.CommandePlanner })));

const MODES = [
  { id: "commande", titre: "Ma commande", sous: "Je choisis les maisons et les bâtiments" },
  { id: "remplir", titre: "Remplir l'île", sous: "Le plus d'habitants, ou de maisons, possible" },
  { id: "iles", titre: "Plusieurs îles", sous: "Répartir population et production" },
] as const;

/**
 * Écran Planifier : un seul point d'entrée pour planifier, avec trois façons de le faire
 * (commande à la main, remplissage automatique d'une île, répartition sur plusieurs îles).
 * Les planificateurs restent inchangés ; seul le commutateur du haut choisit lequel s'affiche.
 */
export function PlanifierView() {
  const planMode = useStore((s) => s.planMode);
  const setPlanMode = useStore((s) => s.setPlanMode);
  const setUiMode = useStore((s) => s.setUiMode);
  return (
    <div className="plan-view">
      <div className="plan-switch" role="tablist">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={planMode === m.id}
            className={planMode === m.id ? "active" : ""} onClick={() => setPlanMode(m.id)}>
            <b>{m.titre}</b>
            <span className="sub">{m.sous}</span>
          </button>
        ))}
      </div>
      {planMode === "commande" && (
        <Suspense fallback={<p className="muted" style={{ padding: 16 }}>Chargement…</p>}>
          <CommandePlanner />
        </Suspense>
      )}
      {planMode === "remplir" && <IslandPlanner onClose={() => setUiMode("editor")} />}
      {planMode === "iles" && <MultiIslandPanel />}
    </div>
  );
}
