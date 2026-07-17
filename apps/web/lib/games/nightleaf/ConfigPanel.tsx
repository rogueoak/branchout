'use client';

// Nightleaf's host config FORM for the game-pluggable lobby (spec 0060): how many tiers the grove
// climbs, how many buds (lives) the group starts with, and how many fireflies (shared hushes). Form-
// only and controlled - the parent (the lobby shell) owns the value and the Start gating, so this
// matches the generic `GameConfigPanelProps` (value/onChange/disabled). Validates against the engine's
// rules so the host cannot start an invalid game. Mobile-first: a single stacked column at 360px.

import { Input, Label } from '@rogueoak/canopy';
import type { GameConfigPanelProps } from '../registry';
import {
  MAX_BUDS,
  MAX_FIREFLIES,
  MAX_TIERS,
  MIN_BUDS,
  MIN_FIREFLIES,
  MIN_TIERS,
  validateNightleafConfig,
  type ConfigError,
  type NightleafHostConfig,
} from './config';

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function NightleafConfigPanel({ value, onChange, disabled }: GameConfigPanelProps) {
  const config = value as NightleafHostConfig;
  const errors = validateNightleafConfig(config);
  const set = (next: Partial<NightleafHostConfig>) => onChange({ ...config, ...next });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-sm text-text-muted">
        Nightleaf is a silent co-op climb. No talking about your leaves - play them in order
        together.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="nightleaf-tiers">Tiers</Label>
        <Input
          id="nightleaf-tiers"
          type="number"
          inputMode="numeric"
          min={MIN_TIERS}
          max={MAX_TIERS}
          disabled={disabled}
          value={Number.isNaN(config.tiers) ? '' : config.tiers}
          onChange={(event) => set({ tiers: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'tiers') !== null}
          aria-describedby={errorFor(errors, 'tiers') ? 'nightleaf-tiers-error' : undefined}
        />
        <p className="text-caption text-text-subtle">
          Tier N deals N leaves to each player. Clear the final tier to win.
        </p>
        {errorFor(errors, 'tiers') ? (
          <p id="nightleaf-tiers-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'tiers')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="nightleaf-buds">Buds (lives)</Label>
        <Input
          id="nightleaf-buds"
          type="number"
          inputMode="numeric"
          min={MIN_BUDS}
          max={MAX_BUDS}
          disabled={disabled}
          value={Number.isNaN(config.buds) ? '' : config.buds}
          onChange={(event) => set({ buds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'buds') !== null}
          aria-describedby={errorFor(errors, 'buds') ? 'nightleaf-buds-error' : undefined}
        />
        <p className="text-caption text-text-subtle">
          Play out of order and the grove loses a bud.
        </p>
        {errorFor(errors, 'buds') ? (
          <p id="nightleaf-buds-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'buds')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="nightleaf-fireflies">Fireflies (hushes)</Label>
        <Input
          id="nightleaf-fireflies"
          type="number"
          inputMode="numeric"
          min={MIN_FIREFLIES}
          max={MAX_FIREFLIES}
          disabled={disabled}
          value={Number.isNaN(config.fireflies) ? '' : config.fireflies}
          onChange={(event) => set({ fireflies: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'fireflies') !== null}
          aria-describedby={errorFor(errors, 'fireflies') ? 'nightleaf-fireflies-error' : undefined}
        />
        <p className="text-caption text-text-subtle">
          Spend a firefly for a hush: everyone drops their lowest leaf at once.
        </p>
        {errorFor(errors, 'fireflies') ? (
          <p id="nightleaf-fireflies-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'fireflies')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
