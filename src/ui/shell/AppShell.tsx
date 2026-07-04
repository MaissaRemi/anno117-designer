import { useStore } from "../../state/store";
import { NavRail } from "./NavRail";
import { TopBar } from "../TopBar";
import { EditorView } from "../EditorView";
import { MultiIslandPanel } from "../MultiIslandPanel";
import { IslandPlanner } from "../IslandPlanner";

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
          {uiMode === "multi" && <MultiIslandPanel />}
          {uiMode === "island" && <IslandPlanner asView onClose={() => setUiMode("editor")} />}
        </div>
      </div>
    </div>
  );
}
