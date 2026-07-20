import { describe, expect, it } from 'vitest';
import { pickSeedInBand } from './selection';
import type { LoneLeafSeed } from './seeds';

function seed(id: string, difficulty?: number): LoneLeafSeed {
  return { id, category: 'nature', word: id, difficulty };
}

describe('pickSeedInBand', () => {
  it('returns null for an empty pool', () => {
    expect(pickSeedInBand([], 3, 6, () => 0)).toBeNull();
  });

  it('only ever returns an in-band seed while one exists', () => {
    const pool = [seed('a', 1), seed('b', 5), seed('c', 9)];
    // A deterministic rng cycling values still cannot escape the band: only 'b' (5) is in [4, 6].
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(pickSeedInBand(pool, 4, 6, () => r)!.id).toBe('b');
    }
  });

  it('widens to the nearest rating when the band is exhausted', () => {
    // Band [5, 6] holds nothing; nearest below is 4 (distance 1), nearest above is 8 (distance 3).
    const pool = [seed('low', 4), seed('high', 8)];
    expect(pickSeedInBand(pool, 5, 6, () => 0)!.id).toBe('low');
  });

  it('breaks an equidistant widen tie toward the easier (lower) rating', () => {
    // Band [5, 5]; 3 is distance 2 below, 7 is distance 2 above -> the easier side wins.
    const pool = [seed('easier', 3), seed('harder', 7)];
    for (const r of [0, 0.5, 0.99]) {
      expect(pickSeedInBand(pool, 5, 5, () => r)!.id).toBe('easier');
    }
  });

  it('treats a seed with no difficulty as mid-scale (5)', () => {
    const pool = [seed('rated', 1), seed('unrated')];
    // Band [5, 6]: the unrated seed counts as 5 (in-band); the rated 1 is out of band.
    expect(pickSeedInBand(pool, 5, 6, () => 0)!.id).toBe('unrated');
  });
});
