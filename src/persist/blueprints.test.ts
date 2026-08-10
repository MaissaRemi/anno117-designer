import { beforeEach, describe, expect, it } from "vitest";
import { deleteBlueprint, listBlueprints, saveBlueprint } from "./blueprints";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const bp = { name: "Pain ×2", targetDefId: "g3174", count: 2, imported: [] };

describe("bibliothèque de blueprints", () => {
  it("part vide", () => {
    expect(listBlueprints()).toEqual([]);
  });

  it("enregistre et relit", () => {
    saveBlueprint(bp);
    expect(listBlueprints()).toEqual([bp]);
  });

  it("un même nom écrase au lieu de doubler", () => {
    saveBlueprint(bp);
    saveBlueprint({ ...bp, count: 4 });
    expect(listBlueprints()).toHaveLength(1);
    expect(listBlueprints()[0].count).toBe(4);
  });

  it("supprime par nom", () => {
    saveBlueprint(bp);
    deleteBlueprint("Pain ×2");
    expect(listBlueprints()).toEqual([]);
  });

  it("ne jette pas sur un contenu corrompu", () => {
    store.set("anno117-designer:blueprints:v1", "{pas du json");
    expect(listBlueprints()).toEqual([]);
  });
});
