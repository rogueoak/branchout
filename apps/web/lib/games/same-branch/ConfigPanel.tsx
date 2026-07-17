'use client';

// Same Branch host config FORM for the game-pluggable lobby (spec 0023): a Random toggle, a capped
// multi-select of up to three spectrum categories, a round count, and a scoring mode (free-for-all or
// co-op). Form-only and controlled - the parent (the lobby shell) owns the value and the Start gating.
// Validates against the engine's rules so the host cannot start an invalid game.

import { Badge, Button, Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  MAX_CATEGORIES,
  MAX_ROUNDS,
  MIN_ROUNDS,
  isCategoryList,
  validateSameBranchConfig,
  type ConfigError,
  type SameBranchCategory,
  type SameBranchHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function SameBranchConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as SameBranchHostConfig;
  const errors = validateSameBranchConfig(config);
  const random = !isCategoryList(config.categories);
  const selected = isCategoryList(config.categories) ? config.categories : [];
  const atCap = selected.length >= MAX_CATEGORIES;

  const set = (next: Partial<SameBranchHostConfig>) => onChange({ ...config, ...next });

  const toggleCategory = (category: string) => {
    const isOn = selected.includes(category);
    const next = isOn ? selected.filter((c) => c !== category) : [...selected, category];
    set({ categories: next });
  };

  const categoriesError = errorFor(errors, 'categories');
  const roundsError = errorFor(errors, 'rounds');

  let categoryPicker;
  if (!random) {
    const categoriesErrorMsg = categoriesError ? (
      <p role="alert" className="text-body-sm text-danger">
        {categoriesError}
      </p>
    ) : null;
    categoryPicker = (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose up to 3 categories">
          {CATEGORIES.map((category) => {
            const on = selected.includes(category);
            return (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={on ? 'secondary' : 'outline'}
                aria-pressed={on}
                disabled={disabled || (!on && atCap)}
                onClick={() => toggleCategory(category)}
              >
                {CATEGORY_LABELS[category as SameBranchCategory]}
              </Button>
            );
          })}
        </div>
        <p className="text-caption text-text-subtle">
          {selected.length}/{MAX_CATEGORIES} chosen. Pick 1-3 categories, or switch to Random.
        </p>
        {categoriesErrorMsg}
      </div>
    );
  } else {
    categoryPicker = (
      <Badge variant="neutral" className="w-fit">
        Drawing from all 6 categories
      </Badge>
    );
  }

  const scoringHint =
    config.mode === 'coop'
      ? 'The whole grove pools every guess into one shared score.'
      : 'Every player scores their own closeness - most points wins.';

  const roundsErrorMsg = roundsError ? (
    <p id="same-branch-rounds-error" role="alert" className="text-body-sm text-danger">
      {roundsError}
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-text">Categories</span>
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
            Pick categories
          </Button>
        </div>

        {categoryPicker}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-text">Scoring</span>
        <div className="flex gap-2" role="group" aria-label="Scoring mode">
          <Button
            type="button"
            variant={config.mode !== 'coop' ? 'primary' : 'outline'}
            aria-pressed={config.mode !== 'coop'}
            disabled={disabled}
            onClick={() => set({ mode: 'free' })}
          >
            Free-for-all
          </Button>
          <Button
            type="button"
            variant={config.mode === 'coop' ? 'primary' : 'outline'}
            aria-pressed={config.mode === 'coop'}
            disabled={disabled}
            onClick={() => set({ mode: 'coop' })}
          >
            Co-op
          </Button>
        </div>
        <p className="text-caption text-text-subtle">{scoringHint}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="same-branch-rounds">Rounds</Label>
        <Input
          id="same-branch-rounds"
          type="number"
          inputMode="numeric"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          disabled={disabled}
          value={Number.isNaN(config.rounds) ? '' : config.rounds}
          onChange={(event) => set({ rounds: event.target.valueAsNumber })}
          aria-invalid={roundsError !== null}
          aria-describedby={roundsError ? 'same-branch-rounds-error' : undefined}
        />
        {roundsErrorMsg}
      </div>
    </div>
  );
}
