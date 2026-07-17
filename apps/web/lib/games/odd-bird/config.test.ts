import { describe, expect, it } from 'vitest';
import { defaultOddBirdConfig, validateOddBirdConfig } from './config';

describe('Odd Bird web config', () => {
  it('defaults to random categories', () => {
    expect(defaultOddBirdConfig()).toEqual({ categories: 'random' });
  });

  it('accepts random and a distinct known list', () => {
    expect(validateOddBirdConfig({ categories: 'random' })).toEqual([]);
    expect(validateOddBirdConfig({ categories: ['everyday', 'travel'] })).toEqual([]);
  });

  it('rejects an empty list', () => {
    expect(validateOddBirdConfig({ categories: [] })[0]?.field).toBe('categories');
  });

  it('rejects a duplicate category', () => {
    const errors = validateOddBirdConfig({ categories: ['everyday', 'everyday'] });
    expect(errors[0]?.message).toMatch(/distinct/i);
  });

  it('rejects an unknown category', () => {
    const errors = validateOddBirdConfig({ categories: ['nope'] });
    expect(errors[0]?.message).toMatch(/unknown/i);
  });
});
