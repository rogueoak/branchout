// Checkers's live-snapshot decoder for the game-pluggable client (spec 0055). Checkers is a LIVE-model
// board game with PERFECT information: the engine streams the whole board on the `sim` frame and the
// web is a pure renderer that decodes that opaque `unknown` snapshot here at the client boundary. A
// shape the renderer does not understand is a null (a skipped render), never a thrown one - the same
// "opaque payload, the game owns the shape" contract Reversi uses. These types mirror
// packages/games/checkers/src/types.ts exactly; a drift here breaks rendering, so they stay in lockstep.

/** A coordinate on the board. */
export interface Coord {
  row: number;
  col: number;
}

/**
 * A cell's contents on the wire: 'empty', a man ('violet'/'amber'), or a crowned king
 * ('violet-king'/'amber-king').
 */
export type WireCell = 'empty' | 'violet' | 'amber' | 'violet-king' | 'amber-king';

/** A piece color (never empty): the side to move, and the winner. */
export type Color = 'violet' | 'amber';

/** The move a client submits as the `move` string: `JSON.stringify({ from, path })`. */
export interface CheckersMove {
  from: Coord;
  path: Coord[];
}

/** The result of a finished game (no draw in checkers). */
export type Outcome = 'violet' | 'amber' | null;

/**
 * A live snapshot of the whole game, streamed on the `sim` frame. The client REPLACES its state from
 * the newest snapshot. Everything is public (perfect information) - there is no hidden field.
 */
export interface CheckersSim {
  size: number;
  cells: WireCell[];
  toMove: Color | null;
  activePlayer: string;
  legal: CheckersMove[];
  violet: number;
  amber: number;
  over: boolean;
  outcome: Outcome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

const WIRE_CELLS: readonly WireCell[] = ['empty', 'violet', 'amber', 'violet-king', 'amber-king'];

function asWireCell(value: unknown): WireCell | null {
  return typeof value === 'string' && (WIRE_CELLS as readonly string[]).includes(value)
    ? (value as WireCell)
    : null;
}

/** Decode the row-major cell array; returns null if any entry is not a valid cell. */
function asCells(value: unknown, expected: number): WireCell[] | null {
  if (!Array.isArray(value) || value.length !== expected) return null;
  const out: WireCell[] = [];
  for (const item of value) {
    const cell = asWireCell(item);
    if (!cell) return null;
    out.push(cell);
  }
  return out;
}

/** Decode a single `{ row, col }` coordinate, or null. */
function asCoord(value: unknown): Coord | null {
  if (!isRecord(value)) return null;
  return isInt(value.row) && isInt(value.col) ? { row: value.row, col: value.col } : null;
}

/** Decode one `{ from, path }` move, or null if malformed. */
function asMove(value: unknown): CheckersMove | null {
  if (!isRecord(value)) return null;
  const from = asCoord(value.from);
  if (!from) return null;
  if (!Array.isArray(value.path) || value.path.length === 0) return null;
  const path: Coord[] = [];
  for (const item of value.path) {
    const coord = asCoord(item);
    if (!coord) return null;
    path.push(coord);
  }
  return { from, path };
}

/** Decode the legal-move list; returns null if any entry is malformed. */
function asMoves(value: unknown): CheckersMove[] | null {
  if (!Array.isArray(value)) return null;
  const out: CheckersMove[] = [];
  for (const item of value) {
    const move = asMove(item);
    if (!move) return null;
    out.push(move);
  }
  return out;
}

function asColorOrNull(value: unknown): Color | null {
  return value === 'violet' || value === 'amber' ? value : null;
}

function asOutcome(value: unknown): Outcome {
  return value === 'violet' || value === 'amber' ? value : null;
}

/**
 * Decode a `sim` payload as a Checkers live snapshot, or null if it is not one. The board size drives
 * the expected cell count, so a mismatched board is rejected as a whole (a skipped render) rather than
 * rendered half-decoded.
 */
export function asCheckersSim(value: unknown): CheckersSim | null {
  if (!isRecord(value)) return null;
  if (!isInt(value.size) || value.size <= 0) return null;
  const cells = asCells(value.cells, value.size * value.size);
  const legal = asMoves(value.legal);
  if (
    cells &&
    legal &&
    typeof value.activePlayer === 'string' &&
    isInt(value.violet) &&
    isInt(value.amber) &&
    typeof value.over === 'boolean'
  ) {
    return {
      size: value.size,
      cells,
      // toMove is a color or null (game over).
      toMove: value.toMove === null ? null : asColorOrNull(value.toMove),
      activePlayer: value.activePlayer,
      legal,
      violet: value.violet,
      amber: value.amber,
      over: value.over,
      outcome: asOutcome(value.outcome),
    };
  }
  return null;
}

/** Two coordinates are the same square (a small helper the Viewer's selection uses). */
export function sameCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}
