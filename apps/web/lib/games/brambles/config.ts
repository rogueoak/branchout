// Brambles host configuration for the lobby (spec 0061), mirroring the engine's validator so the
// host cannot start an invalid game. The host picks how many sprints (timed team turns) and how long
// each sprint lasts. Sprints must be EVEN so both teams take the same number of turns.

export const MIN_SPRINTS = 2;
export const MAX_SPRINTS = 20;
export const DEFAULT_SPRINTS = 6;

export const MIN_SPRINT_SECONDS = 30;
export const MAX_SPRINT_SECONDS = 180;
export const DEFAULT_SPRINT_SECONDS = 60;

export interface BramblesHostConfig {
  sprints: number;
  sprintSeconds: number;
}

export interface ConfigError {
  field: 'sprints' | 'sprintSeconds';
  message: string;
}

export function defaultBramblesConfig(): BramblesHostConfig {
  return { sprints: DEFAULT_SPRINTS, sprintSeconds: DEFAULT_SPRINT_SECONDS };
}

/** Validate a host config against the engine's rules; returns a list of field errors (empty = ok). */
export function validateBramblesConfig(config: BramblesHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const { sprints, sprintSeconds } = config;

  if (!Number.isInteger(sprints) || sprints < MIN_SPRINTS || sprints > MAX_SPRINTS) {
    errors.push({
      field: 'sprints',
      message: `Sprints must be a whole number from ${MIN_SPRINTS} to ${MAX_SPRINTS}.`,
    });
  } else if (sprints % 2 !== 0) {
    errors.push({
      field: 'sprints',
      message: 'Sprints must be even so both teams get equal turns.',
    });
  }

  if (
    !Number.isInteger(sprintSeconds) ||
    sprintSeconds < MIN_SPRINT_SECONDS ||
    sprintSeconds > MAX_SPRINT_SECONDS
  ) {
    errors.push({
      field: 'sprintSeconds',
      message: `Each sprint must run ${MIN_SPRINT_SECONDS} to ${MAX_SPRINT_SECONDS} seconds.`,
    });
  }

  return errors;
}
