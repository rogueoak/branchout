'use client';

// Brambles' host config form (spec 0061): the number of sprints (timed team turns) and the seconds
// each sprint runs. Form-only and controlled - the parent lobby owns the value and the Start gating.
// Validates against the engine's rules so the host cannot start an invalid game.

import { Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  MAX_SPRINTS,
  MAX_SPRINT_SECONDS,
  MIN_SPRINTS,
  MIN_SPRINT_SECONDS,
  validateBramblesConfig,
  type BramblesHostConfig,
  type ConfigError,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function BramblesConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as BramblesHostConfig;
  const errors = validateBramblesConfig(config);
  const set = (next: Partial<BramblesHostConfig>) => onChange({ ...config, ...next });

  const sprintsError = errorFor(errors, 'sprints');
  const secondsError = errorFor(errors, 'sprintSeconds');
  const sprintsErrorMsg = sprintsError ? (
    <p id="brambles-sprints-error" role="alert" className="text-body-sm text-danger">
      {sprintsError}
    </p>
  ) : null;
  const secondsErrorMsg = secondsError ? (
    <p id="brambles-seconds-error" role="alert" className="text-body-sm text-danger">
      {secondsError}
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-sm text-text-muted">
        Two groves take turns. Each turn, a grove&apos;s Guide gets a hidden bloom and forbidden
        thorns, and types clues while their grove guesses. Most blooms wins.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="brambles-sprints">Sprints (team turns, even)</Label>
        <Input
          id="brambles-sprints"
          type="number"
          inputMode="numeric"
          min={MIN_SPRINTS}
          max={MAX_SPRINTS}
          step={2}
          disabled={disabled}
          value={Number.isNaN(config.sprints) ? '' : config.sprints}
          onChange={(event) => set({ sprints: event.target.valueAsNumber })}
          aria-invalid={sprintsError !== null}
          aria-describedby={sprintsError ? 'brambles-sprints-error' : undefined}
        />
        {sprintsErrorMsg}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="brambles-seconds">Seconds per sprint</Label>
        <Input
          id="brambles-seconds"
          type="number"
          inputMode="numeric"
          min={MIN_SPRINT_SECONDS}
          max={MAX_SPRINT_SECONDS}
          disabled={disabled}
          value={Number.isNaN(config.sprintSeconds) ? '' : config.sprintSeconds}
          onChange={(event) => set({ sprintSeconds: event.target.valueAsNumber })}
          aria-invalid={secondsError !== null}
          aria-describedby={secondsError ? 'brambles-seconds-error' : undefined}
        />
        {secondsErrorMsg}
      </div>
    </div>
  );
}
