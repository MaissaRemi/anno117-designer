import { lazy, Suspense } from "react";
import { useStore } from "../../state/store";
import { NavRail } from "./NavRail";
import { TopBar } from "../TopBar";
import { EditorView } from "../EditorView";
import { MultiIslandPanel } from "../MultiIslandPanel";
import { IslandPlanner } from "../IslandPlanner";
import { ProdLayoutView } from "../ProdLayoutView";

// L'onglet Commande embarque la nomenclature, les îlots et les blueprints : chargé à la demande,
// il garde le paquet principal sous la limite du build (700 kB) au lieu de la porter à 784.
const CommandePlanner = lazy(() => import("../CommandePlanner").then((m) => ({ default: m.CommandePlanner })));

/** Coquille de l'application : nav latérale + barre du haut + contenu du mode courant. */
export function AppShell() {
  const uiMode = useStore((s) => s.uiMode);
  const setUiMode = useStore((s) => s.setUiMode);
  return (
    <div className="app">
      <NavRail />
      <div className="app-col">
        <TopBar />
        <div className="mode-content">
          {uiMode === "editor" && <EditorView />}
          {uiMode === "commande" && (
            <Suspense fallback={<p className="muted" style={{ padding: 16 }}>Chargement…</p>}>
              <CommandePlanner />
            </Suspense>
          )}
          {uiMode === "multi" && <MultiIslandPanel />}
          {uiMode === "island" && <IslandPlanner asView onClose={() => setUiMode("editor")} />}
          {uiMode === "prod" && <ProdLayoutView />}
        </div>
      </div>
    </div>
  );
}
