// Lone Leaf host configuration and its validator (spec 0057). The host picks 1-3 categories (or
// `random` across all) and a round count - each round draws one seed and rotates the Seeker.
// `validateConfig` is the plugin manifest's config schema: the engine runs it at the `/sessions`
// handoff boundary, so a bad config is a 400, not a broken game.

import { CATEGORIES } from './seeds';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 5;
export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = 3;

/** The sentinel that draws seeds across every category. */
export const RANDOM = 'random';

/** Host-supplied configuration, before validation/defaulting. */
export interface LoneLeafConfig {
  /** `'random'`, or an array of 1-3 distinct category slugs. */
  categories?: string[] | 'random';
  /** 1-100, default 5. */
  rounds?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedLoneLeafConfig {
  categories: string[] | 'random';
  rounds: number;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedLoneLeafConfig {
  const cfg = (config ?? {}) as LoneLeafConfig;
  const known = new Set<string>(CATEGORIES);

  let categories: string[] | 'random';
  if (cfg.categories === RANDOM) {
    categories = RANDOM;
  } else if (Array.isArray(cfg.categories)) {
    const chosen = cfg.categories;
    if (chosen.length < MIN_CATEGORIES || chosen.length > MAX_CATEGORIES) {
      throw new Error(
        `lone-leaf categories must be '${RANDOM}' or an array of ${MIN_CATEGORIES}-${MAX_CATEGORIES} ` +
          `categories, got ${chosen.length}`,
      );
    }
    if (new Set(chosen).size !== chosen.length) {
      throw new Error(`lone-leaf categories must be distinct, got ${JSON.stringify(chosen)}`);
    }
    for (const category of chosen) {
      if (typeof category !== 'string' || !known.has(category)) {
        throw new Error(
          `lone-leaf category ${JSON.stringify(category)} is unknown; expected one of ` +
            CATEGORIES.join(', '),
        );
      }
    }
    categories = [...chosen];
  } else {
    throw new Error(
      `lone-leaf categories must be '${RANDOM}' or an array of ${MIN_CATEGORIES}-${MAX_CATEGORIES} of ` +
        `${CATEGORIES.join(', ')}, got ${JSON.stringify(cfg.categories)}`,
    );
  }

  const rounds = cfg.rounds ?? DEFAULT_ROUNDS;
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(
      `lone-leaf rounds must be an integer ${MIN_ROUNDS}-${MAX_ROUNDS}, got ${JSON.stringify(rounds)}`,
    );
  }

  return { categories, rounds };
}
