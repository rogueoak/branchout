/** Brand palette hex values. */
export const palette = {
  /** Warm amber - the spark gradient start. */
  gold: '#FBBF24',
  /** Hot pink - the spark gradient midpoint. */
  pink: '#EC4899',
  /** Deep violet - the spark gradient end. */
  violet: '#7C3AED',
  /** Muted gold - the gold root node. Always present; do not remove or recolor. */
  goldRoot: '#d2a463',
  /** Near-black canvas - the dark panel background. */
  darkBg: '#0d0a15',
  /** Muted panel - the tile background in the logo lockup. */
  panelBg: '#0d1117',
} as const;

/**
 * The gold root node rule.
 *
 * Every Branch out mark carries a single gold node at the root of the branch tree (#d2a463).
 * It grounds the upward-branching structure and ties the family mark to the rogueoak oak.
 * Do not remove it, recolor it, or move it to a non-root position.
 */
export const goldRootRule =
  'The root node is always gold (#d2a463). Do not recolor or remove it.';

/**
 * Safe-area guidance.
 *
 * Maintain at least 10% of the shorter dimension as clear space around the mark
 * on all sides. Do not place text, other logos, or decorative elements inside
 * the safe area.
 */
export const safeArea = 'Clear space >= 10% of the shorter dimension on all sides.';

/** Spark gradient: warm at root (gold), cool at tips (violet). Do not invert. */
export const sparkGradient = {
  from: palette.gold,
  mid: palette.pink,
  to: palette.violet,
  rule: 'Warm at root, cool at tips. Do not invert.',
} as const;
