'use client';

// Odd Bird's host config FORM for the game-pluggable lobby (spec 0023): a Random toggle and a
// multi-select of roost categories. Form-only and controlled - the parent (the lobby shell) owns the
// value and the Start gating, so this matches the generic `GameConfigPanelProps` (value/onChange/
// disabled) every game uses. Validates against the engine's rules so the host cannot start an invalid
// game.

import { Badge, Button } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  CATEGORIES,
  isCategoryList,
  validateOddBirdConfig,
  type ConfigError,
  type OddBirdHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

/** Title-case a category slug for display ("everyday" -> "Everyday"). */
function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function OddBirdConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as OddBirdHostConfig;
  const errors = validateOddBirdConfig(config);
  const random = !isCategoryList(config.categories);
  const selected = isCategoryList(config.categories) ? config.categories : [];

  const set = (next: Partial<OddBirdHostConfig>) => onChange({ ...config, ...next });

  const toggleCategory = (category: string) => {
    const isOn = selected.includes(category);
    const next = isOn ? selected.filter((c) => c !== category) : [...selected, category];
    set({ categories: next });
  };

  const categoriesError = errorFor(errors, 'categories');
  let categoriesPicker;
  if (!random) {
    let categoriesErrorLine = null;
    if (categoriesError) {
      categoriesErrorLine = (
        <p role="alert" className="text-body-sm text-danger">
          {categoriesError}
        </p>
      );
    }
    categoriesPicker = (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose roost categories">
          {CATEGORIES.map((category) => {
            const on = selected.includes(category);
            const categoryVariant = on ? 'secondary' : 'outline';
            return (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={categoryVariant}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggleCategory(category)}
              >
                {label(category)}
              </Button>
            );
          })}
        </div>
        <p className="text-caption text-text-subtle">
          {selected.length} chosen. Pick one or more categories, or switch to Random.
        </p>
        {categoriesErrorLine}
      </div>
    );
  } else {
    categoriesPicker = (
      <Badge variant="neutral" className="w-fit">
        Drawing from all {CATEGORIES.length} categories
      </Badge>
    );
  }

  const randomVariant = random ? 'primary' : 'outline';
  const pickVariant = !random ? 'primary' : 'outline';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-text">Roost categories</span>
        <div className="flex gap-2" role="group" aria-label="Category selection">
          <Button
            type="button"
            variant={randomVariant}
            aria-pressed={random}
            disabled={disabled}
            onClick={() => set({ categories: 'random' })}
          >
            Random (all)
          </Button>
          <Button
            type="button"
            variant={pickVariant}
            aria-pressed={!random}
            disabled={disabled}
            onClick={() => set({ categories: selected.length > 0 ? selected : [CATEGORIES[0]] })}
          >
            Pick categories
          </Button>
        </div>

        {categoriesPicker}
      </div>

      <p className="text-body-sm text-text-muted">
        Odd Bird seats 3 to 8 players. Everyone gets the same roost and a secret perch - except one
        odd bird, who is told only that they do not know the roost.
      </p>
    </div>
  );
}
