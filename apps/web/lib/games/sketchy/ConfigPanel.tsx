'use client';

// Sketchy's host config FORM for the game-pluggable lobby (spec 0063): just a round (cycle) count.
// Form-only and controlled - the parent (the lobby shell) owns the value and the Start gating, so this
// matches the generic `GameConfigPanelProps` (value/onChange/disabled). Validates against the engine's
// rule so the host cannot start an invalid game.

import { Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  MAX_ROUNDS,
  MIN_ROUNDS,
  validateSketchyConfig,
  type ConfigError,
  type SketchyHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function SketchyConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as SketchyHostConfig;
  const errors = validateSketchyConfig(config);
  const set = (next: Partial<SketchyHostConfig>) => onChange({ ...config, ...next });

  const roundsError = errorFor(errors, 'rounds');
  const roundsValue = Number.isNaN(config.rounds) ? '' : config.rounds;
  let roundsErrorMessage = null;
  if (roundsError) {
    roundsErrorMessage = (
      <p id="sketchy-rounds-error" role="alert" className="text-body-sm text-danger">
        {roundsError}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sketchy-rounds">Rounds</Label>
        <Input
          id="sketchy-rounds"
          type="number"
          inputMode="numeric"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          disabled={disabled}
          value={roundsValue}
          onChange={(event) => set({ rounds: event.target.valueAsNumber })}
          aria-invalid={roundsError !== null}
          aria-describedby={roundsError ? 'sketchy-rounds-error' : undefined}
        />
        <p className="text-caption text-text-subtle">
          Each round, everyone draws a secret seed, then guesses the real one behind every sketch.
        </p>
        {roundsErrorMessage}
      </div>
    </div>
  );
}
