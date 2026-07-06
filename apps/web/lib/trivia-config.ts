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
export const DEFAULT_DIFFICULTY = 5;

/** A host's Trivia choices, before validation. */
export interface TriviaHostConfig {
  category: string;
  rounds: number;
  difficulty: number;
}

/** The defaulted config a fresh lobby starts from. */
export function defaultTriviaConfig(): TriviaHostConfig {
  return { category: RANDOM_CATEGORY, rounds: DEFAULT_ROUNDS, difficulty: DEFAULT_DIFFICULTY };
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

  if (
    !Number.isInteger(config.difficulty) ||
    config.difficulty < MIN_DIFFICULTY ||
    config.difficulty > MAX_DIFFICULTY
  ) {
    errors.push({
      field: 'difficulty',
      message: `Difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}.`,
    });
  }

  return errors;
}
