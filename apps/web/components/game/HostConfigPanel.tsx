'use client';

// The host's Trivia setup: category, rounds, and difficulty, validated against the engine's
// ranges (spec 0008) before the host can start. Presentational and controlled - the parent owns
// the config value and the start action; this panel renders the form, surfaces per-field errors,
// and shows the single reason a start is blocked.
//
// The category uses a native <select> styled with canopy's `inputVariants` recipe rather than the
// Radix `Select`: the picker is a plain enum, and a native control stays keyboard/screen-reader
// accessible and testable without portals - while still composing canopy's styling and theme
// tokens (no hardcoded colors).

import { Button, Input, Label, inputVariants } from '@rogueoak/canopy';
import {
  CONFIGURABLE_CATEGORIES,
  MAX_DIFFICULTY,
  MAX_ROUNDS,
  MIN_DIFFICULTY,
  MIN_ROUNDS,
  validateTriviaConfig,
  type ConfigError,
  type TriviaHostConfig,
} from '../../lib/trivia-config';

interface HostConfigPanelProps {
  value: TriviaHostConfig;
  onChange: (next: TriviaHostConfig) => void;
  onStart: () => void;
  /** True once at least one viewer (observer or interactive player) is present. */
  hasViewer: boolean;
  /**
   * True when the blocked-start can be fixed by the host alone - a remote host that is the only
   * viewer-capable device. Then the "needs a viewer" copy points at the host's own mode toggle
   * ("switch yourself to Interactive") instead of "wait for someone to join".
   */
  hostCanSelfFix?: boolean;
  /** A start in flight - disables the button and shows a busy label. */
  starting: boolean;
  /** The server's reason a start was refused (e.g. insufficient credits), shown as-is. */
  serverReason: string | null;
}

function errorFor(errors: ConfigError[], field: ConfigError['field']): string | null {
  return errors.find((error) => error.field === field)?.message ?? null;
}

export function HostConfigPanel({
  value,
  onChange,
  onStart,
  hasViewer,
  hostCanSelfFix = false,
  starting,
  serverReason,
}: HostConfigPanelProps) {
  const errors = validateTriviaConfig(value);
  const configValid = errors.length === 0;

  // One plain reason the start is blocked, in priority order. `serverReason` (e.g. an
  // affordability refusal the server returned) is shown once known, after the client-side gates.
  // When no viewer is present, the copy is host-aware: a remote host that is the only
  // viewer-capable device can fix it itself, so point at its own toggle rather than "wait".
  const noViewerReason = hostCanSelfFix
    ? "You're the only viewer-capable device here. Switch yourself to Interactive above to start."
    : 'Waiting for a viewer to join - an observer or an interactive player.';
  const blockedReason = !hasViewer
    ? noViewerReason
    : !configValid
      ? 'Fix the game settings to start.'
      : serverReason;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="trivia-category">Category</Label>
        <select
          id="trivia-category"
          className={inputVariants()}
          value={value.category}
          onChange={(event) => onChange({ ...value, category: event.target.value })}
        >
          {CONFIGURABLE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="trivia-rounds">Rounds</Label>
        <Input
          id="trivia-rounds"
          type="number"
          inputMode="numeric"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          value={Number.isNaN(value.rounds) ? '' : value.rounds}
          onChange={(event) => onChange({ ...value, rounds: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'rounds') !== null}
          aria-describedby={errorFor(errors, 'rounds') ? 'trivia-rounds-error' : undefined}
        />
        {errorFor(errors, 'rounds') ? (
          <p id="trivia-rounds-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'rounds')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="trivia-difficulty">Difficulty</Label>
        <Input
          id="trivia-difficulty"
          type="number"
          inputMode="numeric"
          min={MIN_DIFFICULTY}
          max={MAX_DIFFICULTY}
          value={Number.isNaN(value.difficulty) ? '' : value.difficulty}
          onChange={(event) => onChange({ ...value, difficulty: event.target.valueAsNumber })}
          aria-invalid={errorFor(errors, 'difficulty') !== null}
          aria-describedby={errorFor(errors, 'difficulty') ? 'trivia-difficulty-error' : undefined}
        />
        {errorFor(errors, 'difficulty') ? (
          <p id="trivia-difficulty-error" role="alert" className="text-body-sm text-danger">
            {errorFor(errors, 'difficulty')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={onStart}
          disabled={!hasViewer || !configValid || starting}
        >
          {starting ? 'Starting...' : 'Start game'}
        </Button>
        {blockedReason ? (
          <p role="status" className="text-body-sm text-text-muted">
            {blockedReason}
          </p>
        ) : null}
      </div>
    </div>
  );
}
