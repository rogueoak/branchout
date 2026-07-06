import { describe, expect, it } from 'vitest';
import {
  CONFIGURABLE_CATEGORIES,
  DEFAULT_DIFFICULTY,
  DEFAULT_ROUNDS,
  RANDOM_CATEGORY,
  defaultTriviaConfig,
  validateTriviaConfig,
  type TriviaHostConfig,
} from './trivia-config';

const base: TriviaHostConfig = {
  category: RANDOM_CATEGORY,
  rounds: DEFAULT_ROUNDS,
  difficulty: DEFAULT_DIFFICULTY,
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
  it('accepts the defaults (Random, 10 rounds, difficulty 5)', () => {
    expect(defaultTriviaConfig()).toEqual({
      category: 'Random',
      rounds: 10,
      difficulty: 5,
    });
    expect(validateTriviaConfig(base)).toEqual([]);
  });

  it('accepts the range boundaries', () => {
    expect(validateTriviaConfig({ ...base, rounds: 1, difficulty: 1 })).toEqual([]);
    expect(validateTriviaConfig({ ...base, rounds: 100, difficulty: 10 })).toEqual([]);
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

  it('rejects difficulty below 1 and above 10', () => {
    expect(validateTriviaConfig({ ...base, difficulty: 0 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
    expect(validateTriviaConfig({ ...base, difficulty: 11 })).toEqual([
      expect.objectContaining({ field: 'difficulty' }),
    ]);
  });

  it('rejects an unknown category', () => {
    expect(validateTriviaConfig({ ...base, category: 'Sports' })).toEqual([
      expect.objectContaining({ field: 'category' }),
    ]);
  });

  it('reports every failure at once', () => {
    const errors = validateTriviaConfig({ category: 'Sports', rounds: 0, difficulty: 99 });
    expect(errors.map((error) => error.field).sort()).toEqual(['category', 'difficulty', 'rounds']);
  });
});
