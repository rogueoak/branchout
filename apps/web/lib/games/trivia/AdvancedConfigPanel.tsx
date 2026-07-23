'use client';

// Trivial Matters' ADVANCED host config (spec 0068, spec 0074), rendered into the lobby's collapsed
// "Advanced settings" slot: auto-advance on/off, the advance-after dwell, and the three per-type
// answer timers (a tap needs less time than typing, so multiple-choice / true-false / open each get
// their own window). Same controlled `GameConfigPanelProps` contract as the standard panel. These map
// to the engine pacing: auto-advance + advance-after drive the answer-screen/leaderboard dwells; each
// timer is that round type's answer window (move window). Mobile-first: single-column, legible at
// 360px.

import { Input, Label } from '@rogueoak/canopy';
import {
  MAX_ADVANCE_AFTER_SECONDS,
  MAX_MC_TIME_LIMIT_SECONDS,
  MAX_OPEN_TIME_LIMIT_SECONDS,
  MAX_TF_TIME_LIMIT_SECONDS,
  MIN_ADVANCE_AFTER_SECONDS,
  MIN_MC_TIME_LIMIT_SECONDS,
  MIN_OPEN_TIME_LIMIT_SECONDS,
  MIN_TF_TIME_LIMIT_SECONDS,
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
        <Label>Time limits (seconds)</Label>
        <p className="text-body-sm text-text-muted">
          How long players have to answer each type of question - a tap needs less time than typing.
        </p>

        <div className="flex flex-col gap-1">
          <Label htmlFor="trivia-mc-time-limit">Multiple choice</Label>
          <Input
            id="trivia-mc-time-limit"
            type="number"
            inputMode="numeric"
            min={MIN_MC_TIME_LIMIT_SECONDS}
            max={MAX_MC_TIME_LIMIT_SECONDS}
            disabled={disabled}
            value={Number.isNaN(config.mcTimeLimitSeconds) ? '' : config.mcTimeLimitSeconds}
            onChange={(event) => set({ mcTimeLimitSeconds: event.target.valueAsNumber })}
            aria-invalid={errorFor(errors, 'mcTimeLimit') !== null}
            aria-describedby={
              errorFor(errors, 'mcTimeLimit') ? 'trivia-mc-time-limit-error' : undefined
            }
          />
          {errorFor(errors, 'mcTimeLimit') ? (
            <p id="trivia-mc-time-limit-error" role="alert" className="text-body-sm text-danger">
              {errorFor(errors, 'mcTimeLimit')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="trivia-tf-time-limit">True or false</Label>
          <Input
            id="trivia-tf-time-limit"
            type="number"
            inputMode="numeric"
            min={MIN_TF_TIME_LIMIT_SECONDS}
            max={MAX_TF_TIME_LIMIT_SECONDS}
            disabled={disabled}
            value={Number.isNaN(config.tfTimeLimitSeconds) ? '' : config.tfTimeLimitSeconds}
            onChange={(event) => set({ tfTimeLimitSeconds: event.target.valueAsNumber })}
            aria-invalid={errorFor(errors, 'tfTimeLimit') !== null}
            aria-describedby={
              errorFor(errors, 'tfTimeLimit') ? 'trivia-tf-time-limit-error' : undefined
            }
          />
          {errorFor(errors, 'tfTimeLimit') ? (
            <p id="trivia-tf-time-limit-error" role="alert" className="text-body-sm text-danger">
              {errorFor(errors, 'tfTimeLimit')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="trivia-open-time-limit">Open answer</Label>
          <Input
            id="trivia-open-time-limit"
            type="number"
            inputMode="numeric"
            min={MIN_OPEN_TIME_LIMIT_SECONDS}
            max={MAX_OPEN_TIME_LIMIT_SECONDS}
            disabled={disabled}
            value={Number.isNaN(config.openTimeLimitSeconds) ? '' : config.openTimeLimitSeconds}
            onChange={(event) => set({ openTimeLimitSeconds: event.target.valueAsNumber })}
            aria-invalid={errorFor(errors, 'openTimeLimit') !== null}
            aria-describedby={
              errorFor(errors, 'openTimeLimit') ? 'trivia-open-time-limit-error' : undefined
            }
          />
          {errorFor(errors, 'openTimeLimit') ? (
            <p id="trivia-open-time-limit-error" role="alert" className="text-body-sm text-danger">
              {errorFor(errors, 'openTimeLimit')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
