/**
 * Arithmétique rationnelle exacte.
 *
 * POURQUOI : les ratios de chaîne se calculent en divisant des entiers (`amount`,
 * `cycleTime`). En virgule flottante, une boulangerie sur trois moulins donne 0,333… et le
 * lot parfait — qui est le PPCM des dénominateurs — devient inatteignable. En rationnel il
 * est exact.
 */

/** Rationnel réduit. `d` est toujours strictement positif. */
export interface Frac {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function frac(n: number, d = 1): Frac {
  if (d === 0) throw new Error("Frac : dénominateur nul");
  const sign = d < 0 ? -1 : 1;
  const g = gcd(Math.abs(n), Math.abs(d)) || 1;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

export const addF = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const mulF = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
export const subF = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);

export const divF = (a: Frac, b: Frac): Frac => {
  if (b.n === 0) throw new Error("Frac : division par zéro");
  return frac(a.n * b.d, a.d * b.n);
};

export const toNumber = (a: Frac): number => a.n / a.d;

const lcm = (a: number, b: number): number => (a / (gcd(a, b) || 1)) * b;

/** Plus petit entier k ≥ 1 tel que k·f soit entier pour tout f — le lot parfait. */
export const commonMultiplier = (fs: Frac[]): number =>
  fs.reduce((m, f) => lcm(m, f.d), 1);
