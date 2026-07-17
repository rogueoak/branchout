// Odd Bird's host config model + validation for the game-pluggable lobby (spec 0023). Mirrors the
// engine plugin's validateConfig so the host cannot start an invalid game; the engine re-checks at the
// /sessions boundary. The config is the opaque blob the control-plane passes through to the engine
// unchanged. Odd Bird is one location game per session, so the only choice is the roost categories.

/** The five roost categories a host may choose from (1+, or `random` across all). */
export const CATEGORIES = ['everyday', 'outdoors', 'travel', 'events', 'fantastical'] as const;

export type OddBirdCategory = (typeof CATEGORIES)[number];

export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = CATEGORIES.length;

/** The host's Odd Bird setup: a category selection (1+, or `random`). */
export interface OddBirdHostConfig {
  categories: string[] | 'random';
}

export function defaultOddBirdConfig(): OddBirdHostConfig {
  return { categories: 'random' };
}

export interface ConfigError {
  field: 'categories';
  message: string;
}

/** True when the config picks specific categories (not the `random` sentinel). */
export function isCategoryList(categories: string[] | 'random'): categories is string[] {
  return Array.isArray(categories);
}

/**
 * Validate a host config against the same rules the engine enforces: `categories` is `random` or an
 * array of 1+ distinct known categories. Returns every error so the panel can surface the right
 * field; an empty array means valid.
 */
export function validateOddBirdConfig(config: OddBirdHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (config.categories !== 'random') {
    const list = config.categories;
    if (!Array.isArray(list) || list.length < MIN_CATEGORIES) {
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
