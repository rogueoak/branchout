// Checkers's rules (spec 0055): standard English draughts (checkers), layered on the generic board
// harness (@branchout/game-board). This module is PURE game logic - no engine, no lifecycle, no I/O -
// so every rule is trivially unit-testable in isolation. The engine module (checkers.ts) drives it;
// the web renders the board it produces.
//
// The rules, standard English draughts on an 8x8 board (dark squares only):
//   - Two colors of piece, Violet (seat 0, moves first) and Amber (seat 1). Each side starts with 12
//     MEN on the dark squares of its three home rows. Violet sits on the bottom (rows 5-7) and moves
//     UP the board (toward row 0); Amber sits on the top (rows 0-2) and moves DOWN (toward row 7).
//   - A dark (playable) square is one where (row + col) is odd, so the two home corners are dark.
//   - A MAN moves one step DIAGONALLY FORWARD to an adjacent empty dark square (Violet up, Amber down).
//   - A CAPTURE (a jump) leaps diagonally over an ADJACENT opponent piece into the empty square just
//     beyond it, removing the jumped piece. Jumps CHAIN: if the piece that just landed can jump again,
//     it MUST continue, in the SAME turn, until it can jump no more (a multi-jump).
//   - MANDATORY CAPTURE: if a side has ANY capture available, it MUST make a capture that turn (a plain
//     step is illegal while a jump exists). Among available captures the player may pick any (this is
//     the classic English-draughts rule; we do NOT enforce the "longest jump" majority-rule variant -
//     any legal jump, continued to its end, is allowed). This is the variant this game ships, chosen
//     for clarity and testability, and documented in spec 0055.
//   - CROWNING: a man that STOPS on the far row (Violet on row 0, Amber on row 7) is crowned a KING. A
//     king moves and captures diagonally in ALL four directions (forward and backward). Per standard
//     English draughts, if a man reaches the crown row in the MIDDLE of a jump it is crowned and the
//     turn ENDS immediately (it does not keep jumping as a king that same turn).
//   - The game is OVER when the side to move has NO legal move - either it has no pieces left, or all
//     its pieces are blocked. That side LOSES; the other side wins. (There is no draw in this ruleset;
//     a side with no move loses.)

import { DIAGONAL, emptyGrid, Grid, type Coord, type Seat, type Step } from '@branchout/game-board';

/** The board is 8x8, the standard checkers size. */
export const BOARD_SIZE = 8;

/** The number of MEN each side starts with (the dark squares of three home rows: 4 per row x 3). */
export const PIECES_PER_SIDE = 12;

/** A piece's color/seat, and whether it is a king. Row-major cells are a Piece or null (empty). */
export interface Piece {
  /** Which side owns it: seat 0 = Violet, seat 1 = Amber. */
  seat: Seat;
  /** True once crowned (moves + captures in all four diagonal directions). */
  king: boolean;
}

/** A cell's contents: a piece, or null for an empty square. */
export type Cell = Piece | null;

/** A move a client can submit: from a source square, along a path of one or more landing squares. */
export interface Move {
  /** The square the moving piece starts on. */
  from: Coord;
  /**
   * The ordered landing squares. A plain step has ONE entry (the adjacent square). A jump has one
   * entry per hop (each an empty square two diagonally away over an opponent), in order.
   */
  path: Coord[];
}

/** True on a dark (playable) square: the two home corners are dark, so (row + col) is odd. */
export function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

/** The color name for a seat, used by the web/theme (kept out of the shared renderer). */
export function colorOf(seat: Seat): 'violet' | 'amber' {
  return seat === 0 ? 'violet' : 'amber';
}

/**
 * The forward diagonal steps for a MAN of `seat`: Violet (seat 0) moves UP (row decreases), Amber
 * (seat 1) moves DOWN (row increases). A king ignores this and uses all four {@link DIAGONAL} steps.
 */
export function forwardSteps(seat: Seat): readonly Step[] {
  const dr = seat === 0 ? -1 : 1;
  return [
    { dr, dc: -1 },
    { dr, dc: 1 },
  ];
}

/** The diagonal steps a piece may move/capture along: a king uses all four, a man only its forward two. */
export function stepsFor(piece: Piece): readonly Step[] {
  return piece.king ? DIAGONAL : forwardSteps(piece.seat);
}

/** The crown row for a seat: Violet crowns on row 0 (the top), Amber on row 7 (the bottom). */
export function crownRow(seat: Seat): number {
  return seat === 0 ? 0 : BOARD_SIZE - 1;
}

/**
 * The opening position: each side's 12 men on the dark squares of its three home rows. Amber (seat 1)
 * fills rows 0-2 (the top), Violet (seat 0) fills rows 5-7 (the bottom); rows 3-4 are empty. Only dark
 * squares hold pieces.
 */
