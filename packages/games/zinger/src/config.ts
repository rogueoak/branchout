// Zinger host configuration and its validator (spec 0053). The host picks how many rounds to play.
// `validateConfig` is the plugin manifest's config schema: the engine runs it at the `/sessions`
// handoff boundary, so a bad config is a 400, not a broken game. Mirrored on the web (config.ts) so the
// lobby cannot start an invalid game.

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 8;

/** Host-supplied configuration, before validation/defaulting. */
export interface ZingerConfig {
  /** 1-100, default 8. */
  rounds?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedZingerConfig {
  rounds: number;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedZingerConfig {
  const cfg = (config ?? {}) as ZingerConfig;
  const rounds = cfg.rounds ?? DEFAULT_ROUNDS;
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(
      `zinger rounds must be an integer ${MIN_ROUNDS}-${MAX_ROUNDS}, got ${JSON.stringify(rounds)}`,
    );
  }
  return { rounds };
}
