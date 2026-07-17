// The reusable single-surface board RENDERER helper (spec 0054). Reversi is the first board game; its
// board view is the pattern Checkers and Chess follow, so the game-AGNOSTIC layout math lives here,
// separate from Reversi's disc drawing (in Viewer.tsx). This is pure geometry + token resolution - no
// React, no game rules - so it is trivially unit-testable (the jsdom canvas the Viewer draws on is not
// exercisable, but this math is).
//
// What this owns: the square-board layout (fit an NxN grid into the available box, centered, with a
// margin), the screen<->cell mapping both directions (draw a cell, and hit-test a tap back to a cell),
// and resolving the wood-grain + disc theme tokens into concrete canvas color strings. A board game
// draws its own pieces given a `CellBox`.

/** The pixel box of one cell on screen: top-left corner + size (square). */
export interface CellBox {
  x: number;
  y: number;
  size: number;
}

/** The board's on-screen layout: where the grid sits and how big each cell is. */
export interface BoardLayout {
  /** The board's top-left corner within the canvas (css px). */
  originX: number;
  originY: number;
  /** One cell's side length (css px). */
  cell: number;
  /** The grid dimension (cells per side). */
  size: number;
}

/**
 * Lay out an `size` x `size` board centered in a `width` x `height` box, as large as fits with a small
 * uniform margin. The board is square (min of the two axes drives the fit), so it reads well from
 * ~360px up. Pure: given the same inputs it returns the same layout, so a tap hit-test and the draw
 * loop agree exactly.
 */
export function layoutBoard(width: number, height: number, size: number, margin = 8): BoardLayout {
  const box = Math.max(0, Math.min(width, height) - margin * 2);
  const cell = size > 0 ? box / size : 0;
  const board = cell * size;
  return {
    originX: (width - board) / 2,
    originY: (height - board) / 2,
    cell,
    size,
  };
}

/** The pixel box of cell `{row,col}` under a layout (for drawing a square/disc). */
export function cellBox(layout: BoardLayout, row: number, col: number): CellBox {
  return {
    x: layout.originX + col * layout.cell,
    y: layout.originY + row * layout.cell,
    size: layout.cell,
  };
}

/**
 * Hit-test a canvas-local pixel `{px,py}` back to a board cell, or null if it falls outside the grid.
 * The inverse of {@link cellBox}: a tap anywhere on the board resolves to the cell it lands in. Used
 * by the Viewer's tap handler to turn a touch into a placement.
 */
export function cellAt(
  layout: BoardLayout,
  px: number,
  py: number,
): { row: number; col: number } | null {
  if (layout.cell <= 0) return null;
  const col = Math.floor((px - layout.originX) / layout.cell);
  const row = Math.floor((py - layout.originY) / layout.cell);
  if (row < 0 || row >= layout.size || col < 0 || col >= layout.size) return null;
  return { row, col };
}

/** The concrete canvas colors for the board scenery + the two disc colors, resolved from theme tokens. */
export interface BoardChrome {
  /** The two alternating wood-grain square tints. */
  light: string;
  dark: string;
  /** The grid line + board border. */
  line: string;
  /** The two disc colors (Violet = grape, Amber = sunbeam) and their rims. */
  violet: string;
  violetRim: string;
  amber: string;
  amberRim: string;
  /** The legal-move hint dot. */
  hint: string;
  text: string;
}

/**
 * Resolve the board chrome from Branch Out theme tokens (the canopy grape/sunbeam families), reading
 * the CSS custom properties off the given element's computed style with on-brand fallbacks for SSR /
 * first paint. NO hardcoded brand hex in the component: the disc colors come from `--color-primary`
 * (grape/violet) and `--color-accent` (sunbeam/amber); the wood grain from surface tones. Fallbacks
 * mirror the token values so a canvas rendered before styles apply still looks right.
 */
export function resolveBoardChrome(el: Element | null): BoardChrome {
  const read = (name: string, fallback: string): string => {
    if (!el || typeof window === 'undefined') return fallback;
    const value = getComputedStyle(el).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    // Wood-grain squares from warm surface tones (a checkerboard of two tints).
    light: read('--color-surface-raised', '#4a3524'),
    dark: read('--color-border-strong', '#2e2016'),
    line: read('--color-border', '#1c130c'),
    // Violet discs = grape (the primary brand ramp); Amber discs = sunbeam (the accent ramp).
    violet: read('--color-primary', '#7C3AED'),
    violetRim: read('--color-primary-active', '#5B21B6'),
    amber: read('--color-accent', '#FACC15'),
    amberRim: read('--color-accent-strong', '#A16207'),
    hint: read('--color-ring', '#A78BFA'),
    text: read('--color-text', '#f4f4f5'),
  };
}
