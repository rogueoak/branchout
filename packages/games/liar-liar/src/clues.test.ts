import { describe, expect, it } from 'vitest';
import { createMemoryAssetLoaderFactory } from '@branchout/game-sdk/testing';
import { CATEGORIES, loadClueBank, validateClueBank, type LiarLiarClue } from './clues';

function clue(over: Partial<LiarLiarClue> = {}): LiarLiarClue {
  return { id: 'people-001', category: 'people', clue: 'A clue.', answer: 'Someone', ...over };
}

describe('validateClueBank', () => {
  it('accepts a well-formed bank', () => {
    expect(() =>
      validateClueBank([clue(), clue({ id: 'food-001', category: 'food', answer: 'Cheese' })]),
    ).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    expect(() => validateClueBank([clue(), clue()])).toThrow(/duplicate id/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateClueBank([clue({ category: 'wizards' })])).toThrow(/category/);
  });

  it('rejects an empty clue or answer', () => {
    expect(() => validateClueBank([clue({ clue: '   ' })])).toThrow(/empty clue/);
    expect(() => validateClueBank([clue({ answer: '' })])).toThrow(/empty answer/);
  });

  it('rejects malformed aliases', () => {
    expect(() => validateClueBank([clue({ aliases: ['ok', ''] })])).toThrow(/aliases/);
  });
});

describe('loadClueBank', () => {
  it('reads every category file through the injected loader and flattens them', async () => {
    const files: Record<string, unknown> = {};
    for (const category of CATEGORIES) {
      files[`data/liar-liar/${category}.json`] = [
        clue({ id: `${category}-001`, category, answer: `${category} answer` }),
      ];
    }
    const assets = createMemoryAssetLoaderFactory(files).forModule('file:///x');
    const bank = await loadClueBank(assets);
    expect(bank).toHaveLength(CATEGORIES.length);
    expect(new Set(bank.map((c) => c.category))).toEqual(new Set(CATEGORIES));
    expect(() => validateClueBank(bank)).not.toThrow();
  });

  it('throws when a category file is not an array', async () => {
    const files: Record<string, unknown> = {};
    for (const category of CATEGORIES) files[`data/liar-liar/${category}.json`] = [];
    files['data/liar-liar/people.json'] = { not: 'an array' };
    const assets = createMemoryAssetLoaderFactory(files).forModule('file:///x');
    await expect(loadClueBank(assets)).rejects.toThrow(/must be a JSON array/);
  });
});
