'use client';

// Lone Leaf's ADVANCED host config (spec 0057), rendered into the lobby's collapsed "Advanced
// settings" slot: auto-advance on/off, the advance-after dwell, and the two round windows (clue time
// and guess time). Same controlled `GameConfigPanelProps` contract as the standard panel. These map
// to the engine pacing: auto-advance + advance-after drive the reveal/leaderboard dwell, clue time is
// the leaf-writing move window, and guess time is the Seeker's decision window. Mobile-first:
// single-column, legible at 360px.

import { Input, Label } from '@rogueoak/canopy';
import {
  MAX_ADVANCE_AFTER_SECONDS,
  MAX_ROUND_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MIN_ROUND_SECONDS,
  validateLoneLeafConfig,
  type ConfigError,
  type LoneLeafHostConfig,
} from './config';
import type { GameConfigPanelProps } from '../registry';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function LoneLeafAdvancedConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as LoneLeafHostConfig;
  const errors = validateLoneLeafConfig(config);
  const set = (next: Partial<LoneLeafHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="lone-leaf-auto-advance">Auto advance</Label>
          <p className="text-body-sm text-text-muted">
            Move on automatically from the reveal to the leaderboard, and on to the next round.
          </p>
        </div>
        <button
          id="lone-leaf-auto-advance"
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
        <Label htmlFor="lone-leaf-advance-after">Advance after (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long each reveal and leaderboard screen shows before moving on.
        </p>
        <Input
          id="lone-leaf-advance-after"
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
            errorFor(errors, 'advanceAfter') ? 'lone-leaf-advance-after-error' : undefined
          }
        />
        {errorFor(errors, 'advanceAfter') ? (
          <p id="lone-leaf-advance-after-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'advanceAfter')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="lone-leaf-clue-time">Clue time (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long players have to write their one-word leaf each round.
        </p>
        <Input
          id="lone-leaf-clue-time"
          type="number"
          inputMode="numeric"
          min={MIN_ROUND_SECONDS}
          max={MAX_ROUND_SECONDS}
          disabled={disabled}
          value={Number.isNaN(config.clueSeconds) ? '' : config.clueSeconds}
          onChange={(event) => set({ clueSeconds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'clue') !== null}
          aria-describedby={errorFor(errors, 'clue') ? 'lone-leaf-clue-time-error' : undefined}
        />
        {errorFor(errors, 'clue') ? (
          <p id="lone-leaf-clue-time-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'clue')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="lone-leaf-guess-time">Guess time (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long the Seeker has to guess the hidden word from the surviving leaves.
        </p>
        <Input
          id="lone-leaf-guess-time"
          type="number"
          inputMode="numeric"
          min={MIN_ROUND_SECONDS}
          max={MAX_ROUND_SECONDS}
          disabled={disabled}
          value={Number.isNaN(config.guessSeconds) ? '' : config.guessSeconds}
          onChange={(event) => set({ guessSeconds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'guess') !== null}
          aria-describedby={errorFor(errors, 'guess') ? 'lone-leaf-guess-time-error' : undefined}
        />
        {errorFor(errors, 'guess') ? (
          <p id="lone-leaf-guess-time-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'guess')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
