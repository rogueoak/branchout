// The in-round countdown colour rule (spec 0069). The answer time limit is host-configurable, so
// the escalation thresholds are a PERCENTAGE of the whole window, not a fixed second count: a 20s
// limit and a 180s limit both warn at the same fraction remaining. `neutral` to start, `warning`
// once <=30% of the window is left, `danger` once <=10% is left (the caller also blinks it, motion
// permitting). Pure and side-effect-free so the thresholds are unit-testable.

export type CountdownTone = 'neutral' | 'warning' | 'danger';

/** Fraction remaining at/below which the countdown turns `warning`, then `danger`. */
export const WARNING_FRACTION = 0.3;
export const DANGER_FRACTION = 0.1;

/**
 * The tone for `secondsLeft` given the total window in ms. When the total is unknown (a peer
 * predating the field), fall back to fixed second thresholds so the colour still escalates near
 * the end rather than staying neutral to zero.
 */
export function countdownTone(secondsLeft: number, totalMs: number | null): CountdownTone {
  if (totalMs == null || totalMs <= 0) {
    if (secondsLeft <= 5) return 'danger';
    if (secondsLeft <= 15) return 'warning';
    return 'neutral';
  }
  const fraction = secondsLeft / (totalMs / 1000);
  if (fraction <= DANGER_FRACTION) return 'danger';
  if (fraction <= WARNING_FRACTION) return 'warning';
  return 'neutral';
}
