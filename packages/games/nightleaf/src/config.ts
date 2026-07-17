// Nightleaf host configuration and its validator (spec 0060). The host picks how many tiers the grove
// climbs (tier N deals N leaves to each player) and how many buds (lives) the group starts with.
// `validateConfig` is the plugin manifest's config schema: the engine runs it at the `/sessions`
// handoff boundary, so a bad config is a 400, not a broken game. The web mirrors these rules.

export const MIN_TIERS = 1;
export const MAX_TIERS = 12;
export const DEFAULT_TIERS = 4;
export const MIN_BUDS = 1;
export const MAX_BUDS = 5;
export const DEFAULT_BUDS = 3;
export const MIN_FIREFLIES = 0;
export const MAX_FIREFLIES = 5;
export const DEFAULT_FIREFLIES = 1;

/** The largest leaf value in the deck. Leaves are unique integers in [1, MAX_LEAF]. */
export const MAX_LEAF = 100;

/** Host-supplied configuration, before validation/defaulting. */
export interface NightleafConfig {
  /** How many tiers to climb; clearing the final tier wins. 1-12, default 4. */
  tiers?: number;
  /** Buds (lives) the group starts with. 1-5, default 3. */
  buds?: number;
  /** Fireflies (shared hushes) the group starts with. 0-5, default 1. */
  fireflies?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedNightleafConfig {
  tiers: number;
  buds: number;
  fireflies: number;
}

function checkInt(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`nightleaf ${field} must be an integer in [${min}, ${max}], got ${value}`);
  }
  return value;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedNightleafConfig {
  if (config != null && typeof config !== 'object') {
    throw new Error(`nightleaf config must be an object or empty, got ${typeof config}`);
  }
  const cfg = (config ?? {}) as NightleafConfig;
  const tiers = checkInt(cfg.tiers ?? DEFAULT_TIERS, MIN_TIERS, MAX_TIERS, 'tiers');
  const buds = checkInt(cfg.buds ?? DEFAULT_BUDS, MIN_BUDS, MAX_BUDS, 'buds');
  const fireflies = checkInt(
    cfg.fireflies ?? DEFAULT_FIREFLIES,
    MIN_FIREFLIES,
    MAX_FIREFLIES,
    'fireflies',
  );
  return { tiers, buds, fireflies };
}
