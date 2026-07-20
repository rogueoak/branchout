import { describe, expect, it } from 'vitest';
import { isSingleWord, leafKey, normalizeLeaf, sameLeaf, stemLeaf } from './matching';

describe('normalizeLeaf', () => {
  it('lowercases, trims, and drops punctuation', () => {
    expect(normalizeLeaf('  Cat!  ')).toBe('cat');
    expect(normalizeLeaf("O'Brien")).toBe('obrien');
  });
});

describe('stemLeaf', () => {
  it('folds a trailing plural', () => {
    expect(stemLeaf('cats')).toBe('cat');
    expect(stemLeaf('boxes')).toBe('box');
    expect(stemLeaf('berries')).toBe('berry');
  });

  it('folds -ing and -ed', () => {
    expect(stemLeaf('running')).toBe(stemLeaf('runn'));
    expect(stemLeaf('jumped')).toBe('jump');
  });

  it('never over-collapses a short word', () => {
    expect(stemLeaf('as')).toBe('as');
    expect(stemLeaf('is')).toBe('is');
  });
});

describe('sameLeaf', () => {
  it('is true across case and a trailing plural (the wilt collapses them)', () => {
    expect(sameLeaf('Cat', 'cats')).toBe(true);
    expect(sameLeaf('Jump', 'jumping')).toBe(true);
  });

  it('is false for genuinely different words', () => {
    expect(sameLeaf('cat', 'cot')).toBe(false);
    expect(sameLeaf('river', 'lake')).toBe(false);
  });

  it('matches a multi-word seed regardless of case and internal whitespace', () => {
    // Multi-word proper-noun seeds: a Seeker's guess resolves once case + spacing are normalized.
    expect(sameLeaf('albert einstein', 'Albert Einstein')).toBe(true);
    expect(sameLeaf('Albert   Einstein', 'albert einstein')).toBe(true);
    expect(sameLeaf('The Lion King', 'the lion king')).toBe(true);
    expect(sameLeaf('albert einstein', 'marie curie')).toBe(false);
  });

  it('an empty stem never matches another empty stem', () => {
    expect(sameLeaf('!!!', '???')).toBe(false);
  });
});

describe('isSingleWord', () => {
  it('accepts one word and rejects two words or blanks', () => {
    expect(isSingleWord('umbrella')).toBe(true);
    expect(isSingleWord('two words')).toBe(false);
    expect(isSingleWord('   ')).toBe(false);
  });
});

describe('leafKey', () => {
  it('is the normalized, stemmed comparison key', () => {
    expect(leafKey('  Rivers! ')).toBe('river');
  });
});
