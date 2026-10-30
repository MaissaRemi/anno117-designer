import { describe, expect, it } from "vitest";
import { useStore } from "./store";

describe("store — slice party", () => {
  it("setIslandProfile", () => {
    const s = () => useStore.getState();
    s().setIslandProfile("isl_x", { fertilities: ["f1"], mountainSlots: 2 });
    expect(s().islandProfiles["isl_x"]).toEqual({ fertilities: ["f1"], mountainSlots: 2 });
  });
});
