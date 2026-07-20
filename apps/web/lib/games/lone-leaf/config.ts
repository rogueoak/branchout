// Lone Leaf's host config model + validation for the game-pluggable lobby (spec 0057). Mirrors the
// engine plugin's validateConfig so the host cannot start an invalid game; the engine re-checks at the
// /sessions boundary. The config is the opaque blob the control-plane passes through to the engine.
// Keep the ranges, defaults, and pacing fields in step with packages/games/lone-leaf/src/config.ts.

/** The seed categories a host may choose from (1-3, or `random` across all). */
export const CATEGORIES = ['nature', 'everyday', 'places', 'food', 'animals', 'feelings'] as const;

export type LoneLeafCategory = (typeof CATEGORIES)[number];

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;
/** At most three categories may be chosen (or `random` for all). */
export const MAX_CATEGORIES = 3;

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
    autoAdvance: DEFAULT_AUTO_ADVANCE,
    advanceAfterSeconds: DEFAULT_ADVANCE_AFTER_SECONDS,
    clueSeconds: DEFAULT_CLUE_SECONDS,
    guessSeconds: DEFAULT_GUESS_SECONDS,
  };
}

export interface ConfigError {
  field: 'categories' | 'rounds' | 'advanceAfter' | 'clue' | 'guess';
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

  if (
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
