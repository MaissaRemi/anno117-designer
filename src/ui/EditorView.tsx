import { useStore } from "../state/store";
import { Catalog } from "./Catalog";
import { GridCanvas } from "./GridCanvas";
import { SidePanel } from "./SidePanel";
import { ToolPalette } from "./ToolPalette";
import { CoveragePanel } from "./CoveragePanel";
import { RoadAudit } from "./RoadAudit";

/** Vue ÉDITEUR : catalogue · canvas (avec palette flottante + toggles diagnostics) · panneau
 *  droit qui montre l'inspecteur ou un diagnostic (couverture / audit routes). */
export function EditorView() {
  const diagnostic = useStore((s) => s.diagnostic);
  const setDiagnostic = useStore((s) => s.setDiagnostic);
  const toggle = (d: "coverage" | "audit") => setDiagnostic(diagnostic === d ? "none" : d);

  return (
    <div className="editor-root">
      <div className="main">
        <aside className="panel">
          <div className="panel-body"><Catalog /></div>
        </aside>

        <div className="canvas-host">
          <GridCanvas />
          <ToolPalette />
          <div className="diag-bar">
            <button className={diagnostic === "coverage" ? "active" : ""} onClick={() => toggle("coverage")}>📡 Couverture</button>
            <button className={diagnostic === "audit" ? "active" : ""} onClick={() => toggle("audit")}>🛣 Audit</button>
          </div>
        </div>

        <aside className="panel right">
          {diagnostic === "none" && <div className="panel-body"><SidePanel /></div>}
          {diagnostic === "coverage" && <CoveragePanel asPanel onClose={() => setDiagnostic("none")} />}
          {diagnostic === "audit" && <RoadAudit asPanel onClose={() => setDiagnostic("none")} />}
        </aside>
      </div>
    </div>
  );
}
