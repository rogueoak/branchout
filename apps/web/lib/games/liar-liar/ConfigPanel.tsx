'use client';

// Liar Liar's host config FORM for the game-pluggable lobby (spec 0023): a Random toggle, a capped
// multi-select of up to three categories, and a round count. Form-only and controlled - the parent
// (the lobby shell) owns the value and the Start gating, so this matches the generic
// `GameConfigPanelProps` (value/onChange/disabled) every game uses. Validates against the engine's
// rules (spec 0021) so the host cannot start an invalid game.

import { Badge, Button, Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  CATEGORIES,
  MAX_CATEGORIES,
  MAX_ROUNDS,
  MIN_ROUNDS,
  isCategoryList,
  validateLiarLiarConfig,
  type ConfigError,
  type LiarLiarHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

/** Title-case a category slug for display ("food" -> "Food"). */
function label(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function LiarLiarConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as LiarLiarHostConfig;
  const errors = validateLiarLiarConfig(config);
  const random = !isCategoryList(config.categories);
  const selected = isCategoryList(config.categories) ? config.categories : [];
  const atCap = selected.length >= MAX_CATEGORIES;

  const set = (next: Partial<LiarLiarHostConfig>) => onChange({ ...config, ...next });

  const toggleCategory = (category: string) => {
    const isOn = selected.includes(category);
    const next = isOn ? selected.filter((c) => c !== category) : [...selected, category];
    set({ categories: next });
  };

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

        {!random ? (
          <div className="flex flex-col gap-2">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Choose up to 3 categories"
            >
              {CATEGORIES.map((category) => {
                const on = selected.includes(category);
                return (
                  <Button
                    key={category}
                    type="button"
                    size="sm"
                    variant={on ? 'secondary' : 'outline'}
                    aria-pressed={on}
                    // Cap at three: an unchecked category is disabled once the cap is reached.
                    disabled={disabled || (!on && atCap)}
                    onClick={() => toggleCategory(category)}
                  >
                    {label(category)}
                  </Button>
                );
              })}
            </div>
            <p className="text-caption text-text-subtle">
              {selected.length}/{MAX_CATEGORIES} chosen. Pick 1-3 categories, or switch to Random.
            </p>
            {errorFor(errors, 'categories') ? (
              <p role="alert" className="text-body-sm text-danger">
                {errorFor(errors, 'categories')}
              </p>
            ) : null}
          </div>
        ) : (
          <Badge variant="neutral" className="w-fit">
            Drawing from all 8 categories
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="liar-liar-rounds">Rounds</Label>
        <Input
          id="liar-liar-rounds"
          type="number"
          inputMode="numeric"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          disabled={disabled}
          value={Number.isNaN(config.rounds) ? '' : config.rounds}
          onChange={(event) => set({ rounds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'rounds') !== null}
          aria-describedby={errorFor(errors, 'rounds') ? 'liar-liar-rounds-error' : undefined}
        />
        {errorFor(errors, 'rounds') ? (
          <p id="liar-liar-rounds-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'rounds')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
