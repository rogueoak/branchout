// Brambles host configuration and its validator (spec 0061). The host picks how many sprints (timed
// team turns) the game runs and how long each sprint lasts. `validateConfig` is the plugin manifest's
// config schema: the engine runs it at the `/sessions` handoff boundary, so a bad config is a 400,
// not a broken game. Sprints must be EVEN so both teams take the same number of turns.

/** A sprint is one team's timed turn. Both teams must get equal turns, so the total is kept even. */
export const MIN_SPRINTS = 2;
export const MAX_SPRINTS = 20;
export const DEFAULT_SPRINTS = 6;

export const MIN_SPRINT_SECONDS = 30;
export const MAX_SPRINT_SECONDS = 180;
export const DEFAULT_SPRINT_SECONDS = 60;

/** Host-supplied configuration, before validation/defaulting. */
export interface BramblesConfig {
  /** Total sprints (team turns) across the game; must be an even integer 2-20. Default 6. */
  sprints?: number;
  /** Seconds each sprint lasts; 30-180. Default 60. */
  sprintSeconds?: number;
}

/** A validated, defaulted configuration. */
export interface ResolvedBramblesConfig {
  sprints: number;
  sprintSeconds: number;
}

/**
 * Validate and default a host config. Throws a descriptive `Error` on any invalid field so the
 * engine's start handoff rejects a bad config rather than launching a broken game.
 */
export function validateConfig(config: unknown): ResolvedBramblesConfig {
  const cfg = (config ?? {}) as BramblesConfig;

  const sprints = cfg.sprints ?? DEFAULT_SPRINTS;
  if (!Number.isInteger(sprints) || sprints < MIN_SPRINTS || sprints > MAX_SPRINTS) {
    throw new Error(
      `brambles sprints must be an integer ${MIN_SPRINTS}-${MAX_SPRINTS}, got ${JSON.stringify(sprints)}`,
    );
  }
  if (sprints % 2 !== 0) {
    throw new Error(`brambles sprints must be even so both teams get equal turns, got ${sprints}`);
  }

  const sprintSeconds = cfg.sprintSeconds ?? DEFAULT_SPRINT_SECONDS;
  if (
    !Number.isInteger(sprintSeconds) ||
    sprintSeconds < MIN_SPRINT_SECONDS ||
    sprintSeconds > MAX_SPRINT_SECONDS
  ) {
    throw new Error(
      `brambles sprintSeconds must be an integer ${MIN_SPRINT_SECONDS}-${MAX_SPRINT_SECONDS}, ` +
        `got ${JSON.stringify(sprintSeconds)}`,
    );
  }

  return { sprints, sprintSeconds };
}
