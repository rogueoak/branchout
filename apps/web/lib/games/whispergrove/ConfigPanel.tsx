'use client';

// Whispergrove's host config FORM (spec 0062, spec 0023): a multi-select of the word categories the
// grove's 25 leaves are drawn from. The board is always a 5x5 grove with the fixed 9/8/7/1 key split,
// so there is nothing numeric to tune. Form-only and controlled - the parent (the lobby shell) owns
// the value and the Start gating - matching the generic GameConfigPanelProps. Mirrors the engine's
// validator (the engine re-checks) so a host cannot start an invalid game.

import { Badge, Button } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import { CATEGORIES, categoryLabel, defaultConfig, type WhispergroveHostConfig } from './config';

export function WhispergroveConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = (value as WhispergroveHostConfig) ?? defaultConfig();
  const selected = Array.isArray(config.categories) ? config.categories : [...CATEGORIES];

  const toggle = (category: string) => {
    const isOn = selected.includes(category as (typeof CATEGORIES)[number]);
    // Never let the host clear the last category - keep at least one so the grove can fill.
    const next = isOn
      ? selected.filter((c) => c !== category)
      : [...selected, category as (typeof CATEGORIES)[number]];
    onChange({ categories: next.length > 0 ? next : selected });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-text">Word categories</span>
        <p className="text-body-sm text-text-subtle">
          The 25 leaves are drawn from the categories you pick. Two groves race to link their
          leaves; never wake the Deadwood.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose word categories">
          {CATEGORIES.map((category) => {
            const on = selected.includes(category);
            return (
              <Button
                key={category}
                type="button"
                variant={on ? 'primary' : 'outline'}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggle(category)}
              >
                {categoryLabel(category)}
              </Button>
            );
          })}
        </div>
        {selected.length === 0 ? (
          <Badge variant="danger" className="w-fit">
            Pick at least one category.
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
