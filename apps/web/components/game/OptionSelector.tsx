'use client';

// A radio-style option selector: a vertical list of tappable cards, each a label + a one-line
// description, exactly one selected (spec 0068). Extracted from the lobby "Your mode" picker so the
// mode picker and the Trivia difficulty/rounds pickers all read the same. Presentational and
// controlled - the parent owns the value. Mobile-first: full-width cards that stack and stay legible
// at 360px.

import { Badge } from '@rogueoak/canopy';
import type { ReactNode } from 'react';

export interface SelectorOption<T extends string> {
  value: T;
  label: string;
  /** One line of copy under the label; optional so a bare label (a preset name) works too. */
  description?: ReactNode;
  /** Disable this one option (e.g. a mode a full game cannot take) without disabling the group. */
  disabled?: boolean;
}

interface OptionSelectorProps<T extends string> {
  /** Accessible name for the radiogroup. */
  ariaLabel: string;
  value: T;
  options: readonly SelectorOption<T>[];
  onChange: (value: T) => void;
  /** Disable the whole group (e.g. while the game is starting). */
  disabled?: boolean;
  /** Text for a small badge on the selected option; omit to show no badge. */
  selectedBadge?: string;
}

export function OptionSelector<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  selectedBadge,
}: OptionSelectorProps<T>) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        const optionDisabled = disabled || option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={optionDisabled}
            onClick={() => onChange(option.value)}
            className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors ${
              selected
                ? 'border-primary bg-primary/10'
                : 'border-border bg-surface-raised hover:border-border-strong'
            } ${optionDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span className="flex items-center gap-2 text-body font-medium text-text">
              {option.label}
              {selected && selectedBadge ? <Badge variant="primary">{selectedBadge}</Badge> : null}
            </span>
            {option.description ? (
              <span className="text-body-sm text-text-muted">{option.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
