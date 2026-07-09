import { describe, expect, it } from 'vitest';
import { normalizeAnswer, sameAnswer } from './matching';

describe('normalizeAnswer', () => {
  it('lowercases, trims, and collapses inner whitespace', () => {
    expect(normalizeAnswer('  The   Moon  ')).toBe('moon');
  });

  it('strips a single leading article', () => {
    expect(normalizeAnswer('A banana')).toBe('banana');
    expect(normalizeAnswer('an owl')).toBe('owl');
    expect(normalizeAnswer('the eiffel tower')).toBe('eiffel tower');
  });

  it('drops punctuation but keeps letters and digits', () => {
    expect(normalizeAnswer("O'Brien!")).toBe('obrien');
    expect(normalizeAnswer('route 66')).toBe('route 66');
  });
});

describe('sameAnswer', () => {
  it('is true across formatting differences', () => {
    expect(sameAnswer('The Moon', 'moon')).toBe(true);
    expect(sameAnswer('a Banana!', 'banana')).toBe(true);
  });

  it('is exact - distinct answers never collapse (no fuzzy tolerance)', () => {
    expect(sameAnswer('moon', 'moons')).toBe(false);
    expect(sameAnswer('cat', 'cot')).toBe(false);
  });
});
