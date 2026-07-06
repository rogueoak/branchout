import { describe, expect, it } from 'vitest';
import {
  blendWeights,
  isValidDifficulty,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  sampleTier,
  tiersByProximity,
} from './difficulty';

/** Deterministic PRNG (mulberry32) so weighted-draw tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('isValidDifficulty', () => {
  it('accepts integers 1-10 and rejects everything else', () => {
    for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d += 1)
      expect(isValidDifficulty(d)).toBe(true);
    expect(isValidDifficulty(0)).toBe(false);
    expect(isValidDifficulty(11)).toBe(false);
    expect(isValidDifficulty(5.5)).toBe(false);
    expect(isValidDifficulty(Number.NaN)).toBe(false);
  });
});

describe('blendWeights', () => {
  it('returns rows that sum to 100 for every setting', () => {
    for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d += 1) {
      const [easy, medium, hard] = blendWeights(d);
      expect(easy + medium + hard).toBe(100);
    }
  });

  it('throws for an out-of-range setting', () => {
    expect(() => blendWeights(0)).toThrow();
    expect(() => blendWeights(11)).toThrow();
  });
});

describe('sampleTier', () => {
  it('maps rng buckets to tiers at the weight boundaries (difficulty 5 = 40/40/20)', () => {
    // roll = rng() * 100; easy < 40, medium < 80, else hard.
    expect(sampleTier(5, () => 0.0)).toBe('easy');
    expect(sampleTier(5, () => 0.399)).toBe('easy');
    expect(sampleTier(5, () => 0.4)).toBe('medium');
    expect(sampleTier(5, () => 0.799)).toBe('medium');
    expect(sampleTier(5, () => 0.8)).toBe('hard');
    expect(sampleTier(5, () => 0.999)).toBe('hard');
  });

  it('reproduces the blend table distribution over many draws (within tolerance)', () => {
    const N = 20000;
    const tolerance = 2.5; // percentage points
    for (const difficulty of [1, 5, 8, 10]) {
      const rng = mulberry32(difficulty * 7919);
      const counts = { easy: 0, medium: 0, hard: 0 };
      for (let i = 0; i < N; i += 1) counts[sampleTier(difficulty, rng)] += 1;
      const [easy, medium, hard] = blendWeights(difficulty);
      expect(Math.abs((counts.easy / N) * 100 - easy)).toBeLessThan(tolerance);
      expect(Math.abs((counts.medium / N) * 100 - medium)).toBeLessThan(tolerance);
      expect(Math.abs((counts.hard / N) * 100 - hard)).toBeLessThan(tolerance);
    }
  });
});

describe('tiersByProximity', () => {
  it('orders nearest-first, breaking ties toward the easier tier', () => {
    expect(tiersByProximity('easy')).toEqual(['easy', 'medium', 'hard']);
    expect(tiersByProximity('hard')).toEqual(['hard', 'medium', 'easy']);
    // From medium, easy and hard are equidistant; easier wins the tie.
    expect(tiersByProximity('medium')).toEqual(['medium', 'easy', 'hard']);
  });
});
