import { describe, expect, it } from "vitest";
import { useStore } from "./store";

describe("store — uiMode/diagnostic", () => {
  it("bascule de mode et de diagnostic", () => {
    const s = () => useStore.getState();
    s().setUiMode("multi"); expect(s().uiMode).toBe("multi");
    s().setUiMode("editor"); expect(s().uiMode).toBe("editor");
    s().setDiagnostic("coverage"); expect(s().diagnostic).toBe("coverage");
    s().setDiagnostic("none"); expect(s().diagnostic).toBe("none");
  });
});