export function startingBoard(): Grid<Cell> {
  let board = emptyGrid<Cell>(BOARD_SIZE, null);
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!isDarkSquare(row, col)) continue;
      if (row <= 2) board = board.set(row, col, { seat: 1, king: false });
      else if (row >= BOARD_SIZE - 3) board = board.set(row, col, { seat: 0, king: false });
    }
  }
  return board;
}

/** Two coordinates are the same square. */
export function sameCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * The single-hop CAPTURES available FROM a square for the piece sitting on it: for each direction the
 * piece may move, if the adjacent square holds an opponent and the square just beyond is empty and
 * on-board, that hop captures. Returns the landing square + the captured (jumped) square per hop. A
 * king considers all four diagonals; a man only its forward two. Delegates to the shared
 * {@link captureHopsFromPiece} core with the piece the board holds on `from`.
 */
export function captureHopsFrom(board: Grid<Cell>, from: Coord): { to: Coord; jumped: Coord }[] {
  const piece = board.at(from.row, from.col);
  if (!piece) return [];
  return captureHopsFromPiece(board, from, piece);
}

/**
 * The plain (non-capturing) single-step moves available FROM a square for the piece on it: each
 * forward (or, for a king, any) diagonal step to an adjacent empty on-board square.
 */
export function stepMovesFrom(board: Grid<Cell>, from: Coord): Coord[] {
  const piece = board.at(from.row, from.col);
  if (!piece) return [];
  const moves: Coord[] = [];
  for (const step of stepsFor(piece)) {
    const r = from.row + step.dr;
    const c = from.col + step.dc;
    if (board.inBounds(r, c) && board.at(r, c) === null) moves.push({ row: r, col: c });
  }
  return moves;
}

/** True when `seat` has ANY capture available anywhere on the board (drives mandatory capture). */
export function seatHasCapture(board: Grid<Cell>, seat: Seat): boolean {
  let found = false;
  board.forEach((cell, coord) => {
    if (found || !cell || cell.seat !== seat) return;
    if (captureHopsFrom(board, coord).length > 0) found = true;
  });
  return found;
}

/**
 * Whether crowning happens when a piece of `seat` lands on `row`: a MAN that reaches its crown row is
 * crowned (a king that is already there stays a king; this returns whether to SET king true).
 */
function crownsAt(seat: Seat, king: boolean, row: number): boolean {
  return !king && row === crownRow(seat);
}

/**
 * Enumerate every full multi-jump PATH from a starting square for the piece on it, as an ordered list
 * of landing squares. A jump chains: after a hop, if the (possibly newly crowned) piece can jump
 * again it MUST, so only MAXIMAL chains are returned (a chain that could continue is not a legal stop).
 * Per standard rules, if a MAN crowns mid-chain the chain ENDS there (a fresh king does not keep
 * jumping the same turn). Each returned path has >= 1 landing square.
 *
 * This walks a small search tree over a candidate board (the jumped piece removed each hop) so a
 * multi-jump is generated exactly, without mutating the live board.
 */
export function jumpPathsFrom(board: Grid<Cell>, from: Coord): Coord[][] {
  const piece = board.at(from.row, from.col);
  if (!piece) return [];
  const paths: Coord[][] = [];

  const walk = (b: Grid<Cell>, at: Coord, p: Piece, acc: Coord[]): void => {
    const hops = captureHopsFromPiece(b, at, p);
    if (hops.length === 0) {
      if (acc.length > 0) paths.push(acc);
      return;
    }
    for (const hop of hops) {
      // Move the piece over the jumped square: remove the jumped piece and the piece's old square,
      // land it on `to`, crowning if it reaches the crown row.
      const crowned = crownsAt(p.seat, p.king, hop.to.row);
      const landed: Piece = { seat: p.seat, king: p.king || crowned };
      let next = b.set(at.row, at.col, null);
      next = next.set(hop.jumped.row, hop.jumped.col, null);
      next = next.set(hop.to.row, hop.to.col, landed);
      if (crowned) {
        // A man crowned mid-chain ends the turn here (standard rule): record and do not continue.
        paths.push([...acc, hop.to]);
      } else {
        walk(next, hop.to, landed, [...acc, hop.to]);
      }
    }
  };

  walk(board, from, piece, []);
  return paths;
}

/**
 * The single-hop captures for a specific piece identity sitting on a square. This is the shared core:
 * {@link captureHopsFrom} calls it with the board's own piece, and the multi-jump chain walk calls it
 * with the (possibly newly crowned) piece it is tracking over a candidate board.
 */
