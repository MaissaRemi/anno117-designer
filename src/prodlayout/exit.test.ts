import { describe, expect, it } from "vitest";
import { ensureExit } from "./exit";
import { at, BLOCKED, count, FREE, makeOcc, ROAD, setAt } from "./occupancy";
import { paintSkeleton, roadDistances } from "./roads";

/** Une graine : la case route d'où part la distance-rue (l'entrepôt, en vrai). */
const seedsOf = (w: number, x: number, y: number) => [y * w + x];

/** Grille d'essai : épine en y=2, branches intérieures au pas 3. */
function grille() {
  const o = makeOcc(9, 5);
  paintSkeleton(o, 2, 3, "h");
  return o;
}

/** Coupe la voirie sous l'épine, pour isoler le bord sud. */
function isolerLeSud(o: ReturnType<typeof grille>) {
  for (let x = 0; x < o.w; x++) {
    for (let y = 3; y < o.h; y++) if (at(o, x, y) === ROAD) setAt(o, x, y, FREE);
  }
}

describe("ensureExit", () => {
  it("prend le débouché existant sans peindre une seule case", () => {
    const o = grille();
    const avant = count(o, ROAD);
    const exit = ensureExit(o, "ouest", seedsOf(9, 0, 2));
    expect(exit).not.toBeNull();
    expect(exit!.side).toBe("ouest");
    expect(exit!.x).toBe(0); // sur le bord ouest, par définition
    expect(count(o, ROAD)).toBe(avant); // aucune case peinte en plus
  });

  it("creuse un couloir quand le bord n'a aucun débouché", () => {
    const o = grille();
    isolerLeSud(o);
    const avant = count(o, ROAD);
    const exit = ensureExit(o, "sud", seedsOf(9, 1, 2));
    expect(exit).not.toBeNull();
    expect(exit!.side).toBe("sud");
    expect(exit!.y).toBe(4);
    expect(count(o, ROAD)).toBeGreaterThan(avant);
  });

  it("le couloir creusé est bien relié aux graines", () => {
    const o = grille();
    isolerLeSud(o);
    const exit = ensureExit(o, "sud", seedsOf(9, 1, 2))!;
    const dist = roadDistances(o, [exit.y * o.w + exit.x]);
    expect(dist[2 * 9 + 1]).toBeGreaterThan(0);
  });

  it("rend null quand le bord entier est hors forme", () => {
    const usable = new Array(9 * 5).fill(true);
    for (let x = 0; x < 9; x++) usable[4 * 9 + x] = false;
    const o = makeOcc(9, 5, usable);
    paintSkeleton(o, 2, 3, "h");
    expect(at(o, 0, 4)).toBe(BLOCKED);
    expect(ensureExit(o, "sud", seedsOf(9, 1, 2))).toBeNull();
  });

  it("est déterministe — deux appels sur la même grille rendent le même point", () => {
    expect(ensureExit(grille(), "est", seedsOf(9, 0, 2))).toEqual(
      ensureExit(grille(), "est", seedsOf(9, 0, 2)),
    );
  });
});
