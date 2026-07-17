// Reversi's board CHROME (spec 0054): the disc colors, the wood-grain square tints, and the
// legal-move hint - the Reversi-specific paint that layers on top of the game-agnostic geometry in
// ../board/geometry.ts. The geometry (layout + hit-test) is reused as-is by Checkers/Chess; the disc
// semantics here (two disc colors, a side-tinted hint) are Reversi's own, so they live with the
// Reversi UI rather than in the shared board module.
//
// This file re-exports the agnostic geometry for the Reversi Viewer's convenience, so the Viewer
// imports one board module. A future Checkers/Chess Viewer imports ../board/geometry directly and
// defines its OWN chrome.

import { readCssVar, type BoardSurface } from '../board/geometry';

// Re-export the agnostic geometry so the Reversi Viewer imports layout + chrome from one place.
export { cellAt, cellBox, layoutBoard, type BoardLayout, type CellBox } from '../board/geometry';

/**
 * The concrete canvas colors for Reversi: the shared board surface (wood squares + lines + text) plus
 * the two disc colors and their rims. The legal-move HINT is not a fixed color here - it is tinted to
 * the side to move at draw time (see the Viewer), so a violet turn shows violet hints and an amber
 * turn shows amber hints, never a fixed third color that reads as one of the sides.
 */
export interface BoardChrome extends BoardSurface {
  /** The two disc colors (Violet = grape, Amber = sunbeam) and their rims. */
  violet: string;
  violetRim: string;
  amber: string;
  amberRim: string;
}

/**
 * Resolve Reversi's board chrome from Branch Out theme tokens, reading the CSS custom properties off
 * the given element's computed style with fallbacks for SSR / first paint. NO mismatched hardcoded
 * brand hex: every fallback is the exact value of the token it fronts.
 *
 * The board is genuinely WOOD-TONED: the square tints come from the WARM honey ramp (a shared
 * primitive, theme-independent), not the cool stone surface ramp - so the shipped dark theme renders
 * warm brown wood, not grey-purple stone, and the pre-paint fallback matches the live look. The disc
 * colors come from the brand ramps: Violet from grape (`--color-grape-500`), Amber from sunbeam
 * (`--color-sunbeam-400`).
 */
export function resolveBoardChrome(el: Element | null): BoardChrome {
  const read = (name: string, fallback: string): string => readCssVar(el, name, fallback);
  return {
    // Wood-grain squares from the WARM honey ramp (theme-independent primitives). Fallbacks are the
    // exact honey token hex, so the pre-paint canvas already looks like warm wood, not cool stone.
    light: read('--color-honey-800', '#92400e'),
    dark: read('--color-honey-950', '#451a03'),
    line: read('--color-honey-900', '#78350f'),
    text: read('--color-text', '#f4f4f5'),
    // Violet discs = grape (the primary brand ramp); Amber discs = sunbeam (the accent ramp).
    violet: read('--color-grape-500', '#8b5cf6'),
    violetRim: read('--color-grape-700', '#6d28d9'),
    amber: read('--color-sunbeam-400', '#facc15'),
    amberRim: read('--color-sunbeam-600', '#ca8a04'),
  };
}
