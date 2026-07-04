import { describe, expect, it } from "vitest";
import { filterOptions } from "./chipFilter";

describe("filterOptions", () => {
  const opts = [{ value: "a", label: "Vigne" }, { value: "b", label: "Fer" }, { value: "c", label: "Olives" }];
  it("filtre par label, insensible casse/accents, exclut déjà sélectionnés", () => {
    expect(filterOptions(opts, "vig", []).map((o) => o.value)).toEqual(["a"]);
    expect(filterOptions(opts, "", ["a"]).map((o) => o.value)).toEqual(["b", "c"]);
    expect(filterOptions(opts, "OLIV", []).map((o) => o.value)).toEqual(["c"]);
    expect(filterOptions(opts, "xyz", []).length).toBe(0);
  });
});
