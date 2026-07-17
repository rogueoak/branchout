// Nightleaf's host config model + validation for the game-pluggable lobby (spec 0060). Mirrors the
// engine plugin's validateConfig so the host cannot start an invalid game; the engine re-checks at the
// /sessions boundary. The config is the opaque blob the control-plane passes through to the engine.

export const MIN_TIERS = 1;
export const MAX_TIERS = 12;
export const DEFAULT_TIERS = 4;
export const MIN_BUDS = 1;
export const MAX_BUDS = 5;
export const DEFAULT_BUDS = 3;
export const MIN_FIREFLIES = 0;
export const MAX_FIREFLIES = 5;
export const DEFAULT_FIREFLIES = 1;

/** The host's Nightleaf setup: how many tiers to climb, buds (lives), and fireflies (hushes). */
export interface NightleafHostConfig {
  tiers: number;
  buds: number;
  fireflies: number;
}

export function defaultNightleafConfig(): NightleafHostConfig {
  return { tiers: DEFAULT_TIERS, buds: DEFAULT_BUDS, fireflies: DEFAULT_FIREFLIES };
}

export interface ConfigError {
  field: 'tiers' | 'buds' | 'fireflies';
  message: string;
}

function checkInt(
  value: number,
  min: number,
  max: number,
  field: ConfigError['field'],
  errors: ConfigError[],
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push({ field, message: `Pick a whole number from ${min} to ${max}.` });
  }
}

/**
 * Validate a host config against the same rules the engine enforces: `tiers` in [1, 12], `buds` in
 * [1, 5], `fireflies` in [0, 5]. Returns every error so the panel can flag the right field; an empty
 * array means valid.
 */
export function validateNightleafConfig(config: NightleafHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  checkInt(config.tiers, MIN_TIERS, MAX_TIERS, 'tiers', errors);
  checkInt(config.buds, MIN_BUDS, MAX_BUDS, 'buds', errors);
  checkInt(config.fireflies, MIN_FIREFLIES, MAX_FIREFLIES, 'fireflies', errors);
  return errors;
}
