import { describe, expect, it } from 'vitest';
import { normalizeAnswer, sameAnswer } from './matching';

describe('normalizeAnswer', () => {
  it('folds case, whitespace, punctuation, and a single leading article', () => {
    expect(normalizeAnswer('  The   Cat! ')).toBe('cat');
    expect(normalizeAnswer('a cat')).toBe('cat');
    expect(normalizeAnswer('an owl')).toBe('owl');
  });

  it('normalizes a junk-only string to empty', () => {
    expect(normalizeAnswer('!!!')).toBe('');
  });
});

describe('sameAnswer', () => {
  it('is exact after normalization, not fuzzy', () => {
    expect(sameAnswer('the dog', 'A Dog')).toBe(true);
    expect(sameAnswer('dog', 'dogs')).toBe(false);
  });
});
