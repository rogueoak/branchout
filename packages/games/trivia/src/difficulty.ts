// Difficulty as a host-picked min-max range (spec 0016). Every question carries an integer 1-10
// rating; the host bounds the range they want to play (default 4-6), and the per-round draw
// (selection.ts) picks a question whose rating falls in [min, max], widening to the nearest rating
// only when the range is exhausted. The old 1-10-setting blend table is gone: a single number could
// not express "consistent middle difficulty", so questions were re-rated on a real 1-10 scale and
// the host now sets a floor and a ceiling instead.

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

/** The default range a fresh game plays: the "Medium" preset band (spec 0068). */
export const DEFAULT_DIFFICULTY_MIN = 3;
export const DEFAULT_DIFFICULTY_MAX = 6;

/** True for an integer difficulty bound inside the supported 1-10 range. */
export function isValidDifficultyBound(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DIFFICULTY && value <= MAX_DIFFICULTY;
}

/** True when both bounds are valid and min <= max. */
export function isValidDifficultyRange(min: number, max: number): boolean {
  return isValidDifficultyBound(min) && isValidDifficultyBound(max) && min <= max;
}
