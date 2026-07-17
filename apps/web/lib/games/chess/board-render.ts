// Chess's board CHROME (spec 0056): the piece colors, the wood-grain square tints, and the move hints -
// the Chess-specific paint that layers on top of the game-agnostic geometry in ../board/geometry.ts.
// The geometry (layout + hit-test) is reused as-is from Reversi/Checkers; the piece semantics here (two
// army colors, a check highlight, drawing a piece as a Unicode chess glyph) are Chess's own, so they
// live with the Chess UI rather than in the shared board module.
//
// This file re-exports the agnostic geometry for the Chess Viewer's convenience, so the Viewer imports
// one board module.

import { readCssVar, type BoardSurface } from '../board/geometry';
import type { Cell, Color, PieceType } from './protocol';

// Re-export the agnostic geometry so the Chess Viewer imports layout + hit-test from one place.
export { cellAt, cellBox, layoutBoard, type BoardLayout, type CellBox } from '../board/geometry';

/**
 * The concrete canvas colors for Chess: the shared board surface (wood squares + lines + text) plus the
 * two army colors and their outlines, and the highlights for the selected square, its legal
 * destinations, and a king in check. Violet (White) = grape; Amber (Black) = sunbeam - the same brand
 * ramps Reversi uses - so the family reads consistently. No mismatched hardcoded brand hex: every
 * fallback is the exact value of the token it fronts.
 */
export interface BoardChrome extends BoardSurface {
  /** The two army fills (Violet = White = grape; Amber = Black = sunbeam) and their outlines. */
  violet: string;
  violetRim: string;
  amber: string;
  amberRim: string;
  /** The selected-square wash and the legal-destination dot. */
  select: string;
  hint: string;
  /** The king-in-check danger wash. */
  danger: string;
}

/**
 * Resolve Chess's board chrome from Branch Out theme tokens, reading the CSS custom properties off the
 * given element's computed style with fallbacks for SSR / first paint. The board is genuinely
 * WOOD-TONED (the warm honey ramp, theme-independent), like Reversi's, so the checkerboard reads as warm
 * wood, not cool stone.
 */
export function resolveBoardChrome(el: Element | null): BoardChrome {
  const read = (name: string, fallback: string): string => readCssVar(el, name, fallback);
  return {
    // Wood-grain squares from the WARM honey ramp (theme-independent primitives).
    light: read('--color-honey-800', '#92400e'),
    dark: read('--color-honey-950', '#451a03'),
    line: read('--color-honey-900', '#78350f'),
    text: read('--color-text', '#f4f4f5'),
    // Violet (White) pieces = grape; Amber (Black) pieces = sunbeam.
    violet: read('--color-grape-200', '#ddd6fe'),
    violetRim: read('--color-grape-700', '#6d28d9'),
    amber: read('--color-sunbeam-300', '#fde047'),
    amberRim: read('--color-sunbeam-700', '#a16207'),
    select: read('--color-grape-400', '#a78bfa'),
    hint: read('--color-grape-300', '#c4b5fd'),
    danger: read('--color-danger', '#ef4444'),
  };
}

/**
 * The Unicode glyph for a piece type, drawn filled and tinted to the army color. The SOLID (nominally
 * "black") chess glyphs are used for BOTH armies - the fill color distinguishes Violet from Amber - so
 * every piece reads as a solid, legible shape at 360px. Written as \u escapes to keep this source file
 * ASCII-only (Trellis language rule); the runtime string is the real glyph.
 */
const GLYPH: Record<PieceType, string> = {
  K: '\u265A', // solid king
  Q: '\u265B', // solid queen
  R: '\u265C', // solid rook
  B: '\u265D', // solid bishop
  N: '\u265E', // solid knight
  P: '\u265F', // solid pawn
};

/** The color + type of a piece cell, or null for an empty square. Small decode used by the renderer. */
export function decodePiece(cell: Cell): { color: Color; type: PieceType } | null {
  if (cell === 'empty') return null;
  return { color: cell[0] as Color, type: cell[1] as PieceType };
}

/** The Unicode glyph for a piece type. */
export function glyphFor(type: PieceType): string {
  return GLYPH[type];
}
