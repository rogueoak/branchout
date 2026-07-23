'use client';

// Trivial Matters' STANDARD host config form (spec 0023, reworked spec 0068, spec 0074): categories
// (Random or a subset of the ten), a duration preset (Fast / Standard / Long / Marathon / Custom that
// reveals three per-type count inputs), and difficulty (label-only presets). Form-only and controlled -
// the parent (the lobby shell) owns the value and the Start button/gating, so this panel matches the
// generic `GameConfigPanelProps`. The per-type timers + auto-advance live in a separate
// AdvancedConfigPanel rendered into the lobby's Advanced slot. The numeric 1-10 difficulty ranking is
// never shown - difficulty is chosen by label via the same option selector the lobby "Your mode"
// picker uses.

import { Input, Label } from '@rogueoak/canopy';
import { OptionSelector, type SelectorOption } from '../../../components/game/OptionSelector';
import {
  CATEGORIES,
  DIFFICULTY_PRESETS,
  DURATION_PRESETS,
  MAX_CUSTOM_PER_TYPE,
  MIN_CUSTOM_PER_TYPE,
  compositionOf,
  difficultyPresetId,
  totalRoundsOf,
  validateTriviaConfig,
  type Composition,
  type ConfigError,
  type Duration,
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

  // Duration: a preset selector plus a Custom escape hatch. Choosing Custom reveals three per-type
  // count inputs (mirrors the Rounds preset+custom pattern the game used before spec 0074).
  const durationOptions: SelectorOption<Duration>[] = [
    ...DURATION_PRESETS.map((preset) => ({
      value: preset.id as Duration,
      // Name reads cleanly (Fast / Standard / ...); the question count lives in the description below.
      label: preset.label,
      description: preset.description,
    })),
    {
      value: 'custom' as Duration,
      label: 'Custom',
      description: 'Set your own mix of question types.',
    },
  ];
  const onDurationSelect = (next: Duration) => {
    if (next === 'custom') {
      // Seed the custom counts from whatever mix the current preset ran, so Custom opens on a sane,
      // in-range starting point rather than all zeros.
      const seed = config.custom ?? compositionOf(config);
      set({ duration: 'custom', custom: { ...seed } });
      return;
    }
    set({ duration: next });
  };

  const setCustom = (patch: Partial<Composition>) => {
    const current = config.custom ?? { multipleChoice: 0, trueFalse: 0, open: 0 };
    set({ custom: { ...current, ...patch } });
  };
  const custom = config.custom ?? { multipleChoice: 0, trueFalse: 0, open: 0 };
  const customError = errorFor(errors, 'custom');

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

  // A live total under the Custom inputs so the host can see how long their mix runs.
  const customTotal = totalRoundsOf({ ...config, duration: 'custom', custom });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label>Categories</Label>
        <p className="text-body-sm text-text-muted">
          Pick Random for all ten, or choose one or more categories to play.
        </p>
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
              Draw from all ten categories.
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
        <Label>Duration</Label>
        <OptionSelector
          ariaLabel="Game duration"
          value={config.duration}
          options={durationOptions}
          onChange={onDurationSelect}
          disabled={disabled}
        />
        {config.duration === 'custom' ? (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-text-muted">
              Choose how many of each question type to play.
            </p>
            <div className="flex flex-col gap-1">
              <Label htmlFor="trivia-custom-mc">Multiple choice</Label>
              <Input
                id="trivia-custom-mc"
                type="number"
                inputMode="numeric"
                min={MIN_CUSTOM_PER_TYPE}
                max={MAX_CUSTOM_PER_TYPE}
                disabled={disabled}
                value={Number.isNaN(custom.multipleChoice) ? '' : custom.multipleChoice}
                onChange={(event) => setCustom({ multipleChoice: event.target.valueAsNumber })}
                aria-invalid={customError !== null}
                aria-describedby={customError ? 'trivia-custom-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="trivia-custom-tf">True or false</Label>
              <Input
                id="trivia-custom-tf"
                type="number"
                inputMode="numeric"
                min={MIN_CUSTOM_PER_TYPE}
                max={MAX_CUSTOM_PER_TYPE}
                disabled={disabled}
                value={Number.isNaN(custom.trueFalse) ? '' : custom.trueFalse}
                onChange={(event) => setCustom({ trueFalse: event.target.valueAsNumber })}
                aria-invalid={customError !== null}
                aria-describedby={customError ? 'trivia-custom-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="trivia-custom-open">Open answer</Label>
              <Input
                id="trivia-custom-open"
                type="number"
                inputMode="numeric"
                min={MIN_CUSTOM_PER_TYPE}
                max={MAX_CUSTOM_PER_TYPE}
                disabled={disabled}
                value={Number.isNaN(custom.open) ? '' : custom.open}
                onChange={(event) => setCustom({ open: event.target.valueAsNumber })}
                aria-invalid={customError !== null}
                aria-describedby={customError ? 'trivia-custom-error' : undefined}
              />
            </div>
            {customError ? (
              <p id="trivia-custom-error" role="alert" className="text-body-sm text-danger">
                {customError}
              </p>
            ) : (
              <p className="text-body-sm text-text-muted" role="status">
                {customTotal} {customTotal === 1 ? 'question' : 'questions'} total.
              </p>
            )}
          </div>
        ) : null}
        {errorFor(errors, 'duration') ? (
          <p id="trivia-duration-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'duration')}
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
