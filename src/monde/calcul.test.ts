import { describe, expect, it } from "vitest";
import rawCatalog from "../data/catalog.generated.json";
import type { BuildingDef } from "../model/types";
import { makeLookup } from "../engine/rules";
import { downscaleGrid } from "../optimizer/halfTileAdapter";
import { planIsland } from "../optimizer/islandPlan";
import { planifierCommande, resumer } from "../commande/planifier";
import { nouvelleConfiguration, nouvelleIle, type IleDuMonde } from "./configuration";
import { calculerMonde, type Executeurs } from "./calcul";
import { goodName } from "../economy/economy";

/**
 * UN VRAI MONDE, DE BOUT EN BOUT : une île principale du Latium (Patriciens, tous les services),
 * deux îles de production au Latium et deux en Albion. Les moteurs sont appelés directement, à
 * l'échelle tuile (l'application passe par des Web Workers et rend en demi-cases).
 */

const catalog = rawCatalog as unknown as BuildingDef[];
const lookup = makeLookup(catalog);
const executeurs: Executeurs = {
  principale: async (req) => planIsland({ ...req, grid: downscaleGrid(req.grid) }),
  production: async (req) => resumer(planifierCommande(downscaleGrid(req.grid), req.commande, req.catalog, lookup)),
};

// Fertilités (economy.generated) : Latium — lin 2202, raisins 2205, maquereaux 2206, huîtres 2208,
// lavande 2209, olives 2210, fer 4049, murex 4051, sandaraque 4052, minéral 4053, marbre 4062,
// esturgeons 8577, or 32027, résine 51212. Albion — lin, raisins, poneys 2211, orge 2212,
// herbes 2214, plantes tinctoriales 2217, salicorne 2218, petits oiseaux 2219, fer, cuivre 4063,
// étain 4064, granite 4066, castors 4082, coquillages 8432, argent 8487, résine.
const LATIUM = ["2202", "2205", "2206", "2208", "2209", "2210", "4049", "4051", "4052", "4053", "4062", "8577", "32027", "51212"];
const ALBION = ["2202", "2205", "2211", "2212", "2214", "2217", "2218", "2219", "4049", "4063", "4064", "4066", "4082", "8432", "8487", "51212"];
const BIERE = "2154";

const mienne = (ileId: string, fertilites: string[], extra: Partial<IleDuMonde> = {}): IleDuMonde =>
  ({ ...nouvelleIle(ileId), propriete: "moi", fertilites, ...extra });

describe("calculer un monde", () => {
  it("île principale du Latium, production répartie sur les deux provinces, flux et bilan", async () => {
    const c = nouvelleConfiguration("Test");
    c.iles = [
      mienne("roman_island_medium_01", LATIUM, { role: "principale", palier: "1498" }),
      mienne("roman_island_large_03", LATIUM),
      mienne("roman_island_large_02", LATIUM),
      mienne("celtic_island_large_02", ALBION),
      mienne("celtic_island_large_04", ALBION),
      { ...nouvelleIle("roman_island_small_02"), propriete: "achetable" },
    ];
    const r = await calculerMonde(c, { catalog, executeurs, parallelisme: 1 });
    const principale = r.iles.find((i) => i.role === "principale")!;
    const prod = r.iles.filter((i) => i.role === "production");
    console.log(JSON.stringify({
      bilan: r.bilan, principale: { hab: principale.habitants, arg: principale.argent, biens: principale.consomme.length },
      prod: prod.map((i) => ({ cle: c.iles.find((x) => x.cle === i.cle)!.ileId, hab: i.habitants, aff: i.affecte.length, manques: i.manques.length })),
      deficits: r.deficits.map((d) => `${goodName(d.good)} ${d.parMinute} : ${d.raison}`), flux: r.flux.length,
      manques: prod.map((i) => i.manques),
    }));

    expect(principale.habitants).toBeGreaterThan(0);
    expect(prod.length).toBeGreaterThan(0);
    expect(r.iles.some((i) => c.iles.find((x) => x.cle === i.cle)?.propriete !== "moi")).toBe(false);
    // chaque bâtiment est de la province de son île
    for (const i of r.iles) {
      const region = c.iles.find((x) => x.cle === i.cle)!.ileId.startsWith("celtic") ? "Celtic" : "Roman";
      for (const b of i.plan?.buildings ?? []) {
        const reg = lookup(b.defId)?.region;
        if (reg) expect(reg, lookup(b.defId)?.name).toBe(region);
      }
    }
    // la bière des Patriciens vient d'Albion
    const biere = r.flux.filter((f) => f.good === BIERE && f.vers === principale.cle);
    expect(biere.length).toBeGreaterThan(0);
    for (const f of biere) expect(c.iles.find((x) => x.cle === f.de)!.ileId).toMatch(/^celtic/);
    // conservation : ce que la ville consomme arrive par les flux, ou figure dans les déficits
    for (const b of principale.consomme) {
      const recu = r.flux.filter((f) => f.vers === principale.cle && f.good === b.good).reduce((s, f) => s + f.parMinute, 0)
        + (principale.produit.find((p) => p.good === b.good)?.parMinute ?? 0);
      const manque = r.deficits.find((d) => d.good === b.good)?.parMinute ?? 0;
      expect(recu + manque, b.good).toBeGreaterThanOrEqual(b.parMinute - 0.1);
    }
    for (const d of r.deficits) expect(d.raison.length).toBeGreaterThan(0);
  }, 600_000);
});
