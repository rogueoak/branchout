// Sketchy's host config model + validation for the game-pluggable lobby (spec 0063). Mirrors the
// engine plugin's validateConfig (spec 0063) so the host cannot start an invalid game; the engine
// re-checks at the /sessions boundary. The config is the opaque blob the control-plane passes through
// to the engine unchanged.

export const MIN_ROUNDS = 1;
// Mirror of the engine cap (spec 0063): a cycle is 1 draw + N sketch engine rounds, so 10 cycles
// keeps an 8-player session bounded and within the sample seed bank (10 x 8 = 80 distinct seeds).
export const MAX_ROUNDS = 10;
export const DEFAULT_ROUNDS = 3;

/** The host's Sketchy setup: how many draw-and-guess cycles to play. */
export interface SketchyHostConfig {
  rounds: number;
}

export function defaultSketchyConfig(): SketchyHostConfig {
  return { rounds: DEFAULT_ROUNDS };
}

export interface ConfigError {
  field: 'rounds';
  message: string;
}

/**
 * Validate a host config against the same rule the engine enforces: `rounds` is an integer in
 * [1, 20]. Returns every error so the panel can surface the field; an empty array means valid.
 */
export function validateSketchyConfig(config: SketchyHostConfig): ConfigError[] {
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
