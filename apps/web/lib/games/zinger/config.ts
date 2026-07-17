// Zinger's host config model + validation for the game-pluggable lobby (spec 0053). Mirrors the
// engine plugin's validateConfig (spec 0053) so the host cannot start an invalid game; the engine
// re-checks at the /sessions boundary. The config is the opaque blob the control-plane passes through
// to the engine unchanged.

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 8;

/** The host's Zinger setup: how many rounds to play. */
export interface ZingerHostConfig {
  rounds: number;
}

export function defaultZingerConfig(): ZingerHostConfig {
  return { rounds: DEFAULT_ROUNDS };
}

export interface ConfigError {
  field: 'rounds';
  message: string;
}

/**
 * Validate a host config against the same rule the engine enforces: `rounds` is an integer in
 * [1, 100]. Returns every error so the panel can surface the right field; an empty array means valid.
 */
export function validateZingerConfig(config: ZingerHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  if (
    !Number.isInteger(config.rounds) ||
    config.rounds < MIN_ROUNDS ||
    config.rounds > MAX_ROUNDS
  ) {
    errors.push({
      field: 'rounds',
      message: `Rounds must be a whole number ${MIN_ROUNDS}-${MAX_ROUNDS}.`,
    });
  }
  return errors;
}
