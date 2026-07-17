// Sketchy host configuration and its validator (spec 0063). The host picks a number of rounds; the
// draw timer is fixed. `validateConfig` is the plugin manifest's config schema: the engine runs it at
// the `/sessions` handoff boundary, so a bad config is a 400, not a broken game. Mirrored on the web.

export const MIN_ROUNDS = 1;
// Each round (cycle) is 1 draw + N sketch engine rounds, so with 8 players a cycle is 9 engine
// rounds. Cap the cycle count at 10 to keep an insider session bounded (<= 90 engine rounds) and to
// stay comfortably within the sample seed bank (a cycle deals N distinct seeds and never repeats a
// prompt across the game, so 10 cycles of 8 players needs 80 seeds; the sample carries 100+).
export const MAX_ROUNDS = 10;
export const DEFAULT_ROUNDS = 3;

/** Host-supplied configuration, before validation/defaulting. */
export interface SketchyConfig {
  /** 1-20, default 3. */
  rounds?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedSketchyConfig {
  rounds: number;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedSketchyConfig {
  const cfg = (config ?? {}) as SketchyConfig;

  const rounds = cfg.rounds ?? DEFAULT_ROUNDS;
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new Error(
      `sketchy rounds must be an integer ${MIN_ROUNDS}-${MAX_ROUNDS}, got ${JSON.stringify(rounds)}`,
    );
  }

  return { rounds };
}
