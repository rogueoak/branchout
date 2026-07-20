// Lone Leaf host configuration and its validator (spec 0057). The host picks 1-3 categories (or
// `random` across all) and a round count - each round draws one seed and rotates the Seeker.
// `validateConfig` is the plugin manifest's config schema: the engine runs it at the `/sessions`
// handoff boundary, so a bad config is a 400, not a broken game.

import { CATEGORIES } from './seeds';

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;
export const MIN_CATEGORIES = 1;
export const MAX_CATEGORIES = 3;

/** Auto-advance defaults (spec 0057 pacing): on, with a 5s dwell for each hop. */
export const DEFAULT_AUTO_ADVANCE = true;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;

/** Clue window (leaf-writing/move) defaults and bounds in seconds. */
export const DEFAULT_CLUE_SECONDS = 60;
/** Guess window (the Seeker's decision) defaults and bounds in seconds. */
export const DEFAULT_GUESS_SECONDS = 60;
export const MIN_ROUND_SECONDS = 15;
export const MAX_ROUND_SECONDS = 180;

/** The sentinel that draws seeds across every category. */
export const RANDOM = 'random';

/** Host-supplied configuration, before validation/defaulting. All pacing fields optional. */
export interface LoneLeafConfig {
  /** `'random'`, or an array of 1-3 distinct category slugs. */
  categories?: string[] | 'random';
  /** 1-100, default 10. */
  rounds?: number;
  /** Auto-advance the reveal/leaderboard on to the next round. Default true. */
  autoAdvance?: boolean;
  /** Dwell before each auto-advance hop, in seconds. Default 5, range 1-60. */
  advanceAfterSeconds?: number;
  /** The leaf-writing (move) window, in seconds. Default 60, range 15-180. */
  clueSeconds?: number;
  /** The Seeker's guess window, in seconds. Default 60, range 15-180. */
  guessSeconds?: number;
}

/** A validated, defaulted configuration. Durations are resolved to milliseconds for the engine. */
export interface ResolvedLoneLeafConfig {
  categories: string[] | 'random';
  rounds: number;
  autoAdvance: boolean;
  /** Resolved dwell in ms (`advanceAfterSeconds * 1000`). */
  advanceAfterMs: number;
  /** Resolved leaf-writing window in ms (`clueSeconds * 1000`). */
  clueMs: number;
  /** Resolved guess window in ms (`guessSeconds * 1000`). */
  guessMs: number;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
function resolveIntInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== 'number' ||
    !Number.isInteger(resolved) ||
    resolved < min ||
    resolved > max
  ) {
    throw new Error(
      `lone-leaf ${label} must be an integer ${min}-${max}, got ${JSON.stringify(value)}`,
    );
  }
  return resolved;
}

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

  const rounds = resolveIntInRange(cfg.rounds, DEFAULT_ROUNDS, MIN_ROUNDS, MAX_ROUNDS, 'rounds');

  const autoAdvance = cfg.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  if (typeof autoAdvance !== 'boolean') {
    throw new Error(
      `lone-leaf autoAdvance must be a boolean, got ${JSON.stringify(cfg.autoAdvance)}`,
    );
  }

  const advanceAfterSeconds = resolveIntInRange(
    cfg.advanceAfterSeconds,
    DEFAULT_ADVANCE_AFTER_SECONDS,
    MIN_ADVANCE_AFTER_SECONDS,
    MAX_ADVANCE_AFTER_SECONDS,
    'advanceAfterSeconds',
  );
  const clueSeconds = resolveIntInRange(
    cfg.clueSeconds,
    DEFAULT_CLUE_SECONDS,
    MIN_ROUND_SECONDS,
    MAX_ROUND_SECONDS,
    'clueSeconds',
  );
  const guessSeconds = resolveIntInRange(
    cfg.guessSeconds,
    DEFAULT_GUESS_SECONDS,
    MIN_ROUND_SECONDS,
    MAX_ROUND_SECONDS,
    'guessSeconds',
  );

  return {
    categories,
    rounds,
    autoAdvance,
    advanceAfterMs: advanceAfterSeconds * 1000,
    clueMs: clueSeconds * 1000,
    guessMs: guessSeconds * 1000,
  };
}
