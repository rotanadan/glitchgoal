/**
 * Deterministic seeded PRNG (mulberry32).
 *
 * The RNG state lives *inside* GameState so that a rollback re-simulation
 * reproduces the exact same random sequence. Never use Math.random() in the sim.
 */

export interface RngState {
  /** uint32 internal state. */
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Advance and return a uint32. Mutates the state. */
export function nextU32(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform integer in [0, bound). */
export function nextInt(rng: RngState, bound: number): number {
  return nextU32(rng) % bound;
}
