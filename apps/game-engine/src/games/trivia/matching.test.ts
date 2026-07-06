import { describe, expect, it } from 'vitest';
import { FUZZY_MIN_LENGTH, isCorrectAnswer, levenshtein, normalizeAnswer } from './matching';

describe('normalizeAnswer', () => {
  it('lowercases, trims, and collapses inner whitespace', () => {
    expect(normalizeAnswer('  Carbon   Dioxide  ')).toBe('carbon dioxide');
  });

  it('drops punctuation', () => {
    expect(normalizeAnswer('rock-n-roll!')).toBe('rock n roll');
    expect(normalizeAnswer("O'Brien")).toBe('o brien');
    expect(normalizeAnswer('E = mc^2')).toBe('e mc 2');
  });

  it('joins numeric separators instead of splitting the number', () => {
    // A thousands comma / decimal point sits between digits, so it is removed, not spaced.
    expect(normalizeAnswer('1,000')).toBe('1000');
    expect(normalizeAnswer('3.14')).toBe('314');
    expect(normalizeAnswer('1,000,000')).toBe('1000000');
    // So `1,000` matches `1000` despite the number being under the fuzzy length.
    expect(isCorrectAnswer('1,000', ['1000'])).toBe(true);
  });

  it('strips a single leading article (a / an / the)', () => {
    expect(normalizeAnswer('The Beatles')).toBe('beatles');
    expect(normalizeAnswer('a whale')).toBe('whale');
    expect(normalizeAnswer('an apple')).toBe('apple');
  });

  it('only strips a leading article, not one embedded or trailing', () => {
    // "theatre" starts with "the" but is one word - the article rule needs a following space.
    expect(normalizeAnswer('theatre')).toBe('theatre');
    // A second article is left in place; only the leading one is stripped.
    expect(normalizeAnswer('the the band')).toBe('the band');
  });
});

describe('levenshtein', () => {
  it('measures single-edit distances', () => {
    expect(levenshtein('paris', 'paris')).toBe(0);
    expect(levenshtein('paris', 'pariss')).toBe(1); // insertion
    expect(levenshtein('paris', 'pari')).toBe(1); // deletion
    expect(levenshtein('paris', 'parat')).toBe(2); // two substitutions
  });

  it('honors the early-exit cap without changing the <= max answer', () => {
    expect(levenshtein('kitten', 'sitting', 1)).toBeGreaterThan(1);
    expect(levenshtein('paris', 'parat', 1)).toBeGreaterThan(1);
  });
});

describe('isCorrectAnswer', () => {
  const accepted = ['carbon dioxide', 'co2'];

  it('accepts an exact normalized match', () => {
    expect(isCorrectAnswer('  Carbon Dioxide ', accepted)).toBe(true);
    expect(isCorrectAnswer('CO2', accepted)).toBe(true);
  });

  it('accepts a one-edit typo for a 5+ character answer', () => {
    expect(isCorrectAnswer('carbon dioxide', ['carbon dioxode'])).toBe(true); // sub
    expect(isCorrectAnswer('einstein', ['einsten'])).toBe(true); // deletion, len >= 5
  });

  it('rejects a two-edit difference', () => {
    expect(isCorrectAnswer('carban dioxode', ['carbon dioxide'])).toBe(false);
  });

  it('requires an exact match for short (< 5 char) answers', () => {
    // "cat" vs "cot" is one edit but too short to fuzzy-match.
    expect(isCorrectAnswer('cot', ['cat'])).toBe(false);
    expect(isCorrectAnswer('cat', ['cat'])).toBe(true);
    // The boundary: a 5-char accepted answer is the shortest that fuzzes.
    expect('zebra'.length).toBe(FUZZY_MIN_LENGTH);
    expect(isCorrectAnswer('zebrs', ['zebra'])).toBe(true);
  });

  it('matches through article and punctuation normalization', () => {
    expect(isCorrectAnswer('The Great Wall!', ['great wall'])).toBe(true);
  });

  it('never matches a blank answer', () => {
    expect(isCorrectAnswer('', ['co2'])).toBe(false);
    expect(isCorrectAnswer('   ', accepted)).toBe(false);
  });
});
