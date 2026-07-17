// The game-AGNOSTIC board renderer geometry (spec 0054). Reversi is the first board game; Checkers
// and Chess follow, so the square-board layout math + the generic board-SURFACE chrome live here,
// separate from any one game's piece drawing. This is pure geometry + token resolution - no React, no
// game rules, and crucially NO game-specific piece colors (no Reversi discs, no Chess pieces) - so a
// future board game reuses the grid + tap plumbing and only swaps its own piece rendering on top.

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

/** The pixel box of cell `{row,col}` under a layout (for drawing a square/piece). */
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
 * by a Viewer's tap handler to turn a touch into a placement.
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

/**
 * The generic board-surface colors every board game shares: the two alternating square tints, the
 * grid line/border, and the on-surface text. NO game-specific piece colors here - a board game layers
 * its own piece chrome (Reversi's discs, Chess's pieces) on top of this surface.
 */
export interface BoardSurface {
  /** The two alternating square tints (a checkerboard). */
  light: string;
  dark: string;
  /** The grid line + board border. */
  line: string;
  /** On-surface text (labels, coordinates). */
  text: string;
}

/**
 * Read a CSS custom property off an element's computed style, with a fallback for SSR / first paint
 * (no element, or no window). The shared primitive a board game's chrome resolver builds on so every
 * game reads its tokens the same way.
 */
export function readCssVar(el: Element | null, name: string, fallback: string): string {
  if (!el || typeof window === 'undefined') return fallback;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}
