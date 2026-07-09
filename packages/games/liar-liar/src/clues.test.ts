import { describe, expect, it } from 'vitest';
import { createMemoryAssetLoaderFactory, createTestServices } from '@branchout/game-sdk/testing';
import {
  CATEGORIES,
  MIN_CLUES_PER_CATEGORY,
  loadClueBank,
  validateClueBank,
  validateSeedBank,
  type LiarLiarClue,
} from './clues';
import { liarLiarPlugin } from './liar-liar';

function clue(over: Partial<LiarLiarClue> = {}): LiarLiarClue {
  return { id: 'people-001', category: 'people', clue: 'A clue.', answer: 'Someone', ...over };
}

/** A valid full-coverage synthetic bank: all 8 categories, MIN clues each, distinct ids/prompts. */
function seedBank(perCategory: number = MIN_CLUES_PER_CATEGORY): LiarLiarClue[] {
  const bank: LiarLiarClue[] = [];
  for (const category of CATEGORIES) {
    for (let i = 1; i <= perCategory; i++) {
      const n = String(i).padStart(3, '0');
      bank.push(
        clue({
          id: `${category}-${n}`,
          category,
          clue: `${category} clue ${i}`,
          answer: `${category} ${i}`,
        }),
      );
    }
  }
  return bank;
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

  it('validates the optional source field', () => {
    expect(() => validateClueBank([clue({ source: 'https://example.com' })])).not.toThrow();
    expect(() => validateClueBank([clue({ source: '' })])).toThrow(/source/);
    // @ts-expect-error - a non-string source must be rejected at runtime
    expect(() => validateClueBank([clue({ source: 123 })])).toThrow(/source/);
  });
});

describe('validateSeedBank', () => {
  it('accepts a bank with full category coverage', () => {
    expect(() => validateSeedBank(seedBank())).not.toThrow();
  });

  it('rejects a bank missing a whole category', () => {
    const bank = seedBank().filter((c) => c.category !== 'things');
    expect(() => validateSeedBank(bank)).toThrow(/things.*at least/s);
  });

  it('rejects a category below the minimum count, naming it', () => {
    const bank = seedBank().filter((c) => c.id !== 'sports-012'); // sports now has 11
    expect(() => validateSeedBank(bank)).toThrow(/sports.*11 clues/s);
  });

  it('rejects a clue whose id breaks the <category>-NNN convention', () => {
    const bank = seedBank();
    bank.find((c) => c.id === 'people-001')!.id = 'people-1'; // two digits short
    expect(() => validateSeedBank(bank)).toThrow(/people-1.*NNN/s);
  });

  it('rejects a duplicate prompt within a category (case- and space-insensitive)', () => {
    const bank = seedBank();
    const food = bank.filter((c) => c.category === 'food');
    food[1]!.clue = `  ${food[0]!.clue.toUpperCase()}  `; // same prompt, different case/spacing
    expect(() => validateSeedBank(bank)).toThrow(/duplicate prompt.*food/s);
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
