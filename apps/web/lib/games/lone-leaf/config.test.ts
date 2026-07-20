import { describe, expect, it } from 'vitest';
import { defaultLoneLeafConfig, validateLoneLeafConfig, type LoneLeafHostConfig } from './config';

/** Build a full host config from the defaults, overriding just the fields under test. */
function cfg(overrides: Partial<LoneLeafHostConfig> = {}): LoneLeafHostConfig {
  return { ...defaultLoneLeafConfig(), ...overrides };
}

describe('validateLoneLeafConfig', () => {
  it('accepts the default config (random, 10 rounds, auto-advance 5s, 60s/60s windows)', () => {
    const config = defaultLoneLeafConfig();
    expect(config).toMatchObject({
      categories: 'random',
      rounds: 10,
      autoAdvance: true,
      advanceAfterSeconds: 5,
      clueSeconds: 60,
      guessSeconds: 60,
    });
    expect(validateLoneLeafConfig(config)).toEqual([]);
  });

  it('accepts 1-3 distinct known themes', () => {
    expect(validateLoneLeafConfig(cfg({ categories: ['nature'], rounds: 4 }))).toEqual([]);
    expect(
      validateLoneLeafConfig(cfg({ categories: ['nature', 'food', 'places'], rounds: 4 })),
    ).toEqual([]);
  });

  it('rejects more than three themes', () => {
    const errors = validateLoneLeafConfig(
      cfg({ categories: ['nature', 'food', 'places', 'animals'], rounds: 4 }),
    );
    expect(errors.some((e) => e.field === 'categories')).toBe(true);
  });

  it('rejects an empty non-random selection and unknown/duplicate themes', () => {
    expect(
      validateLoneLeafConfig(cfg({ categories: [], rounds: 4 })).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
    expect(
      validateLoneLeafConfig(cfg({ categories: ['nature', 'nature'], rounds: 4 })).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
    expect(
      validateLoneLeafConfig(cfg({ categories: ['galaxies'], rounds: 4 })).some(
        (e) => e.field === 'categories',
      ),
    ).toBe(true);
  });

  it('rejects out-of-range or non-integer rounds', () => {
    for (const rounds of [0, 101, 2.5, Number.NaN]) {
      const errors = validateLoneLeafConfig(cfg({ categories: 'random', rounds }));
      expect(errors.some((e) => e.field === 'rounds')).toBe(true);
    }
  });

  it('rejects out-of-range advance-after seconds', () => {
    for (const advanceAfterSeconds of [0, 61, 2.5, Number.NaN]) {
      const errors = validateLoneLeafConfig(cfg({ advanceAfterSeconds }));
      expect(errors.some((e) => e.field === 'advanceAfter')).toBe(true);
    }
  });

  it('rejects out-of-range clue and guess windows', () => {
    for (const clueSeconds of [14, 181, 20.5, Number.NaN]) {
      const errors = validateLoneLeafConfig(cfg({ clueSeconds }));
      expect(errors.some((e) => e.field === 'clue')).toBe(true);
    }
    for (const guessSeconds of [14, 181, 20.5, Number.NaN]) {
      const errors = validateLoneLeafConfig(cfg({ guessSeconds }));
      expect(errors.some((e) => e.field === 'guess')).toBe(true);
    }
  });

  it('accepts the inclusive boundary values', () => {
    expect(
      validateLoneLeafConfig(cfg({ advanceAfterSeconds: 1, clueSeconds: 15, guessSeconds: 180 })),
    ).toEqual([]);
    expect(
      validateLoneLeafConfig(cfg({ advanceAfterSeconds: 60, clueSeconds: 180, guessSeconds: 15 })),
    ).toEqual([]);
  });

  it('skips the advance-after check when auto-advance is off (the field is disabled)', () => {
    const errors = validateLoneLeafConfig(
      cfg({ autoAdvance: false, advanceAfterSeconds: Number.NaN }),
    );
    expect(errors.some((e) => e.field === 'advanceAfter')).toBe(false);
  });
});
