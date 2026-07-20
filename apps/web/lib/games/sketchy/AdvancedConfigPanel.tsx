'use client';

// Sketchy's ADVANCED host config (spec 0063, pacing per spec 0068), rendered into the lobby's
// collapsed "Advanced settings" slot: auto-advance on/off and the advance-after dwell. Same
// controlled `GameConfigPanelProps` contract as the standard panel. These map to the engine pacing:
// auto-advance + advance-after drive the gallery/leaderboard dwell (the engine reports
// `autoAdvance` = leaderboardWindowMs > 0). Mobile-first: single-column, legible at 360px.

import { Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  MAX_ADVANCE_AFTER_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  validateSketchyConfig,
  type ConfigError,
  type SketchyHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function SketchyAdvancedConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as SketchyHostConfig;
  const errors = validateSketchyConfig(config);
  const set = (next: Partial<SketchyHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sketchy-auto-advance">Auto advance</Label>
          <p className="text-body-sm text-text-muted">
            Move on automatically from the gallery and leaderboard to the next round.
          </p>
        </div>
        <button
          id="sketchy-auto-advance"
          type="button"
          role="switch"
          aria-checked={config.autoAdvance}
          disabled={disabled}
          onClick={() => set({ autoAdvance: !config.autoAdvance })}
          className={`shrink-0 rounded-full border px-4 py-1.5 text-body-sm font-medium transition-colors ${
            config.autoAdvance
              ? 'border-primary bg-primary/10 text-text'
              : 'border-border bg-surface-raised text-text-muted hover:border-border-strong'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {config.autoAdvance ? 'On' : 'Off'}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sketchy-advance-after">Advance after (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long each gallery and leaderboard screen shows before moving on.
        </p>
        <Input
          id="sketchy-advance-after"
          type="number"
          inputMode="numeric"
          min={MIN_ADVANCE_AFTER_SECONDS}
          max={MAX_ADVANCE_AFTER_SECONDS}
          // The dwell only applies when auto-advance is on; disable it when off so the field never
          // reads as active while it has no effect.
          disabled={disabled || !config.autoAdvance}
          value={Number.isNaN(config.advanceAfterSeconds) ? '' : config.advanceAfterSeconds}
          onChange={(event) => set({ advanceAfterSeconds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'advanceAfter') !== null}
          aria-describedby={
            errorFor(errors, 'advanceAfter') ? 'sketchy-advance-after-error' : undefined
          }
        />
        {errorFor(errors, 'advanceAfter') ? (
          <p id="sketchy-advance-after-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'advanceAfter')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
