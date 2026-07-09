// Host-facing Trivia configuration for the lobby, mirroring the engine's rules (spec 0008,
// apps/game-engine/src/games/trivia/trivia.ts). The engine re-validates every config on the start
// handoff and owns the authority; this mirror lets the lobby show a valid form and a plain reason
// before a doomed round trip. Keep the ranges and category list in step with the engine.

/** The eight question categories plus the special `Random` pool - what a host may pick. */
export const CATEGORIES: readonly string[] = [
  'Nature',
  'Food',
  'Animals',
  'Science',
  'People',
  'Places',
  'Things',
  'History',
];

/** The extra pick that spans every category. Matches the engine's `RANDOM_CATEGORY`. */
export const RANDOM_CATEGORY = 'Random';

/** The full set of choices a host may configure: the eight categories plus `Random`. */
export const CONFIGURABLE_CATEGORIES: readonly string[] = [...CATEGORIES, RANDOM_CATEGORY];

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY_MIN = 4;
export const DEFAULT_DIFFICULTY_MAX = 6;

/**
 * A human word for a 1-10 rating, so a non-technical host and player can picture what a number means
 * (the default 4-6 reads as "Medium"). Display only; the engine works in numbers.
 */
export function difficultyBand(rating: number): 'Easy' | 'Medium' | 'Hard' {
  if (rating <= 3) return 'Easy';
  if (rating <= 7) return 'Medium';
  return 'Hard';
}

/** A host's Trivia choices, before validation. */
export interface TriviaHostConfig {
  category: string;
  rounds: number;
  /** Difficulty range floor, 1-10. Questions rated in [difficultyMin, difficultyMax] are drawn. */
  difficultyMin: number;
  /** Difficulty range ceiling, 1-10. Must be >= difficultyMin. */
  difficultyMax: number;
}

/** The defaulted config a fresh lobby starts from. */
export function defaultTriviaConfig(): TriviaHostConfig {
  return {
    category: RANDOM_CATEGORY,
    rounds: DEFAULT_ROUNDS,
    difficultyMin: DEFAULT_DIFFICULTY_MIN,
    difficultyMax: DEFAULT_DIFFICULTY_MAX,
  };
}

/** One validation failure, keyed by the field so the form can anchor the message. */
export interface ConfigError {
  field: 'category' | 'rounds' | 'difficulty';
  message: string;
}

/**
 * Validate a host config against the engine's ranges. Returns every failure so the form can show
 * them all at once rather than one at a time. An empty array means the config is startable (the
 * engine still re-checks question-pool depth on the handoff, which the UI cannot know).
 */
export function validateTriviaConfig(config: TriviaHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (!CONFIGURABLE_CATEGORIES.includes(config.category)) {
    errors.push({ field: 'category', message: 'Pick a category or Random.' });
  }

  if (
    !Number.isInteger(config.rounds) ||
    config.rounds < MIN_ROUNDS ||
    config.rounds > MAX_ROUNDS
  ) {
    errors.push({
      field: 'rounds',
      message: `Rounds must be a whole number from ${MIN_ROUNDS} to ${MAX_ROUNDS}.`,
    });
  }

  // Mirror the engine authority exactly: both bounds must sit fully inside [MIN, MAX]. Checking only
  // min-from-below and max-from-above would let the mirror accept a payload the engine rejects.
  const inRange = (v: number) => Number.isInteger(v) && v >= MIN_DIFFICULTY && v <= MAX_DIFFICULTY;
  const boundsOk = inRange(config.difficultyMin) && inRange(config.difficultyMax);
  if (!boundsOk) {
    errors.push({
      field: 'difficulty',
      message: `Difficulty must be whole numbers from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}.`,
    });
  } else if (config.difficultyMin > config.difficultyMax) {
    errors.push({
      field: 'difficulty',
      message: 'Difficulty minimum cannot be above the maximum.',
    });
  }

  return errors;
}
