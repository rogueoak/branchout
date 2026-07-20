// Per-round seed selection by difficulty band (spec 0057 difficulty rework), mirroring Trivia's
// selection.ts. Given the host's obscurity band [min, max] and a pool of unused seeds for the chosen
// categories, pick one seed whose rating falls in the band. When the band holds no unused seed, widen
// to the nearest rating outside it (a smaller surprise than jumping to an extreme); a below/above tie
// breaks toward the easier (lower) rating. A seed with no explicit rating counts as DEFAULT_DIFFICULTY.

import { seedDifficulty, type LoneLeafSeed } from './seeds';

/** How far a rating sits outside [min, max]; 0 when it is inside the band. */
function distanceToRange(rating: number, min: number, max: number): number {
  if (rating < min) return min - rating;
  if (rating > max) return rating - max;
  return 0;
}

/**
 * Pick one seed from `pool` whose difficulty is in [min, max]. When the band holds no seed, widen to
 * the nearest rating outside it; a tie between an equally-distant easier and harder rating breaks
 * toward the easier (lower) side. Returns `null` only for an empty pool. `rng` (in [0, 1)) selects
 * uniformly within the candidate set, so the draw is deterministic under a seeded rng. Callers pass an
 * ALREADY category-filtered, unused pool; band widening never reaches outside the chosen categories.
 */
export function pickSeedInBand(
  pool: readonly LoneLeafSeed[],
  min: number,
  max: number,
  rng: () => number,
): LoneLeafSeed | null {
  if (pool.length === 0) return null;

  // Prefer in-band seeds (distance 0); if none remain, fall to the nearest rating outside the band.
  let bestDistance = Infinity;
  let candidates: LoneLeafSeed[] = [];
  for (const seed of pool) {
    const d = distanceToRange(seedDifficulty(seed), min, max);
    if (d < bestDistance) {
      bestDistance = d;
      candidates = [seed];
    } else if (d === bestDistance) {
      candidates.push(seed);
    }
  }
  // When widening lands equidistant below and above the band, break the tie toward the easier
  // (below-band) side - a gentler surprise than the harder one.
  if (bestDistance > 0) {
    const easier = candidates.filter((seed) => seedDifficulty(seed) < min);
    if (easier.length > 0) candidates = easier;
  }
  // rng() is in [0, 1) and candidates is non-empty, so the index is always in bounds.
  return candidates[Math.floor(rng() * candidates.length)]!;
}
