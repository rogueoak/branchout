import { describe, expect, it } from 'vitest';
import {
  CONFIGURABLE_CATEGORIES,
  DEFAULT_DIFFICULTY_MAX,
  DEFAULT_DIFFICULTY_MIN,
  DEFAULT_ROUNDS,
  RANDOM_CATEGORY,
  defaultTriviaConfig,
  difficultyBand,
  validateTriviaConfig,
  type TriviaHostConfig,
} from './config';

const base: TriviaHostConfig = {
  category: RANDOM_CATEGORY,
  rounds: DEFAULT_ROUNDS,
  difficultyMin: DEFAULT_DIFFICULTY_MIN,
  difficultyMax: DEFAULT_DIFFICULTY_MAX,
};

// This list mirrors the engine's source of truth (apps/game-engine/.../trivia.ts). It is pinned
// here so an accidental edit to the client mirror fails loudly rather than drifting silently; if
// the engine ever changes its categories, update both together.
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

describe('validateTriviaConfig', () => {
  it('accepts the defaults (Random, 10 rounds, difficulty range 4-6)', () => {
    expect(defaultTriviaConfig()).toEqual({
      category: 'Random',
      rounds: 10,
      difficultyMin: 4,
      difficultyMax: 6,
    });
    expect(validateTriviaConfig(base)).toEqual([]);
  });

  it('accepts the range boundaries, including a single-value range', () => {
    expect(
      validateTriviaConfig({ ...base, rounds: 1, difficultyMin: 1, difficultyMax: 10 }),
    ).toEqual([]);
    expect(
      validateTriviaConfig({ ...base, rounds: 100, difficultyMin: 5, difficultyMax: 5 }),
    ).toEqual([]);
  });

  it('rejects rounds below 1 and above 100', () => {
    expect(validateTriviaConfig({ ...base, rounds: 0 })).toEqual([
      expect.objectContaining({ field: 'rounds' }),
    ]);
    expect(validateTriviaConfig({ ...base, rounds: 101 })).toEqual([
      expect.objectContaining({ field: 'rounds' }),
    ]);
  });

  it('rejects a non-integer round count (e.g. NaN from an empty field)', () => {
    expect(validateTriviaConfig({ ...base, rounds: Number.NaN })).toEqual([
      expect.objectContaining({ field: 'rounds' }),
    ]);
    expect(validateTriviaConfig({ ...base, rounds: 3.5 })).toEqual([
      expect.objectContaining({ field: 'rounds' }),
    ]);
  });

  it('rejects a difficulty bound outside 1-10 (either bound, either direction)', () => {
    expect(validateTriviaConfig({ ...base, difficultyMin: 0 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
    expect(validateTriviaConfig({ ...base, difficultyMax: 11 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
    // A max below the floor is out-of-range, not merely an inverted range - the mirror must catch it
    // the same way the engine authority does.
    expect(validateTriviaConfig({ ...base, difficultyMin: 4, difficultyMax: 0 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
  });

  it('rejects an inverted range (min above max)', () => {
    expect(validateTriviaConfig({ ...base, difficultyMin: 7, difficultyMax: 4 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
  });

  it('rejects an unknown category', () => {
    expect(validateTriviaConfig({ ...base, category: 'Sports' })).toEqual([
      expect.objectContaining({ field: 'category' }),
    ]);
  });

  it('reports every failure at once', () => {
    const errors = validateTriviaConfig({
      category: 'Sports',
      rounds: 0,
      difficultyMin: 1,
      difficultyMax: 99,
    });
    expect(errors.map((error) => error.field).sort()).toEqual(['category', 'difficulty', 'rounds']);
  });
});

describe('difficultyBand', () => {
  it('maps a 1-10 rating to Easy/Medium/Hard bands', () => {
    expect([1, 2, 3].map(difficultyBand)).toEqual(['Easy', 'Easy', 'Easy']);
    expect([4, 5, 6, 7].map(difficultyBand)).toEqual(['Medium', 'Medium', 'Medium', 'Medium']);
    expect([8, 9, 10].map(difficultyBand)).toEqual(['Hard', 'Hard', 'Hard']);
  });
});
