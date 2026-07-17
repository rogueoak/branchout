import { describe, expect, it } from 'vitest';
import { defaultLoneLeafConfig, validateLoneLeafConfig, type LoneLeafHostConfig } from './config';

describe('validateLoneLeafConfig', () => {
  it('accepts the default config (random, 5 rounds)', () => {
    expect(validateLoneLeafConfig(defaultLoneLeafConfig())).toEqual([]);
  });

  it('accepts 1-3 distinct known themes', () => {
    expect(validateLoneLeafConfig({ categories: ['nature'], rounds: 4 })).toEqual([]);
    expect(validateLoneLeafConfig({ categories: ['nature', 'food', 'places'], rounds: 4 })).toEqual(
      [],
    );
  });

  it('rejects more than three themes', () => {
    const errors = validateLoneLeafConfig({
      categories: ['nature', 'food', 'places', 'animals'],
      rounds: 4,
    });
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('rejects an empty non-random selection and unknown/duplicate themes', () => {
    expect(
      validateLoneLeafConfig({ categories: [], rounds: 4 }).some((e) => e.field === 'categories'),
    ).toBe(true);
    expect(
      validateLoneLeafConfig({ categories: ['nature', 'nature'], rounds: 4 }).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
    expect(
      validateLoneLeafConfig({ categories: ['galaxies'], rounds: 4 }).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
  });

  it('rejects out-of-range or non-integer rounds', () => {
    for (const rounds of [0, 101, 2.5, Number.NaN]) {
      const errors = validateLoneLeafConfig({ categories: 'random', rounds } as LoneLeafHostConfig);
      expect(errors.some((e) => e.field === 'rounds')).toBe(true);
    }
  });
});
