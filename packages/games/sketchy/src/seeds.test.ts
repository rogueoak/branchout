import { describe, expect, it } from 'vitest';
import { createMemoryAssetLoaderFactory } from '@branchout/game-sdk/testing';
import { CATEGORIES, loadSeedBank, validateSeedBank, type SketchySeed } from './seeds';

function bankFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const category of CATEGORIES) files[`data/sketchy/${category}.json`] = [];
  files['data/sketchy/animals.json'] = [
    { id: 'animals-001', category: 'animals', text: 'a cat' },
    { id: 'animals-002', category: 'animals', text: 'a dog' },
  ];
  return files;
}

describe('loadSeedBank', () => {
  it('flattens every category file through the loader', async () => {
    const assets = createMemoryAssetLoaderFactory(bankFiles()).forModule('x');
    const bank = await loadSeedBank(assets);
    expect(bank.map((s) => s.id)).toContain('animals-001');
    expect(bank).toHaveLength(2);
  });

  it('throws when a category file is not an array', async () => {
    const files = bankFiles();
    files['data/sketchy/food.json'] = { nope: true };
    const assets = createMemoryAssetLoaderFactory(files).forModule('x');
    await expect(loadSeedBank(assets)).rejects.toThrow(/must be a JSON array/);
  });
});

describe('validateSeedBank', () => {
  const ok: SketchySeed[] = [{ id: 'animals-001', category: 'animals', text: 'a cat' }];

  it('accepts a well-formed bank', () => {
    expect(() => validateSeedBank(ok)).not.toThrow();
  });

  it('rejects a duplicate id', () => {
    expect(() => validateSeedBank([...ok, { ...ok[0]! }])).toThrow(/duplicate id/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateSeedBank([{ id: 'weird-001', category: 'weird', text: 'x' }])).toThrow(
      /category/,
    );
  });

  it('rejects an id that does not match <category>-NNN', () => {
    expect(() => validateSeedBank([{ id: 'animals-1', category: 'animals', text: 'x' }])).toThrow(
      /must match/,
    );
  });

  it('rejects an empty text', () => {
    expect(() =>
      validateSeedBank([{ id: 'animals-001', category: 'animals', text: '  ' }]),
    ).toThrow(/empty text/);
  });

  it('rejects a duplicate prompt in a category', () => {
    expect(() =>
      validateSeedBank([
        { id: 'animals-001', category: 'animals', text: 'a cat' },
        { id: 'animals-002', category: 'animals', text: 'A Cat' },
      ]),
    ).toThrow(/duplicate prompt/);
  });
});
