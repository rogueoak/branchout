'use client';

// Trivia's host config FORM for the game-pluggable lobby (spec 0023): category, rounds, difficulty.
// Form-only and controlled - the parent (the lobby shell) owns the value and the Start button/gating,
// so this panel matches the generic `GameConfigPanelProps` (value/onChange/disabled) every game uses.
// The category is a native <select> styled with canopy's inputVariants (a plain enum, testable
// without a portal); the fields validate against the engine's ranges (spec 0008).

import { Input, Label, inputVariants } from '@rogueoak/canopy';
import { DifficultyRange } from '../../../components/game/DifficultyRange';
import {
  CONFIGURABLE_CATEGORIES,
  MAX_DIFFICULTY,
  MAX_ROUNDS,
  MIN_DIFFICULTY,
  MIN_ROUNDS,
  validateTriviaConfig,
  type ConfigError,
  type TriviaHostConfig,
} from './config';
import type { GameConfigPanelProps } from '../registry';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function TriviaConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as TriviaHostConfig;
  const errors = validateTriviaConfig(config);
  const set = (next: Partial<TriviaHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="trivia-category">Category</Label>
        <select
          id="trivia-category"
          className={inputVariants()}
          value={config.category}
          disabled={disabled}
          onChange={(event) => set({ category: event.target.value })}
        >
          {CONFIGURABLE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="trivia-rounds">Rounds</Label>
        <Input
          id="trivia-rounds"
          type="number"
          inputMode="numeric"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          disabled={disabled}
          value={Number.isNaN(config.rounds) ? '' : config.rounds}
          onChange={(event) => set({ rounds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'rounds') !== null}
          aria-describedby={errorFor(errors, 'rounds') ? 'trivia-rounds-error' : undefined}
        />
        {errorFor(errors, 'rounds') ? (
          <p id="trivia-rounds-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'rounds')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <DifficultyRange
          min={config.difficultyMin}
          max={config.difficultyMax}
          floor={MIN_DIFFICULTY}
          ceiling={MAX_DIFFICULTY}
          onChange={(difficultyMin, difficultyMax) => set({ difficultyMin, difficultyMax })}
        />
        {errorFor(errors, 'difficulty') ? (
          <p id="trivia-difficulty-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'difficulty')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
