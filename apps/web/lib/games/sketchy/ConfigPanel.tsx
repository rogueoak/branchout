'use client';

// Sketchy's STANDARD host config FORM for the game-pluggable lobby (spec 0063, pacing per spec 0068):
// a round (cycle) count via presets + a custom number field. Form-only and controlled - the parent
// (the lobby shell) owns the value and the Start gating, so this matches the generic
// `GameConfigPanelProps` (value/onChange/disabled). The auto-advance pacing lives in a separate
// AdvancedConfigPanel rendered into the lobby's Advanced slot. Validates against the engine's rule so
// the host cannot start an invalid game.

import { useState } from 'react';
import { Input, Label } from '@rogueoak/canopy';
import { OptionSelector, type SelectorOption } from '../../../components/game/OptionSelector';
import type { GameConfigPanelProps } from '../registry';
import {
  MAX_ROUNDS,
  MIN_ROUNDS,
  ROUND_PRESETS,
  validateSketchyConfig,
  type ConfigError,
  type SketchyHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function SketchyConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as SketchyHostConfig;
  const errors = validateSketchyConfig(config);
  const set = (next: Partial<SketchyHostConfig>) => onChange({ ...config, ...next });

  // Rounds: a preset selector plus a custom number field. A round count that matches no preset (or an
  // explicit "Custom" choice) reveals the number field.
  const roundsPreset = ROUND_PRESETS.find((preset) => preset.value === config.rounds);
  const [customRounds, setCustomRounds] = useState(!roundsPreset);
  const roundsValue = roundsPreset && !customRounds ? String(config.rounds) : 'custom';
  const roundOptions: SelectorOption<string>[] = [
    ...ROUND_PRESETS.map((preset) => ({
      value: String(preset.value),
      // Name reads cleanly (Fast / Standard / Long / Marathon); the round count lives in the
      // description line below, never bracketed into the name (WS12).
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

  const roundsError = errorFor(errors, 'rounds');

  return (
    <div className="flex flex-col gap-5">
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
            <Label htmlFor="sketchy-rounds">Custom rounds</Label>
            <Input
              id="sketchy-rounds"
              type="number"
              inputMode="numeric"
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              disabled={disabled}
              value={Number.isNaN(config.rounds) ? '' : config.rounds}
              onChange={(event) => set({ rounds: event.target.valueAsNumber })}
              aria-invalid={roundsError !== null}
              aria-describedby={roundsError ? 'sketchy-rounds-error' : undefined}
            />
          </div>
        ) : null}
        <p className="text-caption text-text-subtle">
          Each round, everyone draws their own secret seed, then guesses the true seed behind every
          sketch.
        </p>
        {roundsError ? (
          <p id="sketchy-rounds-error" role="alert" className="text-body-sm text-danger">
            {roundsError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
