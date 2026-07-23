import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CONFIGURABLE_CATEGORIES,
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  DIFFICULTY_PRESETS,
  DURATION_PRESETS,
  compositionOf,
  defaultTriviaConfig,
  difficultyPresetId,
  roundTypeLabel,
  totalRoundsOf,
  validateTriviaConfig,
  type TriviaHostConfig,
} from './config';

const base: TriviaHostConfig = defaultTriviaConfig();

// This list mirrors the engine's source of truth (packages/games/trivia/src/trivia.ts). It is pinned
// here so an accidental edit to the client mirror fails loudly rather than drifting silently; if the
// engine ever changes its categories, update both together.
describe('category parity with the engine', () => {
  it('offers the ten engine categories plus Random, in order', () => {
    expect(CONFIGURABLE_CATEGORIES).toEqual([
      'Nature',
      'Food',
      'Animals',
      'Science',
      'People',
      'Places',
      'Things',
      'History',
      'Movies',
      'Music',
      'Random',
    ]);
  });
});

describe('defaultTriviaConfig', () => {
  it('defaults to Random, Standard duration, Medium (3-6), auto-advance on at 5s, per-type timers', () => {
    expect(defaultTriviaConfig()).toEqual({
      categories: [],
      duration: 'standard',
      difficultyMin: 3,
      difficultyMax: 6,
      autoAdvance: true,
      advanceAfterSeconds: 5,
      mcTimeLimitSeconds: 20,
      tfTimeLimitSeconds: 15,
      openTimeLimitSeconds: 60,
    });
    expect(validateTriviaConfig(base)).toEqual([]);
  });
});

describe('duration presets + composition', () => {
  it('exposes Fast/Standard/Long/Marathon with the locked MC/TF/open compositions', () => {
    expect(
      DURATION_PRESETS.map((preset) => [
        preset.id,
        preset.composition.multipleChoice,
        preset.composition.trueFalse,
        preset.composition.open,
      ]),
    ).toEqual([
      ['fast', 3, 2, 1],
      ['standard', 6, 4, 2],
      ['long', 12, 8, 4],
      ['marathon', 24, 16, 8],
    ]);
  });

  it('derives the composition + total for each preset', () => {
    expect(compositionOf({ ...base, duration: 'fast' })).toEqual({
      multipleChoice: 3,
      trueFalse: 2,
      open: 1,
    });
    expect(totalRoundsOf({ ...base, duration: 'fast' })).toBe(6);
    expect(totalRoundsOf({ ...base, duration: 'standard' })).toBe(12);
    expect(totalRoundsOf({ ...base, duration: 'long' })).toBe(24);
    expect(totalRoundsOf({ ...base, duration: 'marathon' })).toBe(48);
  });

  it('derives the composition + total from custom counts', () => {
    const config: TriviaHostConfig = {
      ...base,
      duration: 'custom',
      custom: { multipleChoice: 4, trueFalse: 3, open: 2 },
    };
    expect(compositionOf(config)).toEqual({ multipleChoice: 4, trueFalse: 3, open: 2 });
    expect(totalRoundsOf(config)).toBe(9);
  });
});

describe('roundTypeLabel', () => {
  it('maps each round type to a display label', () => {
    expect(roundTypeLabel('multiple-choice')).toBe('Multiple choice');
    expect(roundTypeLabel('true-false')).toBe('True or false');
    expect(roundTypeLabel('open')).toBe('Open answer');
  });
});

