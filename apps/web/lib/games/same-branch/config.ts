// Same Branch host config model + validation for the game-pluggable lobby (spec 0023). Mirrors the
// engine plugin's validateConfig so the host cannot start an invalid game; the engine re-checks at the
// /sessions boundary. The config is the opaque blob the control-plane passes through unchanged.

/** The six spectrum categories a host may choose from (1-3, or `random` across all). */
export const CATEGORIES = ['senses', 'feelings', 'everyday', 'nature', 'people', 'wild'] as const;

export type SameBranchCategory = (typeof CATEGORIES)[number];

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 5;
/** At most three categories may be chosen (or `random` for all). */
export const MAX_CATEGORIES = 3;

/** The two scoring shapes: individual closeness scores, or one shared grove score. */
export const MODES = ['free', 'coop'] as const;
export type SameBranchMode = (typeof MODES)[number];

/** Friendly labels for each category chip. */
export const CATEGORY_LABELS: Record<SameBranchCategory, string> = {
  senses: 'Senses',
  feelings: 'Feelings',
  everyday: 'Everyday',
  nature: 'Nature',
  people: 'People',
  wild: 'Wild',
};

/** The host's Same Branch setup: a category selection (1-3, or `random`), rounds, and a mode. */
export interface SameBranchHostConfig {
  categories: string[] | 'random';
  rounds: number;
  mode: SameBranchMode;
}

export function defaultSameBranchConfig(): SameBranchHostConfig {
  return { categories: 'random', rounds: DEFAULT_ROUNDS, mode: 'free' };
}

export interface ConfigError {
  field: 'categories' | 'rounds' | 'mode';
  message: string;
}

/** True when the config picks specific categories (not the `random` sentinel). */
export function isCategoryList(categories: string[] | 'random'): categories is string[] {
  return Array.isArray(categories);
}

/**
 * Validate a host config against the same rules the engine enforces: `categories` is `random` or an
 * array of 1-3 distinct known categories; `rounds` is an integer in [1, 100]; `mode` is free or coop.
 * Returns every error so the panel can surface the right field; an empty array means valid.
 */
export function validateSameBranchConfig(config: SameBranchHostConfig): ConfigError[] {
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

  if (config.mode !== 'free' && config.mode !== 'coop') {
    errors.push({ field: 'mode', message: 'Mode must be Free-for-all or Co-op.' });
  }

  return errors;
}
