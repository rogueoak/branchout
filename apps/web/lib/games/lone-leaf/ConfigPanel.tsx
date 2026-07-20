'use client';

// Lone Leaf's host config FORM for the game-pluggable lobby (spec 0057): a Random toggle, a capped
// multi-select of up to three seed categories, and a round count chosen from presets (Fast / Standard
// / Long / Marathon) or a Custom number. Form-only and controlled - the parent (the lobby shell) owns
// the value and Start gating, matching the generic `GameConfigPanelProps` every game uses. The
// auto-advance and round-window fields live in the separate AdvancedConfigPanel rendered into the
// lobby's Advanced slot. Validates against the engine's rules so the host cannot start an invalid game.

import { useState, type ReactNode } from 'react';
import { Badge, Button, Input, Label } from '@rogueoak/canopy';
import { OptionSelector, type SelectorOption } from '../../../components/game/OptionSelector';
import type { GameConfigPanelProps } from '../registry';
import {
  CATEGORIES,
  DIFFICULTY_PRESETS,
  MAX_CATEGORIES,
  MAX_ROUNDS,
  MIN_ROUNDS,
  ROUND_PRESETS,
  categoryLabel,
  difficultyPresetId,
  isCategoryList,
  validateLoneLeafConfig,
  type ConfigError,
  type LoneLeafHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function LoneLeafConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as LoneLeafHostConfig;
  const errors = validateLoneLeafConfig(config);
  const random = !isCategoryList(config.categories);
  const selected = isCategoryList(config.categories) ? config.categories : [];
  const atCap = selected.length >= MAX_CATEGORIES;

  const set = (next: Partial<LoneLeafHostConfig>) => onChange({ ...config, ...next });

  const toggleCategory = (category: string) => {
    const isOn = selected.includes(category);
    const next = isOn ? selected.filter((c) => c !== category) : [...selected, category];
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
      label: preset.label,
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

  // Difficulty: label-only presets (mirrors Trivia). A band matching no preset (e.g. a legacy room)
  // shows a read-only "Custom" option so the selection reads coherently without exposing the numbers.
  const activeDifficulty = difficultyPresetId(config.difficultyMin, config.difficultyMax);
  const difficultyOptions: SelectorOption<string>[] = DIFFICULTY_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
    description: preset.description,
  }));
  if (activeDifficulty === 'custom') {
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

  const categoriesError = errorFor(errors, 'categories');
  const roundsError = errorFor(errors, 'rounds');
  const difficultyError = errorFor(errors, 'difficulty');

  const categoriesErrorLine = categoriesError ? (
    <p role="alert" className="text-body-sm text-danger">
      {categoriesError}
    </p>
  ) : null;
  const roundsErrorLine = roundsError ? (
    <p id="lone-leaf-rounds-error" role="alert" className="text-body-sm text-danger">
      {roundsError}
    </p>
  ) : null;

  let themePicker: ReactNode;
  if (!random) {
    themePicker = (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose up to 3 themes">
          {CATEGORIES.map((category) => {
            const on = selected.includes(category);
            const buttonVariant = on ? 'secondary' : 'outline';
            return (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={buttonVariant}
                aria-pressed={on}
                // Cap at three: an unchecked theme is disabled once the cap is reached.
                disabled={disabled || (!on && atCap)}
                onClick={() => toggleCategory(category)}
              >
                {categoryLabel(category)}
              </Button>
            );
          })}
        </div>
        <p className="text-caption text-text-subtle">
          {selected.length}/{MAX_CATEGORIES} chosen. Pick 1-3 themes, or switch to Random.
        </p>
        {categoriesErrorLine}
      </div>
    );
  } else {
    themePicker = (
      <Badge variant="neutral" className="w-fit">
        Drawing from all {CATEGORIES.length} themes
      </Badge>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-text">Word themes</span>
        <div className="flex gap-2" role="group" aria-label="Category selection">
          <Button
            type="button"
            variant={random ? 'primary' : 'outline'}
            aria-pressed={random}
            disabled={disabled}
            onClick={() => set({ categories: 'random' })}
          >
            Random (all)
          </Button>
          <Button
            type="button"
            variant={!random ? 'primary' : 'outline'}
            aria-pressed={!random}
            disabled={disabled}
            onClick={() => set({ categories: selected.length > 0 ? selected : [CATEGORIES[0]] })}
          >
            Pick themes
          </Button>
        </div>

        {themePicker}
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
            <Label htmlFor="lone-leaf-rounds">Custom rounds</Label>
            <Input
              id="lone-leaf-rounds"
              type="number"
              inputMode="numeric"
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              disabled={disabled}
              value={Number.isNaN(config.rounds) ? '' : config.rounds}
              onChange={(event) => set({ rounds: event.target.valueAsNumber })}
              aria-invalid={roundsError !== null}
              aria-describedby={roundsError ? 'lone-leaf-rounds-error' : undefined}
            />
          </div>
        ) : null}
        {roundsErrorLine}
        <p className="text-caption text-text-subtle">
          One hidden word per round. The Seeker rotates each round, so everyone takes a turn
          guessing.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Difficulty</Label>
        <OptionSelector
          ariaLabel="Difficulty"
          value={activeDifficulty}
          options={difficultyOptions}
          onChange={onDifficultySelect}
          disabled={disabled}
        />
        <p className="text-caption text-text-subtle">
          How well-known the hidden words are - from everyday to expert.
        </p>
        {difficultyError ? (
          <p role="alert" className="text-body-sm text-danger">
            {difficultyError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
