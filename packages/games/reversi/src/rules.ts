// Reversi's rules (spec 0054): the classic disc-flip game, layered on the generic board harness
// (board.ts). This module is PURE game logic - no engine, no lifecycle, no I/O - so every rule is
// trivially unit-testable in isolation. The engine module (reversi.ts) drives it; the web renders the
// board it produces.
//
// The rules, standard 8x8 disc-flip:
//   - Two colors of disc, Violet (seat 0, moves first) and Amber (seat 1).
//   - Opening: the four center squares hold two discs of each color on the diagonals.
//   - A move places one of your discs on an EMPTY square such that, in one or more of the eight
//     straight directions, it brackets an unbroken line of >=1 opponent disc ending at another of
//     YOUR discs. Every bracketed opponent disc flips to your color. A placement that brackets
//     nothing is illegal.
//   - You must move if you have any legal move; if you have none but the opponent does, you PASS
//     (your turn is skipped). If NEITHER side has a legal move, the game is over.
//   - The winner is whoever has more discs of their color when it ends (equal discs is a draw).

import { ALL_DIRECTIONS, emptyGrid, Grid, type Coord, type Seat } from './board';

/** The board is 8x8, the standard Reversi size. */
export const BOARD_SIZE = 8;

/** A cell's contents: empty, or a disc belonging to seat 0 (Violet) or seat 1 (Amber). */
export type Cell = 'empty' | 'violet' | 'amber';

/** The disc color a seat plays: seat 0 -> violet, seat 1 -> amber. */
export function discOf(seat: Seat): Exclude<Cell, 'empty'> {
  return seat === 0 ? 'violet' : 'amber';
}

/** The seat that owns a disc color (the inverse of {@link discOf}); null for an empty cell. */
export function seatOf(cell: Cell): Seat | null {
  if (cell === 'violet') return 0;
  if (cell === 'amber') return 1;
  return null;
}

/**
 * The opening position: an empty 8x8 board with the four center discs placed on their diagonals -
 * amber at (3,3) and (4,4), violet at (3,4) and (4,3). This is the standard Othello/Reversi opening,
 * so violet (seat 0, to move first) has four symmetric opening moves.
 */
export function startingBoard(): Grid<Cell> {
  const mid = BOARD_SIZE / 2; // 4
  return emptyGrid<Cell>(BOARD_SIZE, 'empty')
    .set(mid - 1, mid - 1, 'amber') // (3,3)
    .set(mid, mid, 'amber') // (4,4)
    .set(mid - 1, mid, 'violet') // (3,4)
    .set(mid, mid - 1, 'violet'); // (4,3)
}

/**
 * The discs that would flip if `seat` placed at `{row,col}`, walking one ray per direction. For each
 * of the eight directions, step over an unbroken run of OPPONENT discs; if that run has length >=1
 * and terminates on one of the mover's OWN discs, the whole run is bracketed and flips. A run that
 * runs off the board, or hits an empty cell, or is empty (an adjacent own disc / empty neighbor)
 * brackets nothing in that direction. Returns every bracketed coordinate across all directions.
 *
 * This is the heart of Reversi and the clearest example of the harness's ray-walk primitive: it walks
 * the same eight `Step`s a future queen would slide along, just with a bracket test instead of a move.
 */
export function flipsFor(board: Grid<Cell>, seat: Seat, row: number, col: number): Coord[] {
  // Only an empty square can be played.
  if (!board.inBounds(row, col) || board.at(row, col) !== 'empty') return [];
  const own = discOf(seat);
  const flips: Coord[] = [];

  for (const step of ALL_DIRECTIONS) {
    const run: Coord[] = [];
    let r = row + step.dr;
    let c = col + step.dc;
    // Walk over a contiguous run of opponent discs.
    while (board.inBounds(r, c)) {
      const cell = board.at(r, c);
      if (cell === 'empty') break; // gap - nothing bracketed this way
      if (cell === own) {
        // Closed the bracket on our own disc: the run between flips (if it is non-empty).
        if (run.length > 0) flips.push(...run);
        break;
      }
      // An opponent disc: extend the run and keep walking.
      run.push({ row: r, col: c });
      r += step.dr;
      c += step.dc;
    }
    // Falling off the board (`inBounds` false) closes the loop with nothing bracketed this way.
  }

  return flips;
}

/** True when `seat` has a legal placement at `{row,col}` (it brackets at least one disc). */
export function isLegalMove(board: Grid<Cell>, seat: Seat, row: number, col: number): boolean {
  return flipsFor(board, seat, row, col).length > 0;
}

/** Every square `seat` may legally play on the current board, top-left to bottom-right. */
export function legalMoves(board: Grid<Cell>, seat: Seat): Coord[] {
  const moves: Coord[] = [];
  board.forEach((cell, coord) => {
    if (cell === 'empty' && flipsFor(board, seat, coord.row, coord.col).length > 0) {
      moves.push(coord);
    }
  });
  return moves;
}

/** True when `seat` has at least one legal move on this board (drives the forced-pass logic). */
export function hasLegalMove(board: Grid<Cell>, seat: Seat): boolean {
  let found = false;
  board.forEach((cell, coord) => {
    if (!found && cell === 'empty' && flipsFor(board, seat, coord.row, coord.col).length > 0) {
      found = true;
    }
  });
  return found;
}

/**
 * Apply a legal placement: return the new board with the mover's disc at `{row,col}` and every
 * bracketed opponent disc flipped to the mover's color. Throws if the move is illegal (the caller -
 * the engine's collectMove - checks legality first and rejects an illegal move to the device; this
 * guard makes an illegal apply a loud bug, not a silent no-op).
 */
export function applyMove(board: Grid<Cell>, seat: Seat, row: number, col: number): Grid<Cell> {
  const flips = flipsFor(board, seat, row, col);
  if (flips.length === 0) {
    throw new Error(`illegal Reversi move at (${row},${col}) for seat ${seat}: brackets nothing`);
  }
  const own = discOf(seat);
  let next = board.set(row, col, own);
  for (const flip of flips) next = next.set(flip.row, flip.col, own);
  return next;
}

/** The disc counts on the board, per seat. */
export interface Score {
  violet: number;
  amber: number;
}

/** Count discs of each color. */
export function scoreOf(board: Grid<Cell>): Score {
  return {
    violet: board.count((cell) => cell === 'violet'),
    amber: board.count((cell) => cell === 'amber'),
  };
}

/**
 * True when the game is over: NEITHER side has a legal move. (A single side with no move only passes;
 * the game ends only when both are stuck - which includes a full board, since no move exists on it.)
 */
export function isGameOver(board: Grid<Cell>): boolean {
  return !hasLegalMove(board, 0) && !hasLegalMove(board, 1);
}

/**
 * The winner when the game is over: the seat with more discs, or 'draw' on an equal count. Undefined
 * behavior to call before {@link isGameOver}; callers gate on it.
 */
export function winnerOf(board: Grid<Cell>): Seat | 'draw' {
  const { violet, amber } = scoreOf(board);
  if (violet > amber) return 0;
  if (amber > violet) return 1;
  return 'draw';
}
