// Sketchy's host config model + validation for the game-pluggable lobby (spec 0063). Mirrors the
// engine plugin's validateConfig (spec 0063, pacing per spec 0068) so the host cannot start an
// invalid game; the engine re-checks at the /sessions boundary. The config is the opaque blob the
// control-plane passes through to the engine unchanged.

export const MIN_ROUNDS = 1;
// Mirror of the engine cap (spec 0063): a cycle is 1 draw + N sketch engine rounds. The cap of 15
// keeps an 8-player session bounded while letting the "Marathon" preset fit; the engine re-checks the
// actual seed bank (a cycle deals N distinct seeds) and rejects a too-deep game on the handoff.
export const MAX_ROUNDS = 15;
export const DEFAULT_ROUNDS = 5;

/** Auto-advance pacing (spec 0068), mirroring Trivia. Seconds where noted. */
export const DEFAULT_AUTO_ADVANCE = true;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;

/** One rounds preset. `Custom` is handled in the UI (a number field), not listed here. */
export interface RoundPreset {
  value: number;
  label: string;
  description: string;
}

/** Rounds presets (spec 0068): Fast / Standard / Long / Marathon, plus a Custom number field in the UI. */
export const ROUND_PRESETS: readonly RoundPreset[] = [
  { value: 3, label: 'Fast', description: 'A quick game - 3 rounds.' },
  { value: 5, label: 'Standard', description: 'A balanced game - 5 rounds.' },
  { value: 7, label: 'Long', description: 'A longer game - 7 rounds.' },
  { value: 15, label: 'Marathon', description: 'The full haul - 15 rounds.' },
];

/** The host's Sketchy setup: how many draw-and-guess cycles to play, plus auto-advance pacing. */
export interface SketchyHostConfig {
  rounds: number;
  /** Auto-advance the gallery/leaderboard -> next round. */
  autoAdvance: boolean;
  /** Dwell before each auto-advance hop, in seconds (1-60). */
  advanceAfterSeconds: number;
}

export function defaultSketchyConfig(): SketchyHostConfig {
  return {
    rounds: DEFAULT_ROUNDS,
    autoAdvance: DEFAULT_AUTO_ADVANCE,
    advanceAfterSeconds: DEFAULT_ADVANCE_AFTER_SECONDS,
  };
}

export interface ConfigError {
  field: 'rounds' | 'advanceAfter';
  message: string;
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validate a host config against the same rules the engine enforces: `rounds` is an integer in
 * [1, 15] and the advance-after dwell is an integer in [1, 60]. Returns every error so the panel can
 * surface the field; an empty array means valid.
 */
export function validateSketchyConfig(config: SketchyHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  if (!isIntInRange(config.rounds, MIN_ROUNDS, MAX_ROUNDS)) {
    errors.push({
      field: 'rounds',
      message: `Rounds must be a whole number ${MIN_ROUNDS}-${MAX_ROUNDS}.`,
    });
  }
  if (
    !isIntInRange(config.advanceAfterSeconds, MIN_ADVANCE_AFTER_SECONDS, MAX_ADVANCE_AFTER_SECONDS)
  ) {
    errors.push({
      field: 'advanceAfter',
      message: `Advance after must be from ${MIN_ADVANCE_AFTER_SECONDS} to ${MAX_ADVANCE_AFTER_SECONDS} seconds.`,
    });
  }
  return errors;
}
