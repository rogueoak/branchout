import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('defaults rounds and accepts random', () => {
    expect(validateConfig({ categories: 'random' })).toEqual({
      categories: 'random',
      rounds: DEFAULT_ROUNDS,
    });
  });

  it('accepts 1-3 distinct known categories', () => {
    expect(validateConfig({ categories: ['nature', 'food'], rounds: 3 })).toEqual({
      categories: ['nature', 'food'],
      rounds: 3,
    });
  });

  it('rejects an unknown category', () => {
    expect(() => validateConfig({ categories: ['galaxies'] })).toThrow(/unknown/);
  });

  it('rejects too many categories', () => {
    expect(() => validateConfig({ categories: ['nature', 'food', 'places', 'animals'] })).toThrow(
      /1-3/,
    );
  });

  it('rejects duplicate categories', () => {
    expect(() => validateConfig({ categories: ['nature', 'nature'] })).toThrow(/distinct/);
  });

  it('rejects out-of-range rounds', () => {
    expect(() => validateConfig({ categories: 'random', rounds: 0 })).toThrow(/rounds/);
    expect(() => validateConfig({ categories: 'random', rounds: 101 })).toThrow(/rounds/);
  });
});
