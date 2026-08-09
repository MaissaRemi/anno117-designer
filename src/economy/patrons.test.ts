import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { economy } from "./economy";
import { SHRINE_TYPE } from "./attributes";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));

describe("divinites tutelaires extraites du jeu", () => {
  it("les huit divinites sont la, chacune reliee a son autel", () => {
    const p = economy.patrons ?? [];
    expect(p).toHaveLength(8);
    for (const d of p) {
      expect(d.shrineDefId).toBeTruthy();
      expect(d.local.length).toBeGreaterThan(0);
    }
    expect(new Set(p.map((d) => d.name)).size).toBe(8);

    // SEPT autels sur huit se resolvent dans le catalogue. Le huitieme est une donnee du jeu,
    // pas un defaut d'extraction : le `ShrineEffectIcon` de Vulcain pointe sur `g144814`, une
    // variante absente du catalogue — ses autels CONSTRUCTIBLES sont g144812 (Latium, portee
    // 20) et g144813 (Albion, portee 22), tous deux bien presents et marques `Shrine`.
    const resolus = p.filter((d) => byId.get(d.shrineDefId!)?.uniqueType === SHRINE_TYPE);
    expect(resolus).toHaveLength(7);
    const vulcain = p.find((d) => !resolus.includes(d))!;
    expect(vulcain.name).toMatch(/vulcan/i);
    for (const id of ["g144812", "g144813"]) {
      expect(byId.get(id)?.uniqueType).toBe(SHRINE_TYPE);
    }
  });

  it("les paliers de devotion sont croissants", () => {
    for (const d of economy.patrons ?? []) {
      for (const e of d.local) {
        expect(e.milestones.length).toBeGreaterThan(0);
        for (let i = 1; i < e.milestones.length; i++) {
          expect(e.milestones[i]![0]).toBeGreaterThan(e.milestones[i - 1]![0]);
          expect(e.milestones[i]![1]).toBeGreaterThan(e.milestones[i - 1]![1]);
        }
      }
    }
  });

  it("VULCAIN : l'effet dominant greffe l'incendie sur les fonderies", () => {
    // C'est la trouvaille qui justifie tout ce pipeline. L'effet dominant ne porte AUCUN
    // attribut en propre : il POSE un effet de rayon sur ses cibles, via
    // `BuildingUpgrade/AdditionalFunctionalEffect`. Sans ce second saut, il ressortait vide —
    // et le plus gros levier du jeu sur la securite incendie restait invisible.
    const v = (economy.patrons ?? []).find((d) => /vulcan/i.test(d.name));
    expect(v).toBeDefined();
    const greffe = v!.dominant.flatMap((e) => e.grants ?? [])[0];
    expect(greffe).toBeDefined();
    expect(greffe!.attrs.FireSafety).toBe(2);
    expect(greffe!.targets).toContain("43097"); // « All Attribute Buildings »
    // ...et il ne consomme aucun permis d'autel : c'est un effet de dominance, pas un batiment.
    expect(v!.dominant[0]!.scope).toBe("ObjectsInMeta");
  });

  it("les seuils de devotion sont extraits", () => {
    expect(economy.religion?.dominantThreshold).toBe(7000);
    expect(economy.religion?.wonderThreshold).toBe(4000);
    expect(economy.religion?.shrineThreshold).toBe(1000);
  });
});