function captureHopsFromPiece(
  board: Grid<Cell>,
  from: Coord,
  piece: Piece,
): { to: Coord; jumped: Coord }[] {
  const hops: { to: Coord; jumped: Coord }[] = [];
  for (const step of stepsFor(piece)) {
    const midR = from.row + step.dr;
    const midC = from.col + step.dc;
    const toR = from.row + step.dr * 2;
    const toC = from.col + step.dc * 2;
    if (!board.inBounds(toR, toC)) continue;
    const mid = board.inBounds(midR, midC) ? board.at(midR, midC) : null;
    const dest = board.at(toR, toC);
    if (mid && mid.seat !== piece.seat && dest === null) {
      hops.push({ to: { row: toR, col: toC }, jumped: { row: midR, col: midC } });
    }
  }
  return hops;
}

/**
 * Every legal MOVE for `seat` on the current board, as `{ from, path }`. Mandatory capture: if any
 * capture exists the result is exactly the maximal jump paths (no plain steps); otherwise it is the
 * plain single steps. The list drives legality (a move is legal iff it appears here) and the web hints.
 */
export function legalMoves(board: Grid<Cell>, seat: Seat): Move[] {
  const captures: Move[] = [];
  const steps: Move[] = [];
  board.forEach((cell, from) => {
    if (!cell || cell.seat !== seat) return;
    const paths = jumpPathsFrom(board, from);
    for (const path of paths) captures.push({ from, path });
    if (paths.length === 0) {
      for (const to of stepMovesFrom(board, from)) steps.push({ from, path: [to] });
    }
  });
  // Mandatory capture: if ANY capture exists this turn, only captures are legal.
  return captures.length > 0 ? captures : steps;
}

/** True when `seat` has at least one legal move (drives end detection). */
export function hasLegalMove(board: Grid<Cell>, seat: Seat): boolean {
  return legalMoves(board, seat).length > 0;
}

/** Whether a submitted `{from, path}` is a legal move for `seat` on this board. */
export function isLegalMove(board: Grid<Cell>, seat: Seat, move: Move): boolean {
  return legalMoves(board, seat).some((m) => movesEqual(m, move));
}

/** Two moves are the same source + identical landing path. */
export function movesEqual(a: Move, b: Move): boolean {
  if (!sameCoord(a.from, b.from)) return false;
  if (a.path.length !== b.path.length) return false;
  return a.path.every((coord, i) => sameCoord(coord, b.path[i] as Coord));
}

/**
 * Apply a LEGAL move and return the new board. For a plain step the piece moves to the single landing
 * square; for a jump each hop removes the jumped piece; a man that finishes on its crown row is crowned.
 * Throws if the move is not legal (the engine checks legality first and rejects to the device; this
 * guard makes an illegal apply a loud bug, not a silent corruption).
 */
export function applyMove(board: Grid<Cell>, seat: Seat, move: Move): Grid<Cell> {
  if (!isLegalMove(board, seat, move)) {
    throw new Error(
      `illegal Checkers move from (${move.from.row},${move.from.col}) for seat ${seat}`,
    );
  }
  const piece = board.at(move.from.row, move.from.col) as Piece;
  let next = board.set(move.from.row, move.from.col, null);
  let at = move.from;
  let king = piece.king;
  for (const to of move.path) {
    // If this hop is a jump (two squares away), remove the jumped piece in the middle.
    if (Math.abs(to.row - at.row) === 2) {
      const midR = (to.row + at.row) / 2;
      const midC = (to.col + at.col) / 2;
      next = next.set(midR, midC, null);
    }
    if (crownsAt(seat, king, to.row)) king = true;
    at = to;
  }
  next = next.set(at.row, at.col, { seat, king });
  return next;
}

/** The piece counts on the board, per seat (men + kings), for the scoreboard. */
export interface Score {
  violet: number;
  amber: number;
}

/** Count pieces of each color remaining on the board. */
export function scoreOf(board: Grid<Cell>): Score {
  return {
    violet: board.count((cell) => cell?.seat === 0),
    amber: board.count((cell) => cell?.seat === 1),
  };
}

/**
 * True when the game is over for the side to move: that seat has NO legal move (no pieces, or all
 * blocked). Unlike Reversi, checkers ends on the side-to-move being stuck, so end detection is checked
 * against the specific seat about to move.
 */
export function isGameOverFor(board: Grid<Cell>, toMove: Seat): boolean {
  return !hasLegalMove(board, toMove);
}

/**
 * The winner when the side `toMove` is stuck: the OTHER seat wins (there is no draw - a side with no
 * legal move loses). Undefined to call before {@link isGameOverFor}; callers gate on it.
 */
export function winnerOf(toMove: Seat): Seat {
  return toMove === 0 ? 1 : 0;
}
