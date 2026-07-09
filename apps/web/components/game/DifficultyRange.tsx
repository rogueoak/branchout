'use client';

// The host's difficulty picker: a min-max range over the 1-10 scale (spec 0016). The engine draws
// questions whose rating falls in [min, max], so the host bounds how easy and how hard the game
// gets - the default 4-6 keeps it in a consistent middle band.
//
// Two native range inputs (a floor and a ceiling) rather than a custom dual-thumb slider: native
// `<input type="range">` is keyboard- and screen-reader-accessible for free, testable without
// portals (fireEvent.change), and styles on-theme via `accent-primary` - matching the repo's
// prefer-native-over-Radix rule. The two thumbs cannot cross: moving one past the other pushes the
// pair to the same value.

import { difficultyBand } from '../../lib/games/trivia/config';

interface DifficultyRangeProps {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  /** Range bounds (defaults 1-10). */
  floor?: number;
  ceiling?: number;
}

/** A plain-language summary of the chosen range, anchoring the numbers to Easy/Medium/Hard. */
function rangeLabel(min: number, max: number): string {
  const lo = difficultyBand(min);
  const hi = difficultyBand(max);
  const band = lo === hi ? lo : `${lo} to ${hi}`;
  return min === max ? `Just ${min} (${band})` : `${min} to ${max} (${band})`;
}

export function DifficultyRange({
  min,
  max,
  onChange,
  floor = 1,
  ceiling = 10,
}: DifficultyRangeProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-body-sm font-medium text-text" aria-hidden>
          Difficulty
        </span>
        <span className="text-body-sm text-text-muted" role="status" aria-live="polite">
          {rangeLabel(min, max)}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="difficulty-min" className="text-body-sm text-text-muted">
          Easiest (minimum)
        </label>
        <input
          id="difficulty-min"
          type="range"
          className="w-full accent-primary"
          min={floor}
          max={ceiling}
          step={1}
          value={min}
          // Clamp so the floor never passes the ceiling.
          onChange={(event) => onChange(Math.min(event.target.valueAsNumber, max), max)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="difficulty-max" className="text-body-sm text-text-muted">
          Hardest (maximum)
        </label>
        <input
          id="difficulty-max"
          type="range"
          className="w-full accent-primary"
          min={floor}
          max={ceiling}
          step={1}
          value={max}
          // Clamp so the ceiling never drops below the floor.
          onChange={(event) => onChange(min, Math.max(event.target.valueAsNumber, min))}
        />
      </div>

      <p className="text-body-sm text-text-subtle">1 is easiest, {ceiling} is hardest.</p>
    </div>
  );
}
