import { describe, expect, it } from 'vitest';
import { createMemoryAssetLoaderFactory } from '@branchout/game-sdk/testing';
import {
  CATEGORIES,
  loadCardBank,
  THORNS_PER_CARD,
  validateCardBank,
  type BramblesCard,
} from './cards';

function card(overrides: Partial<BramblesCard> = {}): BramblesCard {
  return {
    id: 'nature-001',
    category: 'nature',
    bloom: 'mountain',
    thorns: ['peak', 'climb', 'summit', 'high', 'range'],
    ...overrides,
  };
}

describe('loadCardBank', () => {
  it('reads and flattens every category file', async () => {
    const files: Record<string, unknown> = {};
    for (const c of CATEGORIES) files[`data/brambles/${c}.json`] = [];
    files['data/brambles/nature.json'] = [card()];
    const loader = createMemoryAssetLoaderFactory(files).forModule('x');
    const bank = await loadCardBank(loader);
    expect(bank).toHaveLength(1);
    expect(bank[0]?.bloom).toBe('mountain');
  });

  it('throws when a category file is not an array', async () => {
    const files: Record<string, unknown> = {};
    for (const c of CATEGORIES) files[`data/brambles/${c}.json`] = [];
    files['data/brambles/nature.json'] = { not: 'an array' };
    const loader = createMemoryAssetLoaderFactory(files).forModule('x');
    await expect(loadCardBank(loader)).rejects.toThrow(/must be a JSON array/);
  });
});

describe('validateCardBank', () => {
  it('accepts a well-formed bank', () => {
    expect(() =>
      validateCardBank([card(), card({ id: 'nature-002', bloom: 'river' })]),
    ).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    expect(() => validateCardBank([card(), card({ bloom: 'river' })])).toThrow(/duplicate id/);
  });

  it('rejects an id not matching <category>-NNN', () => {
    expect(() => validateCardBank([card({ id: 'nature-1' })])).toThrow(/must match/);
    expect(() => validateCardBank([card({ id: 'food-001' })])).toThrow(/must match/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateCardBank([card({ id: 'x-001', category: 'x' })])).toThrow(
      /expected one of/,
    );
  });

  it('rejects an empty bloom', () => {
    expect(() => validateCardBank([card({ bloom: '  ' })])).toThrow(/empty bloom/);
  });

  it(`requires exactly ${THORNS_PER_CARD} thorns`, () => {
    expect(() => validateCardBank([card({ thorns: ['a', 'b', 'c'] })])).toThrow(/exactly 5 thorns/);
  });

  it('rejects a thorn equal to the bloom', () => {
    expect(() => validateCardBank([card({ thorns: ['mountain', 'b', 'c', 'd', 'e'] })])).toThrow(
      /equal to its bloom/,
    );
  });

  it('rejects a duplicate thorn', () => {
    expect(() => validateCardBank([card({ thorns: ['peak', 'peak', 'c', 'd', 'e'] })])).toThrow(
      /duplicate thorn/,
    );
  });

  it('rejects a duplicate bloom within a category', () => {
    expect(() => validateCardBank([card(), card({ id: 'nature-002', bloom: 'Mountain' })])).toThrow(
      /duplicate bloom/,
    );
  });
});
