// Liar Liar's host config model + validation for the game-pluggable lobby (spec 0023). Mirrors the
// engine plugin's validateConfig (spec 0021) so the host cannot start an invalid game; the engine
// re-checks at the /sessions boundary. The config is the opaque blob the control-plane passes through
// to the engine unchanged.

/** The eight clue categories a host may choose from (1-3, or `random` across all). */
export const CATEGORIES = [
  'people',
  'places',
  'events',
  'sports',
  'food',
  'nature',
  'animals',
  'things',
] as const;

export type LiarLiarCategory = (typeof CATEGORIES)[number];

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;
/** At most three categories may be chosen (or `random` for all). */
export const MAX_CATEGORIES = 3;

/** The host's Liar Liar setup: a category selection (1-3, or `random`) and a round count. */
export interface LiarLiarHostConfig {
  categories: string[] | 'random';
  rounds: number;
}

export function defaultLiarLiarConfig(): LiarLiarHostConfig {
  return { categories: 'random', rounds: DEFAULT_ROUNDS };
}

export interface ConfigError {
  field: 'categories' | 'rounds';
  message: string;
}

/** True when the config picks specific categories (not the `random` sentinel). */
export function isCategoryList(categories: string[] | 'random'): categories is string[] {
  return Array.isArray(categories);
}

/**
 * Validate a host config against the same rules the engine enforces: `categories` is `random` or an
 * array of 1-3 distinct known categories; `rounds` is an integer in [1, 100]. Returns every error so
 * the panel can surface the right field; an empty array means valid.
 */
export function validateLiarLiarConfig(config: LiarLiarHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (
    !Number.isInteger(config.rounds) ||
    config.rounds < MIN_ROUNDS ||
    config.rounds > MAX_ROUNDS
  ) {
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

  return errors;
}
