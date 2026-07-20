// Lone Leaf's host config model + validation for the game-pluggable lobby (spec 0057). Mirrors the
// engine plugin's validateConfig so the host cannot start an invalid game; the engine re-checks at the
// /sessions boundary. The config is the opaque blob the control-plane passes through to the engine.
// Keep the ranges, defaults, and pacing fields in step with packages/games/lone-leaf/src/config.ts.

/** The seed categories a host may choose from (1-3, or `random` across all). Mirrors the engine. */
export const CATEGORIES = [
  'nature',
  'everyday',
  'places',
  'food',
  'animals',
  'feelings',
  'celebrities',
  'movies',
  'historical',
] as const;

export type LoneLeafCategory = (typeof CATEGORIES)[number];

/**
 * Display labels for the lobby + in-round badges. Most slugs title-case cleanly, so only the ones
 * whose friendly name differs from the capitalized slug are listed; {@link categoryLabel} falls back
 * to title-case for the rest. Keep the keys in step with {@link CATEGORIES}.
 */
export const CATEGORY_LABELS: Partial<Record<string, string>> = {
  celebrities: 'Famous People',
  historical: 'Historical Figures',
};

/** The display label for a category slug: an explicit {@link CATEGORY_LABELS} entry, or title-case. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;
/** At most three categories may be chosen (or `random` for all). */
export const MAX_CATEGORIES = 3;

/** Difficulty (obscurity) band, reusing Trivia's 1-10 scale and its default `Medium` band (3-6). */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY_MIN = 3;
export const DEFAULT_DIFFICULTY_MAX = 6;

/** One difficulty preset: a label + a plain description mapping to a hidden 1-10 obscurity band. */
export interface DifficultyPreset {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
}

/**
 * Difficulty presets, mirroring Trivia's (spec 0068). The label + description are shown; the numeric
 * 1-10 band is NEVER exposed in the UI. `Medium` (3-6) is the default. A band matching no preset shows
 * as `Custom`.
 */
export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  { id: 'easy', label: 'Easy', description: 'Everyday words - a gentle warm-up.', min: 1, max: 4 },
  { id: 'medium', label: 'Medium', description: 'A balanced mix - the default.', min: 3, max: 6 },
  {
    id: 'moderate',
    label: 'Moderate',
    description: 'Trickier words for a real test.',
    min: 4,
    max: 8,
  },
  { id: 'hard', label: 'Hard', description: 'Obscure words - for word buffs.', min: 6, max: 10 },
];

/** The preset id a difficulty band maps to, or `custom` when it matches none. */
export function difficultyPresetId(min: number, max: number): string {
  return (
    DIFFICULTY_PRESETS.find((preset) => preset.min === min && preset.max === max)?.id ?? 'custom'
  );
}

/** Auto-advance pacing (spec 0057), in seconds where noted. */
export const DEFAULT_AUTO_ADVANCE = true;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;

/** Round-duration bounds and defaults (seconds): the clue (leaf) window and the guess window. */
export const MIN_ROUND_SECONDS = 15;
export const MAX_ROUND_SECONDS = 180;
export const DEFAULT_CLUE_SECONDS = 60;
export const DEFAULT_GUESS_SECONDS = 60;

/** One rounds preset. `Custom` is handled in the UI (a number field), not listed here. */
export interface RoundPreset {
  value: number;
  label: string;
  description: string;
}

/** Rounds presets (spec 0057): Fast / Standard / Long / Marathon, plus a Custom number field in the UI. */
export const ROUND_PRESETS: readonly RoundPreset[] = [
  { value: 5, label: 'Fast', description: 'A quick game - 5 rounds.' },
  { value: 10, label: 'Standard', description: 'A standard game - 10 rounds.' },
  { value: 20, label: 'Long', description: 'A longer game - 20 rounds.' },
  { value: 40, label: 'Marathon', description: 'A marathon - 40 rounds.' },
];

/** The host's Lone Leaf setup: categories, a round count, and pacing (auto-advance + round windows). */
export interface LoneLeafHostConfig {
  categories: string[] | 'random';
  rounds: number;
  /** Difficulty band floor, 1-10. Seeds rated in [difficultyMin, difficultyMax] are drawn. */
  difficultyMin: number;
  /** Difficulty band ceiling, 1-10. Must be >= difficultyMin. */
  difficultyMax: number;
  /** Auto-advance the reveal/leaderboard on to the next round. */
  autoAdvance: boolean;
  /** Dwell before each auto-advance hop, in seconds (1-60). */
  advanceAfterSeconds: number;
  /** The leaf-writing (clue) window, in seconds (15-180). Maps to the engine move window. */
  clueSeconds: number;
  /** The Seeker's guess window, in seconds (15-180). Maps to the engine decision window. */
  guessSeconds: number;
}

