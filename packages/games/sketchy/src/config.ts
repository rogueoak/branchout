// Sketchy host configuration and its validator (spec 0063). The host picks a number of rounds and the
// auto-advance pacing (spec 0068, mirroring Trivia); the draw timer is fixed. `validateConfig` is the
// plugin manifest's config schema: the engine runs it at the `/sessions` handoff boundary, so a bad
// config is a 400, not a broken game. Mirrored on the web.

export const MIN_ROUNDS = 1;
// Each round (cycle) is 1 draw + N sketch engine rounds, so with 8 players a cycle is 9 engine rounds.
// Cap the cycle count at 15 so the "Marathon" preset fits while keeping an insider session bounded. A
// cycle deals N distinct seeds and never repeats a prompt across the game, so the bank must carry
// `rounds * N` seeds; `configure` re-checks the actual bank and rejects a too-deep game up front.
export const MAX_ROUNDS = 15;
export const DEFAULT_ROUNDS = 5;

/** Auto-advance defaults (spec 0068), mirroring Trivia: on, with a 5s dwell for each hop. */
export const DEFAULT_AUTO_ADVANCE = true;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;

/** Host-supplied configuration, before validation/defaulting. */
export interface SketchyConfig {
  /** 1-15, default 5. */
  rounds?: number;
  /** Auto-advance the gallery/leaderboard -> next round. Default true. */
  autoAdvance?: boolean;
  /** Dwell before each auto-advance hop, in seconds. Default 5, range 1-60. */
  advanceAfterSeconds?: number;
}

/** A validated, defaulted configuration. Durations are resolved to milliseconds for the engine. */
export interface ResolvedSketchyConfig {
  rounds: number;
  autoAdvance: boolean;
  /** Resolved dwell in ms (`advanceAfterSeconds * 1000`). */
  advanceAfterMs: number;
}

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
      `sketchy ${label} must be an integer ${min}-${max}, got ${JSON.stringify(value)}`,
    );
  }
  return resolved;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedSketchyConfig {
  const cfg = (config ?? {}) as SketchyConfig;

  const rounds = resolveIntInRange(cfg.rounds, DEFAULT_ROUNDS, MIN_ROUNDS, MAX_ROUNDS, 'rounds');

  const autoAdvance = cfg.autoAdvance ?? DEFAULT_AUTO_ADVANCE;
  if (typeof autoAdvance !== 'boolean') {
    throw new Error(
      `sketchy autoAdvance must be a boolean, got ${JSON.stringify(cfg.autoAdvance)}`,
    );
  }

  const advanceAfterSeconds = resolveIntInRange(
    cfg.advanceAfterSeconds,
    DEFAULT_ADVANCE_AFTER_SECONDS,
    MIN_ADVANCE_AFTER_SECONDS,
    MAX_ADVANCE_AFTER_SECONDS,
    'advanceAfterSeconds',
  );

  return {
    rounds,
    autoAdvance,
    advanceAfterMs: advanceAfterSeconds * 1000,
  };
}
