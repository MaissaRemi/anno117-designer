import { Catalog } from "./Catalog";
import { GridCanvas } from "./GridCanvas";
import { SidePanel } from "./SidePanel";
import { Toolbar } from "./Toolbar";

/** Vue ÉDITEUR (canvas + catalogue + panneau). Extraite d'App pour la bascule d'onglets. */
export function EditorView() {
  return (
    <>
      <Toolbar />
      <div className="main">
        <aside className="left">
          <Catalog />
        </aside>
        <GridCanvas />
        <aside className="right">
          <SidePanel />
        </aside>
      </div>
    </>
  );
}