export function defaultLoneLeafConfig(): LoneLeafHostConfig {
  return {
    categories: 'random',
    rounds: DEFAULT_ROUNDS,
    difficultyMin: DEFAULT_DIFFICULTY_MIN,
    difficultyMax: DEFAULT_DIFFICULTY_MAX,
    autoAdvance: DEFAULT_AUTO_ADVANCE,
    advanceAfterSeconds: DEFAULT_ADVANCE_AFTER_SECONDS,
    clueSeconds: DEFAULT_CLUE_SECONDS,
    guessSeconds: DEFAULT_GUESS_SECONDS,
  };
}

export interface ConfigError {
  field: 'categories' | 'rounds' | 'difficulty' | 'advanceAfter' | 'clue' | 'guess';
  message: string;
}

/** True when the config picks specific categories (not the `random` sentinel). */
export function isCategoryList(categories: string[] | 'random'): categories is string[] {
  return Array.isArray(categories);
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validate a host config against the same rules the engine enforces: `categories` is `random` or an
 * array of 1-3 distinct known categories; `rounds` is an integer in [1, 100]; the pacing windows are
 * integers in their bounds. Returns every error so the panel can surface the right field; an empty
 * array means valid.
 */
export function validateLoneLeafConfig(config: LoneLeafHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (!isIntInRange(config.rounds, MIN_ROUNDS, MAX_ROUNDS)) {
    errors.push({
      field: 'rounds',
      message: `Rounds must be a whole number ${MIN_ROUNDS}-${MAX_ROUNDS}.`,
    });
  }

  // Mirror the engine authority exactly: both bounds inside [MIN, MAX] and min <= max.
  const difficultyBoundsOk =
    isIntInRange(config.difficultyMin, MIN_DIFFICULTY, MAX_DIFFICULTY) &&
    isIntInRange(config.difficultyMax, MIN_DIFFICULTY, MAX_DIFFICULTY);
  if (!difficultyBoundsOk) {
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

  if (config.categories !== 'random') {
    const list = config.categories;
    if (!Array.isArray(list) || list.length === 0) {
      errors.push({
        field: 'categories',
        message: 'Pick at least one category, or choose Random.',
      });
    } else if (list.length > MAX_CATEGORIES) {
      errors.push({ field: 'categories', message: `Pick at most ${MAX_CATEGORIES} categories.` });
    } else if (new Set(list).size !== list.length) {
      errors.push({ field: 'categories', message: 'Categories must be distinct.' });
    } else if (!list.every((c) => (CATEGORIES as readonly string[]).includes(c))) {
      errors.push({ field: 'categories', message: 'Unknown category selected.' });
    }
  }

  // The dwell only takes effect when auto-advance is on (the engine sends leaderboardWindowMs = 0
  // otherwise), so only validate it then - a stale/blank value on the disabled field must never gate
  // Start when it has no effect.
  if (
    config.autoAdvance &&
    !isIntInRange(config.advanceAfterSeconds, MIN_ADVANCE_AFTER_SECONDS, MAX_ADVANCE_AFTER_SECONDS)
  ) {
    errors.push({
      field: 'advanceAfter',
      message: `Advance after must be from ${MIN_ADVANCE_AFTER_SECONDS} to ${MAX_ADVANCE_AFTER_SECONDS} seconds.`,
    });
  }

  if (!isIntInRange(config.clueSeconds, MIN_ROUND_SECONDS, MAX_ROUND_SECONDS)) {
    errors.push({
      field: 'clue',
      message: `Clue time must be from ${MIN_ROUND_SECONDS} to ${MAX_ROUND_SECONDS} seconds.`,
    });
  }

  if (!isIntInRange(config.guessSeconds, MIN_ROUND_SECONDS, MAX_ROUND_SECONDS)) {
    errors.push({
      field: 'guess',
      message: `Guess time must be from ${MIN_ROUND_SECONDS} to ${MAX_ROUND_SECONDS} seconds.`,
    });
  }

  return errors;
}
