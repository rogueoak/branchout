// A tiny seeded PRNG so the whole deal is a pure function of a seed. We never call Math.random in game
// logic: the engine's injected `services.rng` is consumed exactly once (to derive the game's base
// seed), and every reproducible thing after that - the leaf deal - runs through this deterministic
// generator. Same seed in, same leaves out, forever, on any machine.

/** A deterministic, uniform [0, 1) source seeded by a 32-bit integer. */
export interface SeededRng {
  /** Next uniform in [0, 1). */
  next(): number;
  /** The current internal state (a 32-bit unsigned int), for deriving child seeds. */
  state(): number;
}

/**
 * Mulberry32: a compact, well-distributed 32-bit PRNG. Deterministic and dependency-free, which is
 * exactly what an authoritative server deal needs - the client never re-rolls, it just renders what
 * the server dealt from this stream.
 */
export function createRng(seed: number): SeededRng {
  // Coerce to a 32-bit unsigned integer so a float or negative seed still yields a stable stream.
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    state: () => s,
  };
}

/**
 * Derive a stable 32-bit seed from a base seed and an integer salt (e.g. the tier number), so each
 * tier's deal is reproducible from the game's single base seed without threading a live generator
 * across the persisted scratch boundary.
 */
export function deriveSeed(base: number, salt: number): number {
  let h = (base ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ salt, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
