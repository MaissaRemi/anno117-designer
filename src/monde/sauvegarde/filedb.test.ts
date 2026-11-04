import { describe, expect, it } from "vitest";
import { attribut, attributs, chemin, enfants, entier, entiers32, filtreChemins, lireFileDb } from "./filedb";
import { fichierDeSauvegarde, inflerZlib } from "./rda";

/** Un petit FileDB v3 écrit à la main : `["tag", enfants]` ou `["@attr", octets]`. */
type Element = [string, Element[]] | [`@${string}`, Uint8Array];
function ecrire(racine: Element[]): Uint8Array {
  const tags = new Map<string, number>(), attrs = new Map<string, number>();
  const octets: number[] = [];
  const i32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); octets.push(...b); };
  const id = (nom: string) => {
    if (nom.startsWith("@")) {
      if (!attrs.has(nom)) attrs.set(nom, 0x8000 + attrs.size + 1);
      return attrs.get(nom)!;
    }
    if (!tags.has(nom)) tags.set(nom, tags.size + 2);
    return tags.get(nom)!;
  };
  const emettre = (e: Element) => {
    const [nom, v] = e;
    if (v instanceof Uint8Array) {
      i32(v.length); i32(id(nom));
      octets.push(...v);
      while (octets.length % 8) octets.push(0);
    } else {
      i32(0); i32(id(nom));
      for (const c of v) emettre(c);
      i32(0); i32(0);
    }
  };
  for (const e of racine) emettre(e);
  const dico = (m: Map<string, number>) => {
    const debut = octets.length;
    i32(m.size);
    for (const v of m.values()) octets.push(v & 0xff, v >> 8);
    for (const k of m.keys()) octets.push(...[...k.replace(/^@/, "")].map((c) => c.charCodeAt(0)), 0);
    return debut;
  };
  const finTags = dico(tags), finAttrs = dico(attrs);
  i32(finTags); i32(finAttrs); i32(8); i32(-3);
  return new Uint8Array(octets);
}
const n32 = (...v: number[]) => { const b = new Uint8Array(4 * v.length); v.forEach((x, i) => new DataView(b.buffer).setInt32(4 * i, x, true)); return b; };

describe("FileDB", () => {
  const donnees = ecrire([
    ["Gros", [["@Inutile", n32(1, 2, 3)], ["Detail", [["@X", n32(9)]]]]],
    ["Monde", [
      ["@#8000", n32(7)],
      ["#1", [["@Proprietaire", n32(41)], ["Fertility", [["@#8000", n32(2212)], ["@#8000", n32(4049)]]], ["Economie", []]]],
      ["#1", [["Fertility", []]]],
    ]],
  ]);

  it("lit tags, attributs répétés et listes", () => {
    const r = lireFileDb(donnees);
    const monde = chemin(r, "Monde");
    expect(entier(attribut(monde, "#8000"))).toBe(7);
    const zones = enfants(monde, "#1");
    expect(zones.length).toBe(2);
    expect(entier(attribut(zones[0], "Proprietaire"))).toBe(41);
    expect(attributs(chemin(zones[0], "Fertility"), "#8000").map((x) => entier(x))).toEqual([2212, 4049]);
    expect(entiers32(attribut(chemin(r, "Gros"), "Inutile"))).toEqual([1, 2, 3]);
    expect(entier(attribut(chemin(r, "Gros", "Detail"), "X"))).toBe(9);
  });

  it("saute les branches refusées sans perdre le fil", () => {
    const r = lireFileDb(donnees, filtreChemins(["Monde", "*", "Fertility"]));
    expect(chemin(r, "Gros")).toBeUndefined();
    const zones = enfants(chemin(r, "Monde"), "#1");
    expect(zones.length).toBe(2);
    expect(entier(attribut(zones[0], "Proprietaire"))).toBe(41); // les attributs d'un ancêtre gardé restent
    expect(chemin(zones[0], "Economie")).toBeUndefined();
    expect(attributs(chemin(zones[0], "Fertility"), "#8000").length).toBe(2);
  });

  it("refuse ce qui n'est pas un FileDB v3", () => {
    const abime = donnees.slice();
    abime[abime.length - 4] = 0;
    expect(() => lireFileDb(abime)).toThrow();
  });
});

describe("zlib", () => {
  it("ignore le remplissage après la fin du flux, comme le jeu", async () => {
    const texte = new TextEncoder().encode("Anno 117 ".repeat(200));
    const flux = new Blob([texte]).stream().pipeThrough(new CompressionStream("deflate"));
    const z = new Uint8Array(await new Response(flux).arrayBuffer());
    const avecRemplissage = new Uint8Array(z.length + 7);
    avecRemplissage.set(z);
    expect(new TextDecoder().decode(await inflerZlib(avecRemplissage))).toBe("Anno 117 ".repeat(200));
    expect(new TextDecoder().decode(await inflerZlib(z))).toBe("Anno 117 ".repeat(200));
  });

  it("un fichier de sauvegarde : flux, flux vide, taille ; la taille est contrôlée", async () => {
    const texte = new TextEncoder().encode("Pax Romana ".repeat(300));
    const flux = new Blob([texte]).stream().pipeThrough(new CompressionStream("deflate"));
    const z = new Uint8Array(await new Response(flux).arrayBuffer());
    const fichier = (taille: number) => {
      const f = new Uint8Array(z.length + 12);
      f.set(z);
      f.set([0x78, 0xda, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01], z.length);
      new DataView(f.buffer).setUint32(z.length + 8, taille, true);
      return f;
    };
    expect((await fichierDeSauvegarde(fichier(texte.length))).length).toBe(texte.length);
    await expect(fichierDeSauvegarde(fichier(texte.length + 5))).rejects.toThrow(/tronquée/);
  });
});
