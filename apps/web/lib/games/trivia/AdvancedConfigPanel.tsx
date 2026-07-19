'use client';

// Trivia's ADVANCED host config (spec 0068), rendered into the lobby's collapsed "Advanced settings"
// slot: auto-advance on/off, the advance-after dwell, and the answer time limit. Same controlled
// `GameConfigPanelProps` contract as the standard panel. These map to the engine pacing:
// auto-advance + advance-after drive the answer-screen/leaderboard dwells, time limit is the answer
// window (move window). Mobile-first: single-column, legible at 360px.

import { Input, Label } from '@rogueoak/canopy';
import {
  MAX_ADVANCE_AFTER_SECONDS,
  MAX_TIME_LIMIT_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MIN_TIME_LIMIT_SECONDS,
  validateTriviaConfig,
  type ConfigError,
  type TriviaHostConfig,
} from './config';
import type { GameConfigPanelProps } from '../registry';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function TriviaAdvancedConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as TriviaHostConfig;
  const errors = validateTriviaConfig(config);
  const set = (next: Partial<TriviaHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="trivia-auto-advance">Auto advance</Label>
          <p className="text-body-sm text-text-muted">
            Move on automatically from the answers to the leaderboard, and on to the next question.
          </p>
        </div>
        <button
          id="trivia-auto-advance"
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
        <Label htmlFor="trivia-advance-after">Advance after (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long each answer and leaderboard screen shows before moving on.
        </p>
        <Input
          id="trivia-advance-after"
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
            errorFor(errors, 'advanceAfter') ? 'trivia-advance-after-error' : undefined
          }
        />
        {errorFor(errors, 'advanceAfter') ? (
          <p id="trivia-advance-after-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'advanceAfter')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="trivia-time-limit">Time limit (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long players have to answer each question.
        </p>
        <Input
          id="trivia-time-limit"
          type="number"
          inputMode="numeric"
          min={MIN_TIME_LIMIT_SECONDS}
          max={MAX_TIME_LIMIT_SECONDS}
          disabled={disabled}
          value={Number.isNaN(config.timeLimitSeconds) ? '' : config.timeLimitSeconds}
          onChange={(event) => set({ timeLimitSeconds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'timeLimit') !== null}
          aria-describedby={errorFor(errors, 'timeLimit') ? 'trivia-time-limit-error' : undefined}
        />
        {errorFor(errors, 'timeLimit') ? (
          <p id="trivia-time-limit-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'timeLimit')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
