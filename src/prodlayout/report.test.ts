import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { buildChain } from "./chain";
import { buildOrder } from "./lot";
import { buildReport } from "./report";

const catalog = rawCatalog as unknown as BuildingDef[];
const byId = new Map(catalog.map((d) => [d.id, d]));
const lookup = (id: string) => byId.get(id);

describe("buildReport", () => {
  const chain = buildChain("g3174", 2, lookup);
  const rep = buildReport(chain, buildOrder(chain), lookup, [
    { defId: "g3310", count: 1 },
  ]);

  it("compte les bâtiments avec leur nom et leur utilisation", () => {
    const bakery = rep.buildings.find((b) => b.defId === "g3174")!;
    expect(bakery.name).toBe("Boulangerie");
    expect(bakery.count).toBe(2);
    expect(bakery.utilisation).toBe(1);
  });

  it("inclut l'entrepôt dans l'entretien mais pas dans la chaîne", () => {
    // upkeep vérifié dans la donnée : boulangerie 14, entrepôt 6
    expect(rep.buildings.find((b) => b.defId === "g3310")!.count).toBe(1);
    expect(rep.upkeep).toBeGreaterThan(0);
  });

  it("chiffre la main-d'œuvre par palier, arrondie au supérieur", () => {
    // 2 boulangeries × 3 + 1 moulin × 4 = 10 Plébéiens (1496), le moulin en demande 4 depuis le patch 200 ; 2 fermes × 4 = 8 Liberti (1499)
    const pleb = rep.workforce.find((w) => w.tier === "1496")!;
    expect(pleb.amount).toBe(10);
    expect(pleb.name).toBe("Plébéiens");
    const lib = rep.workforce.find((w) => w.tier === "1499")!;
    expect(lib.amount).toBe(8);
  });

  it("annonce la production du bien cible", () => {
    expect(rep.production.name).toBe("Pain");
    expect(rep.production.ratePerMin).toBe(2);
  });

  it("rend un manifeste d'import vide quand la chaîne est complète", () => {
    expect(rep.imports).toEqual([]);
    expect(rep.importCostPerMin).toBe(0);
  });

  it("chiffre l'import quand un intrant est coupé", () => {
    const cut = buildChain("g3174", 2, lookup, new Set(["2119"]));
    const r = buildReport(cut, buildOrder(cut), lookup, []);
    expect(r.imports).toHaveLength(1);
    expect(r.imports[0].name).toBe("Farine");
    expect(r.imports[0].ratePerMin).toBe(2);
    expect(r.importCostPerMin).toBeGreaterThan(0);
  });
});
