// Checkers's board CHROME (spec 0055): the piece colors, the king crown color, and the wood-grain
// square tints - the Checkers-specific paint that layers on top of the game-agnostic geometry in
// ../board/geometry.ts. The geometry (layout + hit-test) is the SAME reusable module Reversi uses
// (spec 0054): Checkers imports it directly and defines only its own piece chrome here, keeping
// game-specific piece colors OUT of the shared renderer.
//
// This file re-exports the agnostic geometry for the Checkers Viewer's convenience, so the Viewer
// imports one board module.

import { readCssVar, type BoardSurface } from '../board/geometry';

// Re-export the agnostic geometry so the Checkers Viewer imports layout + hit-test from one place.
export { cellAt, cellBox, layoutBoard, type BoardLayout, type CellBox } from '../board/geometry';

/**
 * The concrete canvas colors for Checkers: the shared board surface (wood squares + lines + text) plus
 * the two piece colors, their rims, and the gold crown a King wears. NO mismatched hardcoded brand
 * hex: every fallback is the exact value of the token it fronts. The piece colors come from the same
 * brand ramps Reversi's discs use - Violet from grape, Amber from sunbeam - so the two board games
 * read as one family; the crown is the family gold-root token, so a King's rank is unmistakable.
 */
export interface BoardChrome extends BoardSurface {
  /** The two piece colors (Violet = grape, Amber = sunbeam) and their rims. */
  violet: string;
  violetRim: string;
  amber: string;
  amberRim: string;
  /** The gold crown stroke a crowned King wears (the family gold-root tone). */
  crown: string;
  /** The legal-source / target highlight ring. */
  highlight: string;
}

/**
 * Resolve Checkers's board chrome from Branch Out theme tokens, reading the CSS custom properties off
 * the given element's computed style with fallbacks for SSR / first paint.
 *
 * The board is genuinely WOOD-TONED: the square tints come from the WARM honey ramp (a shared
 * primitive, theme-independent), not the cool stone surface ramp - matching Reversi's board - so the
 * shipped dark theme renders warm brown wood. The piece colors come from the brand ramps: Violet from
 * grape (`--color-grape-500`), Amber from sunbeam (`--color-sunbeam-400`); the King crown is the
 * gold-root tone (`--color-honey-400`, fronting the family gold #d2a463-adjacent warm gold).
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
    // Violet pieces = grape (the primary brand ramp); Amber pieces = sunbeam (the accent ramp).
    violet: read('--color-grape-500', '#8b5cf6'),
    violetRim: read('--color-grape-700', '#6d28d9'),
    amber: read('--color-sunbeam-400', '#facc15'),
    amberRim: read('--color-sunbeam-600', '#ca8a04'),
    // The King crown: a warm gold, the family gold-root tone.
    crown: read('--color-honey-300', '#fcd34d'),
    // The legal-move highlight ring: the primary token (grape), tinted at draw time per turn.
    highlight: read('--color-grape-400', '#a78bfa'),
  };
}
