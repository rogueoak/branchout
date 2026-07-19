// Host-facing Trivia configuration for the lobby, mirroring the engine's rules (spec 0008, spec
// 0068, packages/games/trivia/src/trivia.ts). The engine re-validates every config on the start
// handoff and owns the authority; this mirror lets the lobby show a valid form and a plain reason
// before a doomed round trip. Keep the ranges, category list, and defaults in step with the engine.

/** The eight question categories a host may pick a subset of. Matches the engine's `CATEGORIES`. */
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

/** The label for the "all categories" choice. On the wire it is the EMPTY `categories` list. */
export const RANDOM_CATEGORY = 'Random';

/** The full set of choices a host may configure: the eight categories plus `Random`. */
export const CONFIGURABLE_CATEGORIES: readonly string[] = [...CATEGORIES, RANDOM_CATEGORY];

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY_MIN = 3;
export const DEFAULT_DIFFICULTY_MAX = 6;

/** Auto-advance pacing (spec 0068), in seconds where noted. */
export const DEFAULT_AUTO_ADVANCE = true;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;
export const MIN_TIME_LIMIT_SECONDS = 10;
export const MAX_TIME_LIMIT_SECONDS = 180;
export const DEFAULT_TIME_LIMIT_SECONDS = 60;

/** One rounds preset. `Custom` is handled in the UI (a number field), not listed here. */
export interface RoundPreset {
  value: number;
  label: string;
  description: string;
}

/** Rounds presets (spec 0068): Fast / Medium / Long, plus a Custom number field in the UI. */
export const ROUND_PRESETS: readonly RoundPreset[] = [
  { value: 10, label: 'Fast', description: 'A quick game - 10 rounds.' },
  { value: 20, label: 'Medium', description: 'A standard game - 20 rounds.' },
  { value: 40, label: 'Long', description: 'A marathon - 40 rounds.' },
];

/** One difficulty preset: a label + a plain description, mapping to a hidden 1-10 band. */
export interface DifficultyPreset {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
}

/**
 * Difficulty presets (spec 0068). The label + description are shown; the numeric 1-10 band is NEVER
 * exposed in the UI. `Medium` (3-6) is the default. A band matching no preset shows as `Custom`.
 */
export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  {
    id: 'easy',
    label: 'Easy',
    description: 'Everyday knowledge - a gentle warm-up.',
    min: 1,
    max: 4,
  },
  { id: 'medium', label: 'Medium', description: 'A balanced mix - the default.', min: 3, max: 6 },
  {
    id: 'moderate',
    label: 'Moderate',
    description: 'Tougher questions for a real test.',
    min: 4,
    max: 8,
  },
  {
    id: 'hard',
    label: 'Hard',
    description: 'Expert territory - for trivia buffs.',
    min: 6,
    max: 10,
  },
];

/** The preset id a difficulty band maps to, or `custom` when it matches none. */
export function difficultyPresetId(min: number, max: number): string {
  return (
    DIFFICULTY_PRESETS.find((preset) => preset.min === min && preset.max === max)?.id ?? 'custom'
  );
}

/**
 * A human word for a single question's 1-10 rating, shown as a badge on the in-game prompt (the
 * Viewer/Remote) so a player can picture what a number means. Display only; distinct from the host's
 * difficulty PRESETS above, and never used to expose the raw range in the setup form.
 */
export function difficultyBand(rating: number): 'Easy' | 'Medium' | 'Hard' {
  if (rating <= 3) return 'Easy';
  if (rating <= 7) return 'Medium';
  return 'Hard';
}

/** A host's Trivia choices, before validation. */
export interface TriviaHostConfig {
  /** The category subset. An EMPTY list means Random (all categories). */
  categories: string[];
  rounds: number;
  /** Difficulty range floor, 1-10. Questions rated in [difficultyMin, difficultyMax] are drawn. */
  difficultyMin: number;
  /** Difficulty range ceiling, 1-10. Must be >= difficultyMin. */
  difficultyMax: number;
  /** Auto-advance the answer screen -> leaderboard -> next round. */
  autoAdvance: boolean;
  /** Dwell before each auto-advance hop, in seconds (1-60). */
  advanceAfterSeconds: number;
  /** Answer window, in seconds (10-180). Maps to the engine move window. */
  timeLimitSeconds: number;
}

/** The defaulted config a fresh lobby starts from: Random, Fast, Medium, auto-advance on at 5s, 60s. */
export function defaultTriviaConfig(): TriviaHostConfig {
  return {
    categories: [],
    rounds: DEFAULT_ROUNDS,
    difficultyMin: DEFAULT_DIFFICULTY_MIN,
    difficultyMax: DEFAULT_DIFFICULTY_MAX,
    autoAdvance: DEFAULT_AUTO_ADVANCE,
    advanceAfterSeconds: DEFAULT_ADVANCE_AFTER_SECONDS,
    timeLimitSeconds: DEFAULT_TIME_LIMIT_SECONDS,
  };
}

/** One validation failure, keyed by the field so the form can anchor the message. */
export interface ConfigError {
  field: 'categories' | 'rounds' | 'difficulty' | 'advanceAfter' | 'timeLimit';
  message: string;
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validate a host config against the engine's ranges. Returns every failure so the form can show
 * them all at once rather than one at a time. An empty array means the config is startable (the
 * engine still re-checks question-pool depth on the handoff, which the UI cannot know).
 */
export function validateTriviaConfig(config: TriviaHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  // An empty selection is Random (all categories) and always valid; a non-empty one must name only
  // real categories.
  if (
    !Array.isArray(config.categories) ||
    config.categories.some((category) => !CATEGORIES.includes(category))
  ) {
    errors.push({ field: 'categories', message: 'Pick Random or one or more categories.' });
  }

  if (!isIntInRange(config.rounds, MIN_ROUNDS, MAX_ROUNDS)) {
    errors.push({
      field: 'rounds',
      message: `Rounds must be a whole number from ${MIN_ROUNDS} to ${MAX_ROUNDS}.`,
    });
  }

  // Mirror the engine authority exactly: both bounds must sit fully inside [MIN, MAX]. Checking only
  // min-from-below and max-from-above would let the mirror accept a payload the engine rejects.
  const boundsOk =
    isIntInRange(config.difficultyMin, MIN_DIFFICULTY, MAX_DIFFICULTY) &&
    isIntInRange(config.difficultyMax, MIN_DIFFICULTY, MAX_DIFFICULTY);
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

  if (
    !isIntInRange(config.advanceAfterSeconds, MIN_ADVANCE_AFTER_SECONDS, MAX_ADVANCE_AFTER_SECONDS)
  ) {
    errors.push({
      field: 'advanceAfter',
      message: `Advance after must be from ${MIN_ADVANCE_AFTER_SECONDS} to ${MAX_ADVANCE_AFTER_SECONDS} seconds.`,
    });
  }

  if (!isIntInRange(config.timeLimitSeconds, MIN_TIME_LIMIT_SECONDS, MAX_TIME_LIMIT_SECONDS)) {
    errors.push({
      field: 'timeLimit',
      message: `Time limit must be from ${MIN_TIME_LIMIT_SECONDS} to ${MAX_TIME_LIMIT_SECONDS} seconds.`,
    });
  }

  return errors;
}
