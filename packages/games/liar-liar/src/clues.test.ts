import { describe, expect, it } from 'vitest';
import { createMemoryAssetLoaderFactory, createTestServices } from '@branchout/game-sdk/testing';
import { CATEGORIES, loadClueBank, validateClueBank, type LiarLiarClue } from './clues';
import { liarLiarPlugin } from './liar-liar';

function clue(over: Partial<LiarLiarClue> = {}): LiarLiarClue {
  return { id: 'people-001', category: 'people', clue: 'A clue.', answer: 'Someone', ...over };
}

describe('validateClueBank - structural checks', () => {
  it('accepts a well-formed bank of any size', () => {
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

  it('rejects an id that breaks the <category>-NNN convention', () => {
    expect(() => validateClueBank([clue({ id: 'people-1' })])).toThrow(/people-1.*NNN/s);
  });

  it('rejects an empty clue or answer', () => {
    expect(() => validateClueBank([clue({ clue: '   ' })])).toThrow(/empty clue/);
    expect(() => validateClueBank([clue({ answer: '' })])).toThrow(/empty answer/);
  });

  it('rejects malformed aliases', () => {
    expect(() => validateClueBank([clue({ aliases: ['ok', ''] })])).toThrow(/aliases/);
  });

  it('validates the optional source field', () => {
    expect(() => validateClueBank([clue({ source: 'https://example.com' })])).not.toThrow();
    expect(() => validateClueBank([clue({ source: '' })])).toThrow(/source/);
    // @ts-expect-error - a non-string source must be rejected at runtime
    expect(() => validateClueBank([clue({ source: 123 })])).toThrow(/source/);
  });

  it('rejects a duplicate prompt within a category (case- and space-insensitive)', () => {
    const first = clue({ id: 'food-001', category: 'food', clue: 'A tasty fact.' });
    const dup = clue({ id: 'food-002', category: 'food', clue: '  A TASTY FACT.  ' });
    expect(() => validateClueBank([first, dup])).toThrow(/duplicate prompt.*food/s);
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

describe('liarLiarPlugin.create', () => {
  it('aborts on a malformed shipped bank so a bad deploy fails at boot', async () => {
    // Every category file must exist (loadClueBank reads all 8); one carries a clue missing its answer.
    const files: Record<string, unknown> = {};
    for (const category of CATEGORIES) files[`data/liar-liar/${category}.json`] = [];
    files['data/liar-liar/people.json'] = [
      { id: 'people-001', category: 'people', clue: 'A clue.' },
    ];
    await expect(liarLiarPlugin.create(createTestServices({ files }))).rejects.toThrow();
  });
});
