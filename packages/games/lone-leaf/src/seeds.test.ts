import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import {
  CATEGORIES,
  DEFAULT_DIFFICULTY,
  loadSeedBank,
  seedDifficulty,
  validateSeedBank,
  type LoneLeafSeed,
} from './seeds';

/** Load the real shipped sample bank from disk via the same fs loader the plugin uses at boot. */
async function loadShipped(): Promise<LoneLeafSeed[]> {
  const fs = createFsAssetLoaderFactory().forModule(import.meta.url);
  return loadSeedBank(fs);
}

describe('shipped seed bank', () => {
  it('loads and validates the sample bank', async () => {
    const bank = await loadShipped();
    expect(bank.length).toBeGreaterThanOrEqual(60);
    expect(() => validateSeedBank(bank)).not.toThrow();
    // Every configured category is represented in the sample.
    for (const category of CATEGORIES) {
      expect(bank.some((s) => s.category === category)).toBe(true);
    }
  });
});

describe('validateSeedBank', () => {
  const good: LoneLeafSeed = { id: 'nature-001', category: 'nature', word: 'river' };

  it('rejects a bad id format', () => {
    expect(() => validateSeedBank([{ ...good, id: 'nature-1' }])).toThrow(/must match/);
  });

  it('rejects a mismatched category prefix', () => {
    expect(() => validateSeedBank([{ ...good, id: 'food-001' }])).toThrow(/must match/);
  });

  it('rejects a duplicate id', () => {
    expect(() => validateSeedBank([good, { ...good, word: 'lake' }])).toThrow(/duplicate id/);
  });

  it('accepts a multi-word seed (proper-noun themes)', () => {
    expect(() =>
      validateSeedBank([{ id: 'historical-001', category: 'historical', word: 'albert einstein' }]),
    ).not.toThrow();
  });

  it('rejects a blank word', () => {
    expect(() => validateSeedBank([{ ...good, word: '   ' }])).toThrow(/empty word/);
  });

  it('rejects a duplicate word in a category (whitespace/case-insensitive)', () => {
    expect(() =>
      validateSeedBank([good, { id: 'nature-002', category: 'nature', word: 'River' }]),
    ).toThrow(/duplicate word/);
    expect(() =>
      validateSeedBank([
        { id: 'historical-001', category: 'historical', word: 'albert einstein' },
        { id: 'historical-002', category: 'historical', word: 'Albert  Einstein' },
      ]),
    ).toThrow(/duplicate word/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateSeedBank([{ ...good, id: 'moon-001', category: 'moon' }])).toThrow(
      /category/,
    );
  });

  it('accepts an optional difficulty in 1-10 and rejects an out-of-range or non-integer one', () => {
    expect(() => validateSeedBank([{ ...good, difficulty: 1 }])).not.toThrow();
    expect(() => validateSeedBank([{ ...good, difficulty: 10 }])).not.toThrow();
    expect(() => validateSeedBank([{ ...good, difficulty: 0 }])).toThrow(/difficulty/);
    expect(() => validateSeedBank([{ ...good, difficulty: 11 }])).toThrow(/difficulty/);
    expect(() => validateSeedBank([{ ...good, difficulty: 4.5 }])).toThrow(/difficulty/);
  });

  it('treats a missing difficulty as the mid-scale default', () => {
    expect(seedDifficulty(good)).toBe(DEFAULT_DIFFICULTY);
    expect(seedDifficulty({ ...good, difficulty: 8 })).toBe(8);
  });

  it('includes the three proper-noun categories', () => {
    for (const category of ['celebrities', 'movies', 'historical']) {
      expect(CATEGORIES).toContain(category);
    }
  });
});
