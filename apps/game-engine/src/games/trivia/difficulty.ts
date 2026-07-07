// Difficulty blend (spec 0008). The host picks a difficulty setting 1-10; that setting fixes the
// percentage mix of easy / medium / hard questions drawn over a game. Each round independently
// samples one tier by these weights, so the *distribution* over a game matches the table (not an
// exact quota per game).

import type { Difficulty } from './question-bank';

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY = 5;

/** The three tiers in ascending order; used for nearest-tier fallback distance. */
export const TIERS: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** Per-setting weights as [easy, medium, hard] percentages, each row summing to 100. */
const BLEND_TABLE: Readonly<Record<number, readonly [number, number, number]>> = {
  1: [80, 18, 2],
  2: [70, 25, 5],
  3: [60, 30, 10],
  4: [50, 35, 15],
  5: [40, 40, 20],
  6: [30, 42, 28],
  7: [22, 40, 38],
  8: [15, 37, 48],
  9: [8, 32, 60],
  10: [3, 22, 75],
};

/** True for an integer difficulty setting inside the supported 1-10 range. */
export function isValidDifficulty(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DIFFICULTY && value <= MAX_DIFFICULTY;
}

/** The [easy, medium, hard] weight row for a setting. Throws on an out-of-range setting. */
export function blendWeights(difficulty: number): readonly [number, number, number] {
  const row = BLEND_TABLE[difficulty];
  if (!row) {
    throw new Error(`difficulty must be ${MIN_DIFFICULTY}-${MAX_DIFFICULTY}, got ${difficulty}`);
  }
  return row;
}

/**
 * Sample one difficulty tier for a setting, using `rng` (a `() => number` in [0, 1)) to draw
 * against the weighted cumulative distribution. Injecting `rng` keeps selection deterministic in
 * tests; production passes `Math.random`.
 */
export function sampleTier(difficulty: number, rng: () => number): Difficulty {
  const [easy, medium] = blendWeights(difficulty);
  const roll = rng() * 100;
  if (roll < easy) return 'easy';
  if (roll < easy + medium) return 'medium';
  return 'hard';
}

/**
 * Tiers ordered by proximity to `tier`, nearest first, for exhaustion fallback. Ties (equal
 * distance) break toward the easier tier, so a drained `medium` falls back to `easy` before
 * `hard` - a gentler surprise for players than jumping to the hardest bucket.
 */
export function tiersByProximity(tier: Difficulty): Difficulty[] {
  const origin = TIERS.indexOf(tier);
  return [...TIERS].sort((a, b) => {
    const da = Math.abs(TIERS.indexOf(a) - origin);
    const db = Math.abs(TIERS.indexOf(b) - origin);
    return da - db || TIERS.indexOf(a) - TIERS.indexOf(b);
  });
}
