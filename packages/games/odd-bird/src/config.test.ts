import { describe, expect, it } from 'vitest';
import { validateConfig } from './config';

describe('Odd Bird config', () => {
  it('defaults an empty config to random categories', () => {
    expect(validateConfig({})).toEqual({ categories: 'random' });
    expect(validateConfig(undefined)).toEqual({ categories: 'random' });
  });

  it('keeps the random sentinel', () => {
    expect(validateConfig({ categories: 'random' })).toEqual({ categories: 'random' });
  });

  it('accepts a distinct list of known categories', () => {
    expect(validateConfig({ categories: ['everyday', 'travel'] })).toEqual({
      categories: ['everyday', 'travel'],
    });
  });

  it('rejects an empty category list', () => {
    expect(() => validateConfig({ categories: [] })).toThrow(/1-/);
  });

  it('rejects a duplicate category', () => {
    expect(() => validateConfig({ categories: ['everyday', 'everyday'] })).toThrow(/distinct/);
  });

  it('rejects an unknown category', () => {
    expect(() => validateConfig({ categories: ['nope'] })).toThrow(/unknown/);
  });

  it('rejects a non-array, non-random categories value', () => {
    expect(() => validateConfig({ categories: 'everyday' })).toThrow(/must be/);
  });
});
