import { useEffect } from "react";
import { AppShell } from "./ui/shell/AppShell";
import { useStore } from "./state/store";

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.key.toLowerCase() === "r") {
        if (s.selectedUid && s.mode !== "place") s.rotateBuilding(s.selectedUid);
        else s.rotateCurrent();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selectedUid) s.removeBuilding(s.selectedUid);
      } else if (e.key === "Escape") {
        s.setSelectedDef(null);
        s.setMode("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <AppShell />;
}
