/**
 * Deterministic randomness for the world generator.
 *
 * Every block, building, lamp post and parked car in Leonida is placed from a
 * seed derived from its own grid coordinates. That is what lets the city be
 * a kilometre across and still rebuild identically on every boot: nothing is
 * stored, everything is re-derived.
 */

/** Tiny deterministic RNG. Same seed, same city, every time. */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a grid coordinate, for per-cell seeds. */
export function hash2(x: number, y: number, salt = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + salt * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export type Rnd = () => number;

/** An RNG seeded from a grid cell. */
export function cellRng(i: number, j: number, salt = 0): Rnd {
  return mulberry(hash2(i, j, salt));
}

/** Pick one entry of an array. */
export function pick<T>(rnd: Rnd, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

/** Uniform float in [a, b). */
export function range(rnd: Rnd, a: number, b: number) {
  return a + rnd() * (b - a);
}

/** Uniform integer in [a, b]. */
export function irange(rnd: Rnd, a: number, b: number) {
  return a + Math.floor(rnd() * (b - a + 1));
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (n: number, a: number, b: number) =>
  n < a ? a : n > b ? b : n;
export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const smooth = (t: number) => t * t * (3 - 2 * t);
