// Odd Bird host configuration and its validator. Odd Bird is one location game per session (a single
// long round), so the only host choice is which roost categories to draw from: `random` across all,
// or a list of 1+ distinct known categories. `validateConfig` is the plugin manifest's config schema:
// the engine runs it at the `/sessions` handoff boundary, so a bad config is a 400, not a broken game.

import { CATEGORIES } from './roosts';

export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = CATEGORIES.length;

/** The sentinel that draws roosts across every category. */
export const RANDOM = 'random';

/** Host-supplied configuration, before validation/defaulting. */
export interface OddBirdConfig {
  /** `'random'`, or an array of 1+ distinct category slugs. */
  categories?: string[] | 'random';
}

/** A validated, defaulted configuration. */
export interface ResolvedOddBirdConfig {
  categories: string[] | 'random';
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedOddBirdConfig {
  const cfg = (config ?? {}) as OddBirdConfig;
  const known = new Set<string>(CATEGORIES);

  let categories: string[] | 'random';
  if (cfg.categories === undefined || cfg.categories === RANDOM) {
    categories = RANDOM;
  } else if (Array.isArray(cfg.categories)) {
    const chosen = cfg.categories;
    if (chosen.length < MIN_CATEGORIES || chosen.length > MAX_CATEGORIES) {
      throw new Error(
        `odd-bird categories must be '${RANDOM}' or an array of ${MIN_CATEGORIES}-${MAX_CATEGORIES} ` +
          `categories, got ${chosen.length}`,
      );
    }
    if (new Set(chosen).size !== chosen.length) {
      throw new Error(`odd-bird categories must be distinct, got ${JSON.stringify(chosen)}`);
    }
    for (const category of chosen) {
      if (typeof category !== 'string' || !known.has(category)) {
        throw new Error(
          `odd-bird category ${JSON.stringify(category)} is unknown; expected one of ` +
            CATEGORIES.join(', '),
        );
      }
    }
    categories = [...chosen];
  } else {
    throw new Error(
      `odd-bird categories must be '${RANDOM}' or an array of ${MIN_CATEGORIES}-${MAX_CATEGORIES} of ` +
        `${CATEGORIES.join(', ')}, got ${JSON.stringify(cfg.categories)}`,
    );
  }

  return { categories };
}