describe('validateTriviaConfig', () => {
  it('accepts Random (empty) and a real category subset', () => {
    expect(validateTriviaConfig({ ...base, categories: [] })).toEqual([]);
    expect(validateTriviaConfig({ ...base, categories: ['Science'] })).toEqual([]);
    expect(validateTriviaConfig({ ...base, categories: ['Movies', 'Music'] })).toEqual([]);
  });

  it('rejects an unknown category in the subset', () => {
    expect(validateTriviaConfig({ ...base, categories: ['Sports'] })).toEqual([
      expect.objectContaining({ field: 'categories' }),
    ]);
    expect(validateTriviaConfig({ ...base, categories: ['Science', 'Nope'] })).toEqual([
      expect.objectContaining({ field: 'categories' }),
    ]);
  });

  it('accepts each duration preset', () => {
    for (const duration of ['fast', 'standard', 'long', 'marathon'] as const) {
      expect(validateTriviaConfig({ ...base, duration })).toEqual([]);
    }
  });

  it('rejects an unknown duration', () => {
    expect(
      validateTriviaConfig({
        ...base,
        duration: 'epic' as unknown as TriviaHostConfig['duration'],
      }),
    ).toEqual([expect.objectContaining({ field: 'duration' })]);
  });

  it('accepts a valid custom composition', () => {
    expect(
      validateTriviaConfig({
        ...base,
        duration: 'custom',
        custom: { multipleChoice: 3, trueFalse: 2, open: 1 },
      }),
    ).toEqual([]);
  });

  it('rejects a custom composition with a count out of 0-30 or a total out of 1-60', () => {
    // A per-type count above 30.
    expect(
      validateTriviaConfig({
        ...base,
        duration: 'custom',
        custom: { multipleChoice: 31, trueFalse: 0, open: 0 },
      }),
    ).toEqual([expect.objectContaining({ field: 'custom' })]);
    // An all-zero mix has a total below 1.
    expect(
      validateTriviaConfig({
        ...base,
        duration: 'custom',
        custom: { multipleChoice: 0, trueFalse: 0, open: 0 },
      }),
    ).toEqual([expect.objectContaining({ field: 'custom' })]);
    // A total above 60 (each in-range, but the sum exceeds the cap).
    expect(
      validateTriviaConfig({
        ...base,
        duration: 'custom',
        custom: { multipleChoice: 30, trueFalse: 30, open: 10 },
      }),
    ).toEqual([expect.objectContaining({ field: 'custom' })]);
    // Custom with no counts at all.
    expect(validateTriviaConfig({ ...base, duration: 'custom', custom: undefined })).toEqual([
      expect.objectContaining({ field: 'custom' }),
    ]);
  });

  it('accepts the difficulty boundaries, including a single-value range', () => {
    expect(validateTriviaConfig({ ...base, difficultyMin: 1, difficultyMax: 10 })).toEqual([]);
    expect(validateTriviaConfig({ ...base, difficultyMin: 5, difficultyMax: 5 })).toEqual([]);
  });

  it('rejects a difficulty bound outside 1-10 or an inverted range', () => {
    expect(validateTriviaConfig({ ...base, difficultyMin: 0 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
    expect(validateTriviaConfig({ ...base, difficultyMax: 11 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
    expect(validateTriviaConfig({ ...base, difficultyMin: 7, difficultyMax: 4 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
  });

  it('rejects an advance-after outside 1-60', () => {
    for (const advanceAfterSeconds of [0, 61, 5.5]) {
      expect(validateTriviaConfig({ ...base, advanceAfterSeconds })).toEqual([
        expect.objectContaining({ field: 'advanceAfter' }),
      ]);
    }
  });

  it('rejects each per-type time limit outside its bounds (mc/tf 5-180, open 10-180)', () => {
    for (const mcTimeLimitSeconds of [4, 181, 12.5]) {
      expect(validateTriviaConfig({ ...base, mcTimeLimitSeconds })).toEqual([
        expect.objectContaining({ field: 'mcTimeLimit' }),
      ]);
    }
    for (const tfTimeLimitSeconds of [4, 181, 12.5]) {
      expect(validateTriviaConfig({ ...base, tfTimeLimitSeconds })).toEqual([
        expect.objectContaining({ field: 'tfTimeLimit' }),
      ]);
    }
    for (const openTimeLimitSeconds of [9, 181, 12.5]) {
      expect(validateTriviaConfig({ ...base, openTimeLimitSeconds })).toEqual([
        expect.objectContaining({ field: 'openTimeLimit' }),
      ]);
    }
  });

  it('reports every failure at once', () => {
    const errors = validateTriviaConfig({
      categories: ['Sports'],
      duration: 'custom',
      custom: { multipleChoice: 0, trueFalse: 0, open: 0 },
      difficultyMin: 1,
      difficultyMax: 99,
      autoAdvance: true,
      advanceAfterSeconds: 0,
      mcTimeLimitSeconds: 0,
      tfTimeLimitSeconds: 0,
      openTimeLimitSeconds: 0,
    });
    expect(errors.map((error) => error.field).sort()).toEqual([
      'advanceAfter',
      'categories',
      'custom',
      'difficulty',
      'mcTimeLimit',
      'openTimeLimit',
      'tfTimeLimit',
    ]);
  });
});

describe('presets', () => {
  it('maps a difficulty band to its preset id, or Custom when it matches none', () => {
    expect(difficultyPresetId(1, 4)).toBe('easy');
    expect(difficultyPresetId(DEFAULT_DIFFICULTY_MIN, DEFAULT_DIFFICULTY_MAX)).toBe('medium');
    expect(difficultyPresetId(4, 8)).toBe('moderate');
    expect(difficultyPresetId(6, 10)).toBe('hard');
    // The legacy default (4-6) matches no new preset, so it reads as Custom.
    expect(difficultyPresetId(4, 6)).toBe('custom');
  });

  it('keeps every difficulty preset inside the 1-10 range with min <= max', () => {
    for (const preset of DIFFICULTY_PRESETS) {
      expect(preset.min).toBeGreaterThanOrEqual(1);
      expect(preset.max).toBeLessThanOrEqual(10);
      expect(preset.min).toBeLessThanOrEqual(preset.max);
    }
  });

  it('keeps the mirror category list in step (the ten, no Random)', () => {
    expect(CATEGORIES).toHaveLength(10);
    expect(CATEGORIES).not.toContain('Random');
  });
});
