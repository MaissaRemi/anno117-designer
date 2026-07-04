import { describe, expect, it } from "vitest";
import { emptyParty, normalizeParty } from "./party";

describe("party — normalisation", () => {
  it("vide/absent → défauts", () => {
    expect(normalizeParty(null)).toEqual(emptyParty());
    expect(normalizeParty({})).toEqual({ partyIslands: [], islandProfiles: {} });
  });
  it("partiel → complété", () => {
    const r = normalizeParty({ partyIslands: ["a"] });
    expect(r.partyIslands).toEqual(["a"]);
    expect(r.islandProfiles).toEqual({});
  });
  it("profils conservés", () => {
    const prof = { fertilities: ["f1"], mountainSlots: 3 };
    const r = normalizeParty({ partyIslands: ["a"], islandProfiles: { a: prof } });
    expect(r.islandProfiles.a).toEqual(prof);
  });
  it("garbage → défauts (pas de crash)", () => {
    expect(normalizeParty({ partyIslands: "nope", islandProfiles: 5 })).toEqual(emptyParty());
  });
});
