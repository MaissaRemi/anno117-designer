import { describe, expect, it } from "vitest";
import { useStore } from "./store";

describe("store — slice party", () => {
  it("setIslandProfile / addPartyIsland / removePartyIsland", () => {
    const s = () => useStore.getState();
    s().setIslandProfile("isl_x", { fertilities: ["f1"], mountainSlots: 2 });
    expect(s().islandProfiles["isl_x"]).toEqual({ fertilities: ["f1"], mountainSlots: 2 });
    s().addPartyIsland("isl_x");
    s().addPartyIsland("isl_x"); // idempotent
    expect(s().partyIslands.filter((i) => i === "isl_x").length).toBe(1);
    s().removePartyIsland("isl_x");
    expect(s().partyIslands).not.toContain("isl_x");
  });
});
