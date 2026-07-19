import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CONFIGURABLE_CATEGORIES,
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  DIFFICULTY_PRESETS,
  ROUND_PRESETS,
  defaultTriviaConfig,
  difficultyPresetId,
  validateTriviaConfig,
  type TriviaHostConfig,
} from './config';

const base: TriviaHostConfig = defaultTriviaConfig();

// This list mirrors the engine's source of truth (packages/games/trivia/src/trivia.ts). It is pinned
// here so an accidental edit to the client mirror fails loudly rather than drifting silently; if the
// engine ever changes its categories, update both together.
describe('category parity with the engine', () => {
  it('offers the eight engine categories plus Random, in order', () => {
    expect(CONFIGURABLE_CATEGORIES).toEqual([
      'Nature',
      'Food',
      'Animals',
      'Science',
      'People',
      'Places',
      'Things',
      'History',
      'Random',
    ]);
  });
});

describe('defaultTriviaConfig', () => {
  it('defaults to Random, 10 rounds, Medium (3-6), auto-advance on at 5s, 60s limit', () => {
    expect(defaultTriviaConfig()).toEqual({
      categories: [],
      rounds: 10,
      difficultyMin: 3,
      difficultyMax: 6,
      autoAdvance: true,
      advanceAfterSeconds: 5,
      timeLimitSeconds: 60,
    });
    expect(validateTriviaConfig(base)).toEqual([]);
  });
});

describe('validateTriviaConfig', () => {
  it('accepts Random (empty) and a real category subset', () => {
    expect(validateTriviaConfig({ ...base, categories: [] })).toEqual([]);
    expect(validateTriviaConfig({ ...base, categories: ['Science'] })).toEqual([]);
    expect(validateTriviaConfig({ ...base, categories: ['Science', 'Food'] })).toEqual([]);
  });

  it('rejects an unknown category in the subset', () => {
    expect(validateTriviaConfig({ ...base, categories: ['Sports'] })).toEqual([
      expect.objectContaining({ field: 'categories' }),
    ]);
    expect(validateTriviaConfig({ ...base, categories: ['Science', 'Nope'] })).toEqual([
      expect.objectContaining({ field: 'categories' }),
    ]);
  });

  it('accepts the round + difficulty boundaries, including a single-value range', () => {
    expect(
      validateTriviaConfig({ ...base, rounds: 1, difficultyMin: 1, difficultyMax: 10 }),
    ).toEqual([]);
    expect(
      validateTriviaConfig({ ...base, rounds: 100, difficultyMin: 5, difficultyMax: 5 }),
    ).toEqual([]);
  });

  it('rejects rounds below 1, above 100, or non-integer', () => {
    for (const rounds of [0, 101, Number.NaN, 3.5]) {
      expect(validateTriviaConfig({ ...base, rounds })).toEqual([
        expect.objectContaining({ field: 'rounds' }),
      ]);
    }
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

  it('rejects an advance-after outside 1-60 and a time-limit outside 10-180', () => {
    for (const advanceAfterSeconds of [0, 61, 5.5]) {
      expect(validateTriviaConfig({ ...base, advanceAfterSeconds })).toEqual([
        expect.objectContaining({ field: 'advanceAfter' }),
      ]);
    }
    for (const timeLimitSeconds of [9, 181, 12.5]) {
      expect(validateTriviaConfig({ ...base, timeLimitSeconds })).toEqual([
        expect.objectContaining({ field: 'timeLimit' }),
      ]);
    }
  });

  it('reports every failure at once', () => {
    const errors = validateTriviaConfig({
      categories: ['Sports'],
      rounds: 0,
      difficultyMin: 1,
      difficultyMax: 99,
      autoAdvance: true,
      advanceAfterSeconds: 0,
      timeLimitSeconds: 0,
    });
    expect(errors.map((error) => error.field).sort()).toEqual([
      'advanceAfter',
      'categories',
      'difficulty',
      'rounds',
      'timeLimit',
    ]);
  });
});

describe('presets', () => {
  it('exposes Fast/Medium/Long round presets', () => {
    expect(ROUND_PRESETS.map((preset) => [preset.label, preset.value])).toEqual([
      ['Fast', 10],
      ['Medium', 20],
      ['Long', 40],
    ]);
  });

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

  it('keeps the mirror category list in step (the eight, no Random)', () => {
    expect(CATEGORIES).toHaveLength(8);
    expect(CATEGORIES).not.toContain('Random');
  });
});
