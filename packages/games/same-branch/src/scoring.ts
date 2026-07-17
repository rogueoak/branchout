// Same Branch scoring: closeness of the sap line to the bud, in bands. The branch is a 0-100 dial;
// the bud is a hidden target position on it. A guess scores by how close it lands to the bud - a
// bullseye at the exact spot, then two narrowing near-bands, then a miss. Pure integer arithmetic so
// a seeded round scores identically everywhere and the bands are trivial to unit-test.

/** The scoreable range of the branch: 0 (root) to 100 (tip), inclusive. */
export const BRANCH_MIN = 0;
export const BRANCH_MAX = 100;

/** Points for landing the sap line inside the bud's bullseye band (|distance| <= this radius). */
export const BULLSEYE_POINTS = 4;
export const BULLSEYE_RADIUS = 4;

/** Points for the first near band (just outside the bullseye). */
export const NEAR_POINTS = 3;
export const NEAR_RADIUS = 10;

/** Points for the second, wider near band. */
export const FAR_POINTS = 2;
export const FAR_RADIUS = 18;

/** A guess outside every band scores nothing. */
export const MISS_POINTS = 0;

/** Clamp a raw dial value onto the branch [0, 100]. */
export function clampToBranch(value: number): number {
  if (value < BRANCH_MIN) return BRANCH_MIN;
  if (value > BRANCH_MAX) return BRANCH_MAX;
  return value;
}

/**
 * Score one guess against the bud by absolute distance. Both are clamped to the branch first so an
 * out-of-range value can never over- or under-score. The bands are inclusive and nested (a bullseye
 * distance also satisfies the wider bands, so order matters - check tightest first).
 */
export function scoreGuess(bud: number, guess: number): number {
  const distance = Math.abs(clampToBranch(bud) - clampToBranch(guess));
  if (distance <= BULLSEYE_RADIUS) return BULLSEYE_POINTS;
  if (distance <= NEAR_RADIUS) return NEAR_POINTS;
  if (distance <= FAR_RADIUS) return FAR_POINTS;
  return MISS_POINTS;
}

/** A short, on-theme label for the band a distance falls in - shown in the reveal. */
export function bandLabel(bud: number, guess: number): string {
  const points = scoreGuess(bud, guess);
  if (points === BULLSEYE_POINTS) return 'bullseye';
  if (points === NEAR_POINTS) return 'close';
  if (points === FAR_POINTS) return 'near';
  return 'miss';
}
