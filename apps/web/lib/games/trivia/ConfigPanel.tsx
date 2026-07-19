'use client';

// Trivia's STANDARD host config form (spec 0023, reworked spec 0068): categories (Random or a
// subset), rounds (presets + custom), and difficulty (label-only presets). Form-only and controlled -
// the parent (the lobby shell) owns the value and the Start button/gating, so this panel matches the
// generic `GameConfigPanelProps`. The auto-advance/time-limit fields live in a separate
// AdvancedConfigPanel rendered into the lobby's Advanced slot. The numeric 1-10 difficulty ranking is
// never shown - difficulty is chosen by label via the same option selector the lobby "Your mode"
// picker uses.

import { useState } from 'react';
import { Input, Label } from '@rogueoak/canopy';
import { OptionSelector, type SelectorOption } from '../../../components/game/OptionSelector';
import {
  CATEGORIES,
  DIFFICULTY_PRESETS,
  MAX_ROUNDS,
  MIN_ROUNDS,
  ROUND_PRESETS,
  difficultyPresetId,
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

  const isRandom = config.categories.length === 0;
  const toggleCategory = (category: string) => {
    const has = config.categories.includes(category);
    const next = has
      ? config.categories.filter((c) => c !== category)
      : [...config.categories, category];
    set({ categories: next });
  };

  // Rounds: a preset selector plus a custom number field. A round count that matches no preset (or an
  // explicit "Custom" choice) reveals the number field.
  const roundsPreset = ROUND_PRESETS.find((preset) => preset.value === config.rounds);
  const [customRounds, setCustomRounds] = useState(!roundsPreset);
  const roundsValue = roundsPreset && !customRounds ? String(config.rounds) : 'custom';
  const roundOptions: SelectorOption<string>[] = [
    ...ROUND_PRESETS.map((preset) => ({
      value: String(preset.value),
      label: `${preset.label} (${preset.value})`,
      description: preset.description,
    })),
    { value: 'custom', label: 'Custom', description: 'Set your own number of rounds.' },
  ];
  const onRoundsSelect = (next: string) => {
    if (next === 'custom') {
      setCustomRounds(true);
      return;
    }
    setCustomRounds(false);
    set({ rounds: Number(next) });
  };

  // Difficulty: label-only presets. A band matching no preset (e.g. a legacy 4-6 room) shows a
  // read-only "Custom" option so the selection still reads coherently without exposing the numbers.
  const activePreset = difficultyPresetId(config.difficultyMin, config.difficultyMax);
  const difficultyOptions: SelectorOption<string>[] = DIFFICULTY_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
    description: preset.description,
  }));
  if (activePreset === 'custom') {
    difficultyOptions.push({
      value: 'custom',
      label: 'Custom',
      description: 'A custom difficulty range.',
    });
  }
  const onDifficultySelect = (id: string) => {
    const preset = DIFFICULTY_PRESETS.find((p) => p.id === id);
    if (preset) set({ difficultyMin: preset.min, difficultyMax: preset.max });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label>Categories</Label>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-pressed={isRandom}
            disabled={disabled}
            onClick={() => set({ categories: [] })}
            className={`rounded-lg border px-4 py-2 text-left text-body font-medium transition-colors ${
              isRandom
                ? 'border-primary bg-primary/10 text-text'
                : 'border-border bg-surface-raised text-text hover:border-border-strong'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Random
            <span className="block text-body-sm font-normal text-text-muted">
              Draw from all eight categories.
            </span>
          </button>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pick categories">
            {CATEGORIES.map((category) => {
              const selected = config.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggleCategory(category)}
                  className={`rounded-full border px-3 py-1.5 text-body-sm transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 text-text'
                      : 'border-border bg-surface-raised text-text-muted hover:border-border-strong'
                  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
        {errorFor(errors, 'categories') ? (
          <p id="trivia-categories-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'categories')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Rounds</Label>
        <OptionSelector
          ariaLabel="Number of rounds"
          value={roundsValue}
          options={roundOptions}
          onChange={onRoundsSelect}
          disabled={disabled}
        />
        {roundsValue === 'custom' ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="trivia-rounds">Custom rounds</Label>
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
          </div>
        ) : null}
        {errorFor(errors, 'rounds') ? (
          <p id="trivia-rounds-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'rounds')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Difficulty</Label>
        <OptionSelector
          ariaLabel="Difficulty"
          value={activePreset}
          options={difficultyOptions}
          onChange={onDifficultySelect}
          disabled={disabled}
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
