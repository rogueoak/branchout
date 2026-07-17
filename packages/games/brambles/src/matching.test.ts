import { describe, expect, it } from 'vitest';
import {
  findPrick,
  isGuessMatch,
  normalize,
  sameStem,
  stem,
  tokenize,
  editDistance,
} from './matching';

describe('normalize + tokenize', () => {
  it('lowercases, drops punctuation, and folds accents', () => {
    expect(normalize('  Cafe!  ')).toBe('cafe');
    // "Ni\u00f1o" is "Nino" with an n-tilde; the source stays ASCII via the escape.
    expect(normalize('Ni\u00f1o')).toBe('nino');
    expect(tokenize('the Big-Red Dog')).toEqual(['the', 'big', 'red', 'dog']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('stem + sameStem', () => {
  it('collapses common suffixes so obvious variants match', () => {
    expect(sameStem('run', 'running')).toBe(true);
    expect(sameStem('berry', 'berries')).toBe(true);
    expect(sameStem('climb', 'climbed')).toBe(true);
    expect(sameStem('cat', 'cats')).toBe(true);
  });
  it('does not over-stem short or unrelated words', () => {
    expect(stem('was')).toBe('was');
    expect(sameStem('run', 'ran')).toBe(false); // irregular past not caught (acceptable)
    expect(sameStem('mountain', 'river')).toBe(false);
  });
});

describe('findPrick - the auto-referee', () => {
  const bloom = 'mountain';
  const thorns = ['peak', 'climb', 'summit', 'high', 'range'];

  it('pricks when the clue contains the bloom', () => {
    expect(findPrick('a tall mountain', bloom, thorns)).toBe('mountain');
  });
  it('pricks on an obvious variant of the bloom (a near-stem)', () => {
    expect(findPrick('lots of mountains here', bloom, thorns)).toBe('mountain');
  });
  it('pricks when the clue contains a thorn', () => {
    expect(findPrick('you climb it', bloom, thorns)).toBe('climb');
    expect(findPrick('reach the peak', bloom, thorns)).toBe('peak');
  });
  it('pricks on a variant of a thorn', () => {
    expect(findPrick('you are climbing up', bloom, thorns)).toBe('climb');
  });
  it('does not prick a clean clue', () => {
    expect(findPrick('it is very tall and rocky', bloom, thorns)).toBeNull();
    expect(findPrick('you ski down it in winter', bloom, thorns)).toBeNull();
  });
  it('requires the whole phrase for a multi-word thorn', () => {
    // A two-word thorn should not trip on just one of its words.
    expect(
      findPrick('a big bear', 'iceberg', ['polar bear', 'cold', 'white', 'ice', 'float']),
    ).toBeNull();
    expect(
      findPrick('a polar bear swims', 'iceberg', ['polar bear', 'cold', 'white', 'ice', 'float']),
    ).toBe('polar bear');
  });
  it('returns null for an empty clue', () => {
    expect(findPrick('   ', bloom, thorns)).toBeNull();
  });
});

describe('editDistance + isGuessMatch - the fuzzy guess', () => {
  it('computes edit distance', () => {
    expect(editDistance('cat', 'cat')).toBe(0);
    expect(editDistance('cat', 'bat')).toBe(1);
    expect(editDistance('mountain', 'mountian')).toBe(2);
  });
  it('accepts an exact guess', () => {
    expect(isGuessMatch('mountain', 'mountain')).toBe(true);
  });
  it('accepts a small typo', () => {
    expect(isGuessMatch('mountian', 'mountain')).toBe(true); // transposed letters
    expect(isGuessMatch('pancak', 'pancake')).toBe(true);
  });
  it('accepts a plural/tense variant of a single-word bloom', () => {
    expect(isGuessMatch('berries', 'berry')).toBe(true);
    expect(isGuessMatch('rivers', 'river')).toBe(true);
  });
  it('rejects a clearly different word', () => {
    expect(isGuessMatch('ocean', 'mountain')).toBe(false);
    expect(isGuessMatch('', 'mountain')).toBe(false);
  });
  it('requires the full phrase for a two-word bloom', () => {
    expect(isGuessMatch('bear', 'polar bear')).toBe(false);
    expect(isGuessMatch('polar bear', 'polar bear')).toBe(true);
  });
});
