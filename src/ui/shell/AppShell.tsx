import { lazy, Suspense } from "react";
import { useStore } from "../../state/store";
import { NavRail } from "./NavRail";
import { TopBar } from "../TopBar";
import { EditorView } from "../EditorView";
import { PlanifierView } from "../PlanifierView";

// L'onglet Monde est chargé à la demande, comme l'onglet Commande.
const MondeView = lazy(() => import("../MondeView").then((m) => ({ default: m.MondeView })));

/** Coquille de l'application : nav latérale + barre du haut + contenu du mode courant. */
export function AppShell() {
  const uiMode = useStore((s) => s.uiMode);
  return (
    <div className="app">
      <NavRail />
      <div className="app-col">
        <TopBar />
        <div className="mode-content">
          {uiMode === "editor" && <EditorView />}
          {uiMode === "plan" && <PlanifierView />}
          {uiMode === "monde" && (
            <Suspense fallback={<p className="muted" style={{ padding: 16 }}>Chargement…</p>}>
              <MondeView />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
