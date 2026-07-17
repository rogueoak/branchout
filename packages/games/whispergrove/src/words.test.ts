// Whispergrove word bank tests (spec 0062): the loader flattens + de-dupes + upper-cases across
// categories, and the structural validator enforces single-token ASCII nouns with no duplicates. The
// bundled sample files (data/whispergrove/*.json) are validated so a malformed word is caught at CI.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryAssetLoaderFactory } from '@branchout/game-sdk/testing';
import { loadWordBank, validateWordCategory, isSingleToken, CATEGORIES } from './words';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'data', 'whispergrove');

describe('validateWordCategory', () => {
  it('accepts single-token ASCII words', () => {
    expect(() => validateWordCategory('nature', ['River', 'Mountain', 'Forest'])).not.toThrow();
  });

  it('rejects a multi-token word', () => {
    expect(() => validateWordCategory('nature', ['Old River'])).toThrow(
      /single ASCII-letter token/,
    );
  });

  it('rejects a non-letter word', () => {
    expect(() => validateWordCategory('nature', ['River2'])).toThrow(/single ASCII-letter token/);
  });

  it('rejects an empty word', () => {
    expect(() => validateWordCategory('nature', [''])).toThrow(/missing or empty/);
  });

  it('rejects a duplicate word (case-insensitive)', () => {
    expect(() => validateWordCategory('nature', ['River', 'river'])).toThrow(/duplicate/);
  });
});

describe('isSingleToken', () => {
  it('accepts a single word, rejects spaces/digits', () => {
    expect(isSingleToken('canopy')).toBe(true);
    expect(isSingleToken('two words')).toBe(false);
    expect(isSingleToken('r2d2')).toBe(false);
  });
});

describe('loadWordBank', () => {
  it('flattens, upper-cases, and de-dupes across categories', async () => {
    const assets = createMemoryAssetLoaderFactory({
      'data/whispergrove/nature.json': ['River', 'Forest'],
      'data/whispergrove/places.json': ['Forest', 'Castle'], // Forest duplicates nature
    }).forModule('file:///x.js');
    const words = await loadWordBank(assets, ['nature', 'places']);
    expect(words).toEqual(['RIVER', 'FOREST', 'CASTLE']);
  });
});

describe('bundled sample bank', () => {
  it('every category file exists and validates (>= 25 words each so the grove always fills)', () => {
    for (const category of CATEGORIES) {
      const raw = JSON.parse(
        readFileSync(path.join(DATA_DIR, `${category}.json`), 'utf8'),
      ) as unknown[];
      expect(() => validateWordCategory(category, raw)).not.toThrow();
      expect(raw.length).toBeGreaterThanOrEqual(25);
    }
  });

  it('has at least ~400 words across the bank combined', () => {
    let total = 0;
    for (const category of CATEGORIES) {
      const raw = JSON.parse(
        readFileSync(path.join(DATA_DIR, `${category}.json`), 'utf8'),
      ) as unknown[];
      total += raw.length;
    }
    expect(total).toBeGreaterThanOrEqual(380);
  });
});
