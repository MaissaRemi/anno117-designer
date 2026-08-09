import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState } from "./local";
import { seedCatalog } from "../data/seed";
import { emptyLayout } from "../model/factories";

const KEY = "anno117-designer:state:v8";

/** localStorage minimal : l'environnement de test n'en fournit pas. */
function stubStorage() {
  const m = new Map<string, string>();
  const store = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  (globalThis as unknown as { localStorage: typeof store }).localStorage = store;
  return store;
}

describe("catalogue persiste — les donnees du jeu font foi", () => {
  let ls: ReturnType<typeof stubStorage>;
  beforeEach(() => { ls = stubStorage(); });
  afterEach(() => { ls.clear(); });

  it("UN CATALOGUE PERIME RETROUVE SES CHAMPS", () => {
    // Le bug reel : `uniqueType` a ete ajoute a l'extraction bien apres les premieres
    // ouvertures de l'application. Un navigateur ayant enregistre son catalogue avant gardait
    // des sanctuaires SANS type d'unicite — `uniqueCap` renvoyait alors l'infini, plus rien ne
    // bornait ni le nombre ni la variete, et le plan posait une divinite de chaque.
    const perime = seedCatalog().map((d) => {
      const reste: Record<string, unknown> = { ...d };
      delete reste.uniqueType;
      return reste as unknown as (typeof d);
    });
    expect(perime.some((d) => "uniqueType" in d)).toBe(false); // vraiment perime

    ls.setItem(KEY, JSON.stringify({ catalog: perime, layout: emptyLayout(40, 40) }));
    const charge = loadState()!;

    const sanctuaires = charge.catalog.filter((d) => d.uniqueType === "Shrine");
    expect(sanctuaires.length).toBe(seedCatalog().filter((d) => d.uniqueType === "Shrine").length);
    expect(sanctuaires.length).toBeGreaterThan(0);
  });

  it("les ajouts PROPRES a l'utilisateur survivent", () => {
    const perso = { ...seedCatalog()[0]!, id: "user-perso-1", name: "Mon batiment" };
    ls.setItem(KEY, JSON.stringify({
      catalog: [...seedCatalog(), perso],
      layout: emptyLayout(40, 40),
    }));
    const charge = loadState()!;
    expect(charge.catalog.find((d) => d.id === "user-perso-1")?.name).toBe("Mon batiment");
    // …sans dupliquer les definitions du jeu
    const ids = charge.catalog.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("le layout n'est pas touche par le rafraichissement", () => {
    const layout = emptyLayout(40, 40);
    ls.setItem(KEY, JSON.stringify({ catalog: seedCatalog(), layout }));
    expect(loadState()!.layout.grid.w).toBe(layout.grid.w);
  });
});
