'use client';

// Zinger's host config FORM for the game-pluggable lobby (spec 0053): just a round count. Form-only
// and controlled - the parent (the lobby shell) owns the value and the Start gating, so this matches
// the generic `GameConfigPanelProps` (value/onChange/disabled) every game uses. Validates against the
// engine's rules (spec 0053) so the host cannot start an invalid game.

import { Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  MAX_ROUNDS,
  MIN_ROUNDS,
  validateZingerConfig,
  type ConfigError,
  type ZingerHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function ZingerConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as ZingerHostConfig;
  const errors = validateZingerConfig(config);
  const set = (next: Partial<ZingerHostConfig>) => onChange({ ...config, ...next });

  const roundsError = errorFor(errors, 'rounds');
  const roundsValue = Number.isNaN(config.rounds) ? '' : config.rounds;
  const roundsHelp = roundsError ? (
    <p id="zinger-rounds-error" role="alert" className="text-body-sm text-danger">
      {roundsError}
    </p>
  ) : (
    <p className="text-caption text-text-subtle">
      Each round is one setup, one face-off, and a vote. Best with three or more players.
    </p>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="zinger-rounds">Rounds</Label>
        <Input
          id="zinger-rounds"
          type="number"
          inputMode="numeric"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          disabled={disabled}
          value={roundsValue}
          onChange={(event) => set({ rounds: event.target.valueAsNumber })}
          aria-invalid={roundsError !== null}
          aria-describedby={roundsError ? 'zinger-rounds-error' : undefined}
        />
        {roundsHelp}
      </div>
    </div>
  );
}
