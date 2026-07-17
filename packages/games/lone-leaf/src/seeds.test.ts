import { describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory } from '@branchout/game-sdk';
import { CATEGORIES, loadSeedBank, validateSeedBank, type LoneLeafSeed } from './seeds';

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

  it('rejects a multi-word seed', () => {
    expect(() => validateSeedBank([{ ...good, word: 'two words' }])).toThrow(/single word/);
  });

  it('rejects a duplicate word in a category', () => {
    expect(() =>
      validateSeedBank([good, { id: 'nature-002', category: 'nature', word: 'River' }]),
    ).toThrow(/duplicate word/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateSeedBank([{ ...good, id: 'moon-001', category: 'moon' }])).toThrow(
      /category/,
    );
  });
});
