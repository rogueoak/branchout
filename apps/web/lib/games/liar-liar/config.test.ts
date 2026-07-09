import { describe, expect, it } from 'vitest';
import { defaultLiarLiarConfig, validateLiarLiarConfig, type LiarLiarHostConfig } from './config';

describe('validateLiarLiarConfig', () => {
  it('accepts the default config (random, 10 rounds)', () => {
    expect(validateLiarLiarConfig(defaultLiarLiarConfig())).toEqual([]);
  });

  it('accepts 1-3 distinct known categories', () => {
    expect(validateLiarLiarConfig({ categories: ['people'], rounds: 5 })).toEqual([]);
    expect(validateLiarLiarConfig({ categories: ['people', 'food', 'sports'], rounds: 5 })).toEqual(
      [],
    );
  });

  it('rejects more than three categories', () => {
    const errors = validateLiarLiarConfig({
      categories: ['people', 'food', 'sports', 'nature'],
      rounds: 5,
    });
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('rejects an empty non-random selection', () => {
    const errors = validateLiarLiarConfig({ categories: [], rounds: 5 });
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('rejects duplicate and unknown categories', () => {
    expect(
      validateLiarLiarConfig({ categories: ['people', 'people'], rounds: 5 }).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
    expect(
      validateLiarLiarConfig({ categories: ['wizards'], rounds: 5 }).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
  });

  it('rejects out-of-range or non-integer rounds', () => {
    for (const rounds of [0, 101, 2.5, Number.NaN]) {
      const errors = validateLiarLiarConfig({ categories: 'random', rounds } as LiarLiarHostConfig);
      expect(errors.some((e) => e.field === 'rounds')).toBe(true);
    }
  });
});
