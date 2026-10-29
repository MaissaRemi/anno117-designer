import { describe, expect, it } from "vitest";
import { useStore } from "./store";

describe("store — uiMode/diagnostic", () => {
  it("bascule de mode et de diagnostic", () => {
    const s = () => useStore.getState();
    s().setUiMode("plan"); expect(s().uiMode).toBe("plan");
    s().setUiMode("editor"); expect(s().uiMode).toBe("editor");
    expect(s().planMode).toBe("commande");
    s().setPlanMode("iles"); expect(s().planMode).toBe("iles");
    s().setPlanMode("commande");
    s().setDiagnostic("coverage"); expect(s().diagnostic).toBe("coverage");
    s().setDiagnostic("none"); expect(s().diagnostic).toBe("none");
  });
});
