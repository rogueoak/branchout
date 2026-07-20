import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, validateConfig } from './config';

describe('validateConfig', () => {
  it('defaults rounds and pacing, and accepts random', () => {
    expect(validateConfig({ categories: 'random' })).toEqual({
      categories: 'random',
      rounds: DEFAULT_ROUNDS,
      autoAdvance: true,
      advanceAfterMs: 5_000,
      clueMs: 60_000,
      guessMs: 60_000,
    });
  });

  it('defaults rounds to 10', () => {
    expect(DEFAULT_ROUNDS).toBe(10);
  });

  it('accepts 1-3 distinct known categories', () => {
    expect(validateConfig({ categories: ['nature', 'food'], rounds: 3 })).toMatchObject({
      categories: ['nature', 'food'],
      rounds: 3,
    });
  });

  it('resolves pacing seconds to milliseconds', () => {
    expect(
      validateConfig({
        categories: 'random',
        autoAdvance: true,
        advanceAfterSeconds: 8,
        clueSeconds: 45,
        guessSeconds: 90,
      }),
    ).toMatchObject({
      autoAdvance: true,
      advanceAfterMs: 8_000,
      clueMs: 45_000,
      guessMs: 90_000,
    });
  });

  it('keeps auto-advance off as a boolean (the engine infers it from leaderboardWindowMs)', () => {
    expect(validateConfig({ categories: 'random', autoAdvance: false })).toMatchObject({
      autoAdvance: false,
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

  it('rejects a non-boolean autoAdvance', () => {
    expect(() =>
      validateConfig({ categories: 'random', autoAdvance: 'yes' as unknown as boolean }),
    ).toThrow(/autoAdvance/);
  });

  it('rejects out-of-range advanceAfterSeconds', () => {
    expect(() => validateConfig({ categories: 'random', advanceAfterSeconds: 0 })).toThrow(
      /advanceAfterSeconds/,
    );
    expect(() => validateConfig({ categories: 'random', advanceAfterSeconds: 61 })).toThrow(
      /advanceAfterSeconds/,
    );
  });

  it('rejects out-of-range clue/guess seconds', () => {
    expect(() => validateConfig({ categories: 'random', clueSeconds: 14 })).toThrow(/clueSeconds/);
    expect(() => validateConfig({ categories: 'random', clueSeconds: 181 })).toThrow(/clueSeconds/);
    expect(() => validateConfig({ categories: 'random', guessSeconds: 14 })).toThrow(
      /guessSeconds/,
    );
    expect(() => validateConfig({ categories: 'random', guessSeconds: 181 })).toThrow(
      /guessSeconds/,
    );
  });

  it('accepts the inclusive boundary values', () => {
    expect(
      validateConfig({
        categories: 'random',
        advanceAfterSeconds: 1,
        clueSeconds: 15,
        guessSeconds: 180,
      }),
    ).toMatchObject({ advanceAfterMs: 1_000, clueMs: 15_000, guessMs: 180_000 });
    expect(
      validateConfig({
        categories: 'random',
        advanceAfterSeconds: 60,
        clueSeconds: 180,
        guessSeconds: 15,
      }),
    ).toMatchObject({ advanceAfterMs: 60_000, clueMs: 180_000, guessMs: 15_000 });
  });

  it('does not fail on a bad advanceAfterSeconds when auto-advance is off (it is unused)', () => {
    expect(() =>
      validateConfig({ categories: 'random', autoAdvance: false, advanceAfterSeconds: 999 }),
    ).not.toThrow();
  });
});
