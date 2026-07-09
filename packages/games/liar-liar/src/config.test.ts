import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('accepts random and defaults rounds to 10', () => {
    expect(validateConfig({ categories: 'random' })).toEqual({
      categories: 'random',
      rounds: DEFAULT_ROUNDS,
    });
  });

  it('accepts 1-3 distinct known categories and a valid round count', () => {
    expect(validateConfig({ categories: ['people', 'food'], rounds: 5 })).toEqual({
      categories: ['people', 'food'],
      rounds: 5,
    });
  });

  it('rejects more than three categories', () => {
    expect(() => validateConfig({ categories: ['people', 'food', 'places', 'animals'] })).toThrow(
      /1-3/,
    );
  });

  it('rejects an empty category array', () => {
    expect(() => validateConfig({ categories: [] })).toThrow(/1-3/);
  });

  it('rejects duplicate categories', () => {
    expect(() => validateConfig({ categories: ['people', 'people'] })).toThrow(/distinct/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateConfig({ categories: ['wizards'] })).toThrow(/unknown/);
  });

  it('rejects a non-array, non-random categories value', () => {
    expect(() => validateConfig({ categories: 'people' })).toThrow(/random/);
  });

  it('rejects out-of-range rounds', () => {
    expect(() => validateConfig({ categories: 'random', rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ categories: 'random', rounds: 101 })).toThrow(/rounds/);
    expect(() => validateConfig({ categories: 'random', rounds: 2.5 })).toThrow(/rounds/);
  });
});
