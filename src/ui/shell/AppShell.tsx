import { useStore } from "../../state/store";
import { NavRail } from "./NavRail";
import { TopBar } from "../TopBar";
import { EditorView } from "../EditorView";
import { PlanifierView } from "../PlanifierView";
import { ProdLayoutView } from "../ProdLayoutView";

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
          {uiMode === "prod" && <ProdLayoutView />}
        </div>
      </div>
    </div>
  );
}
