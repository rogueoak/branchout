// Same Branch host configuration and its validator. The host picks 1-3 spectrum categories (or
// `random` across all), a round count, and a scoring mode: `free` (every player scores their own
// closeness, most points wins) or `coop` (the whole grove pools every guess into one shared score
// chasing a high total). `validateConfig` is the plugin manifest's config schema: the engine runs it
// at the `/sessions` handoff boundary, so a bad config is a 400, not a broken game.

import { CATEGORIES } from './spectrums';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 5;
export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = 3;

/** The sentinel that draws spectrums across every category. */
export const RANDOM = 'random';

/** The two scoring shapes. `free`: individual closeness scores, most points wins. `coop`: one shared
 * grove score, every guess pools into a single total the group chases. */
export const MODES = ['free', 'coop'] as const;
export type SameBranchMode = (typeof MODES)[number];
export const DEFAULT_MODE: SameBranchMode = 'free';

/** Host-supplied configuration, before validation/defaulting. */
export interface SameBranchConfig {
  /** `'random'`, or an array of 1-3 distinct category slugs. */
  categories?: string[] | 'random';
  /** 1-100, default 5. */
  rounds?: number;
  /** `free` (default) or `coop`. */
  mode?: SameBranchMode;
}

/** A validated, defaulted configuration. */
export interface ResolvedSameBranchConfig {
  categories: string[] | 'random';
  rounds: number;
  mode: SameBranchMode;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedSameBranchConfig {
  const cfg = (config ?? {}) as SameBranchConfig;
  const known = new Set<string>(CATEGORIES);

  let categories: string[] | 'random';
  if (cfg.categories === undefined || cfg.categories === RANDOM) {
    // An absent selection defaults to the whole bank (every category), so a bare `{}` config is
    // valid and plays across all spectrums.
    categories = RANDOM;
  } else if (Array.isArray(cfg.categories)) {
    const chosen = cfg.categories;
    if (chosen.length < MIN_CATEGORIES || chosen.length > MAX_CATEGORIES) {
      throw new Error(
        `same-branch categories must be '${RANDOM}' or an array of ${MIN_CATEGORIES}-${MAX_CATEGORIES} ` +
          `categories, got ${chosen.length}`,
      );
    }
    if (new Set(chosen).size !== chosen.length) {
      throw new Error(`same-branch categories must be distinct, got ${JSON.stringify(chosen)}`);
    }
    for (const category of chosen) {
      if (typeof category !== 'string' || !known.has(category)) {
        throw new Error(
          `same-branch category ${JSON.stringify(category)} is unknown; expected one of ` +
            CATEGORIES.join(', '),
        );
      }
    }
    categories = [...chosen];
  } else {
    throw new Error(
      `same-branch categories must be '${RANDOM}' or an array of ${MIN_CATEGORIES}-${MAX_CATEGORIES} of ` +
        `${CATEGORIES.join(', ')}, got ${JSON.stringify(cfg.categories)}`,
    );
  }

  const rounds = cfg.rounds ?? DEFAULT_ROUNDS;
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(
      `same-branch rounds must be an integer ${MIN_ROUNDS}-${MAX_ROUNDS}, got ${JSON.stringify(rounds)}`,
    );
  }

  const mode = cfg.mode ?? DEFAULT_MODE;
  if (mode !== 'free' && mode !== 'coop') {
    throw new Error(`same-branch mode must be 'free' or 'coop', got ${JSON.stringify(mode)}`);
  }

  return { categories, rounds, mode };
}
