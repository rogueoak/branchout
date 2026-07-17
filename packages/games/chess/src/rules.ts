// Chess rules (spec 0056): full standard chess, layered on the generic board harness (@branchout/game-
// board). This module is PURE game logic - no engine, no lifecycle, no I/O - so every rule is trivially
// unit-testable in isolation. The engine module (chess.ts) drives it; the web renders the position it
// produces. This is the correctness-heaviest game: full legal-move generation, check/checkmate/
// stalemate, castling, en passant, and promotion all live here and are exhaustively tested.
//
// The rules, standard 8x8 chess:
//   - Two armies, White (seat 0, moves first) and Black (seat 1). Themed Violet (White) vs Amber
//     (Black), but the RULES use the standard chess color words to stay unambiguous.
//   - Six piece types: Pawn, kNight, Bishop, Rook, Queen, King, each with its own movement.
//   - A move is LEGAL only if it does not leave the mover's own king in check (this is the pin /
//     check-evasion filter applied on top of raw piece movement).
//   - Special moves: castling (king + rook, with the five legality conditions), en passant (the
//     one-move capture window on a pawn's two-square advance), and promotion (a pawn reaching the far
//     rank becomes a queen/rook/bishop/knight).
//   - The game ends: checkmate (the side to move is in check with no legal move) -> the other side
//     wins; stalemate (not in check, no legal move) -> a draw; insufficient material -> a draw.
//     Threefold repetition and the fifty-move rule are tracked as counters but are NOT auto-claimed
//     (documented; a future enhancement). Resignation ends the game in the module, not here.

import { emptyGrid, Grid, type Coord, type Seat } from '@branchout/game-board';

/** The board is 8x8. Row 0 is Black's back rank (the "8th rank"); row 7 is White's ("1st rank"). */
export const BOARD_SIZE = 8;

/** A piece color. White plays seat 0 (Violet, moves first); Black plays seat 1 (Amber). */
export type Color = 'w' | 'b';

/** A piece type: Pawn, Knight, Bishop, Rook, Queen, King. */
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';

/**
 * A board cell: 'empty', or a two-character piece code `<color><type>` (e.g. 'wP', 'bK'). A plain
 * string keeps the `Grid<Cell>` fully JSON-serializable through scratch (no class instance survives
 * the round trip).
 */
export type Cell = 'empty' | `${Color}${PieceType}`;

/** The four promotion choices (a pawn may never promote to a pawn or king). */
export type PromotionType = 'Q' | 'R' | 'B' | 'N';

/** The color a seat plays: seat 0 -> white, seat 1 -> black. */
export function colorOf(seat: Seat): Color {
  return seat === 0 ? 'w' : 'b';
}

/** The seat that plays a color (the inverse of {@link colorOf}). */
export function seatOfColor(color: Color): Seat {
  return color === 'w' ? 0 : 1;
}

/** The opposing color. */
export function otherColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

/** The color of a piece cell, or null for an empty square. */
export function cellColor(cell: Cell): Color | null {
  return cell === 'empty' ? null : (cell[0] as Color);
}

/** The type of a piece cell, or null for an empty square. */
export function cellType(cell: Cell): PieceType | null {
  return cell === 'empty' ? null : (cell[1] as PieceType);
}

/** Build a piece cell from a color + type. */
export function piece(color: Color, type: PieceType): Cell {
  return `${color}${type}` as Cell;
}

/**
 * Castling rights: which of the four castles are still POTENTIALLY available (the king and that rook
 * have never moved). This is only the "rights" half of castling legality; the through/into/out-of-
 * check and empty-path tests are applied at move-generation time.
 */
export interface CastlingRights {
  /** White may castle kingside (O-O): white king + h1 rook unmoved. */
  wK: boolean;
  /** White may castle queenside (O-O-O): white king + a1 rook unmoved. */
  wQ: boolean;
  /** Black may castle kingside: black king + h8 rook unmoved. */
  bK: boolean;
  /** Black may castle queenside: black king + a8 rook unmoved. */
  bQ: boolean;
}

/** The full castling rights when nothing has moved. */
export function fullCastling(): CastlingRights {
  return { wK: true, wQ: true, bK: true, bQ: true };
}

/**
 * A complete position: the board plus the FEN-like extra state (side to move, castling rights, the en-
 * passant target square, and the two move counters). Fully serializable, so it round-trips through
 * scratch. This is the single source of truth a rule reads.
 */
export interface Position {
  /** The board, row-major (`cells[row * BOARD_SIZE + col]`). */
  board: Grid<Cell>;
  /** The color to move. */
  turn: Color;
  /** Which castles are still potentially available. */
  castling: CastlingRights;
  /**
   * The square a pawn just skipped over on a two-square advance, i.e. the square an en-passant capture
   * would land on - or null if the last move was not a double pawn push. Only valid for the immediately
   * following move (the one-move window). Standard chess coordinates it as the skipped square.
   */
  enPassant: Coord | null;
  /** The halfmove clock for the fifty-move rule: plies since the last capture or pawn move. */
  halfmove: number;
  /** The fullmove number, starting at 1 and incrementing after each Black move. */
  fullmove: number;
}

/**
 * The standard starting position: White's pieces on rows 6-7 (Violet, moves first) and Black's on
 * rows 0-1 (Amber). Row 0 is the 8th rank (Black back rank), row 7 the 1st rank (White back rank),
 * with files a-h mapping to columns 0-7. White is to move, full castling rights, no en-passant target.
 */
export function startingPosition(): Position {
  let board = emptyGrid<Cell>(BOARD_SIZE, 'empty');
  const backRank: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    board = board.set(0, col, piece('b', backRank[col]!));
    board = board.set(1, col, piece('b', 'P'));
    board = board.set(6, col, piece('w', 'P'));
    board = board.set(7, col, piece('w', backRank[col]!));
  }
  return {
    board,
    turn: 'w',
    castling: fullCastling(),
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

/**
 * A move a player submits or the engine generates: from-square to to-square, plus an optional promotion
 * choice (required and only meaningful when a pawn reaches the far rank). Special moves (castling, en
 * passant, the double pawn push) are inferred from the piece + geometry, not flagged - so a client only
 * ever sends {from, to, promotion?}.
 */
export interface Move {
  from: Coord;
  to: Coord;
  /** The piece to promote to on a promoting pawn move; ignored otherwise. */
  promotion?: PromotionType;
}

/** Two coordinates are the same square. */
export function sameSquare(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

// --- attack + movement primitives -------------------------------------------------------------------

const KNIGHT_STEPS: readonly { dr: number; dc: number }[] = [
  { dr: -2, dc: -1 },
  { dr: -2, dc: 1 },
  { dr: -1, dc: -2 },
  { dr: -1, dc: 2 },
  { dr: 1, dc: -2 },
  { dr: 1, dc: 2 },
  { dr: 2, dc: -1 },
  { dr: 2, dc: 1 },
];

const KING_STEPS: readonly { dr: number; dc: number }[] = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 0 },
  { dr: -1, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
];

const ROOK_DIRS: readonly { dr: number; dc: number }[] = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

const BISHOP_DIRS: readonly { dr: number; dc: number }[] = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 1 },
];

/** The forward row direction a pawn of `color` moves (White moves up the board, to smaller rows). */
export function pawnDir(color: Color): number {
  return color === 'w' ? -1 : 1;
}

/** The starting row of a pawn of `color` (its two-square advance is available only from here). */
function pawnStartRow(color: Color): number {
  return color === 'w' ? 6 : 1;
}

/** The promotion row for `color` (the far rank a pawn promotes on). */
function promotionRow(color: Color): number {
  return color === 'w' ? 0 : 7;
}

/**
 * Is the square `{row,col}` attacked by any piece of `by` on this board? This is the primitive check
 * detection is built on - a king is "in check" when its square is attacked by the opponent. It does NOT
 * consider whose turn it is or pins; it is a raw "could a `by` piece capture onto this square" test
 * (pawns attack diagonally, sliders along clear rays, knight/king by their steps). Castling and en
 * passant are NEVER attacks, so they are excluded here.
 */
export function isSquareAttacked(board: Grid<Cell>, row: number, col: number, by: Color): boolean {
  // Pawn attacks: a `by` pawn sits one row toward its own side and one column away, attacking forward.
  // A white pawn attacks the squares diagonally up (toward smaller rows); to be attacked-by-white, a
  // white pawn must be one row BELOW (row+1) the target. Symmetric for black.
  const pawnRow = row - pawnDir(by);
  for (const dc of [-1, 1]) {
    const c = col + dc;
    if (board.inBounds(pawnRow, c) && board.at(pawnRow, c) === piece(by, 'P')) return true;
  }

  // Knight attacks.
  for (const s of KNIGHT_STEPS) {
    const r = row + s.dr;
    const c = col + s.dc;
    if (board.inBounds(r, c) && board.at(r, c) === piece(by, 'N')) return true;
  }

  // King attacks (adjacent squares).
  for (const s of KING_STEPS) {
    const r = row + s.dr;
    const c = col + s.dc;
    if (board.inBounds(r, c) && board.at(r, c) === piece(by, 'K')) return true;
  }

  // Sliding attacks: rook/queen along the orthogonals, bishop/queen along the diagonals.
  for (const dir of ROOK_DIRS) {
    if (raySeesAttacker(board, row, col, dir, by, ['R', 'Q'])) return true;
  }
  for (const dir of BISHOP_DIRS) {
    if (raySeesAttacker(board, row, col, dir, by, ['B', 'Q'])) return true;
  }
  return false;
}

/** Walk a ray from `{row,col}`; return true if the first piece met is a `by` piece of an allowed type. */
function raySeesAttacker(
  board: Grid<Cell>,
  row: number,
  col: number,
  dir: { dr: number; dc: number },
  by: Color,
  types: PieceType[],
): boolean {
  let r = row + dir.dr;
  let c = col + dir.dc;
  while (board.inBounds(r, c)) {
    const cell = board.at(r, c);
    if (cell !== 'empty') {
      return cellColor(cell) === by && types.includes(cellType(cell)!);
    }
    r += dir.dr;
    c += dir.dc;
  }
  return false;
}

/** Find the square of `color`'s king, or null if it is not on the board (should not happen in play). */
export function findKing(board: Grid<Cell>, color: Color): Coord | null {
  const king = piece(color, 'K');
  let found: Coord | null = null;
  board.forEach((cell, coord) => {
    if (!found && cell === king) found = coord;
  });
  return found;
}

/** Is `color`'s king currently in check (its square attacked by the opponent)? */
export function isInCheck(board: Grid<Cell>, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king.row, king.col, otherColor(color));
}

// --- pseudo-legal move generation -------------------------------------------------------------------

/**
 * Every PSEUDO-legal move for the piece on `{row,col}` - the moves that respect the piece's geometry
 * and captures, but NOT the "does it leave my own king in check" filter (that filter is applied in
 * {@link legalMoves}). Castling and en passant ARE generated here (they are legal move shapes), but
 * castling still gets its through/into/out-of-check checks here since those are square-attack tests, not
 * a "my king in check after the move" test. Returns [] if the square is empty or holds the other color.
 */
export function pseudoMovesFrom(pos: Position, row: number, col: number): Move[] {
  const { board } = pos;
  if (!board.inBounds(row, col)) return [];
  const cell = board.at(row, col);
  const color = cellColor(cell);
  if (color !== pos.turn) return [];
  const type = cellType(cell)!;
  const from: Coord = { row, col };

  switch (type) {
    case 'P':
      return pawnMoves(pos, from, color);
    case 'N':
      return stepMoves(board, from, color, KNIGHT_STEPS);
    case 'K':
      return kingMoves(pos, from, color);
    case 'B':
      return slideMoves(board, from, color, BISHOP_DIRS);
    case 'R':
      return slideMoves(board, from, color, ROOK_DIRS);
    case 'Q':
      return slideMoves(board, from, color, [...ROOK_DIRS, ...BISHOP_DIRS]);
    default:
      return [];
  }
}

/** One-step moves (knight, and the plain king steps) onto an empty square or an enemy piece. */
function stepMoves(
  board: Grid<Cell>,
  from: Coord,
  color: Color,
  steps: readonly { dr: number; dc: number }[],
): Move[] {
  const moves: Move[] = [];
  for (const s of steps) {
    const r = from.row + s.dr;
    const c = from.col + s.dc;
    if (!board.inBounds(r, c)) continue;
    const target = board.at(r, c);
    if (target === 'empty' || cellColor(target) !== color)
      moves.push({ from, to: { row: r, col: c } });
  }
  return moves;
}

/** Sliding moves (bishop/rook/queen): walk each ray until blocked; capture an enemy, stop on own. */
function slideMoves(
  board: Grid<Cell>,
  from: Coord,
  color: Color,
  dirs: readonly { dr: number; dc: number }[],
): Move[] {
  const moves: Move[] = [];
  for (const dir of dirs) {
    let r = from.row + dir.dr;
    let c = from.col + dir.dc;
    while (board.inBounds(r, c)) {
      const target = board.at(r, c);
      if (target === 'empty') {
        moves.push({ from, to: { row: r, col: c } });
      } else {
        if (cellColor(target) !== color) moves.push({ from, to: { row: r, col: c } });
        break; // blocked by any piece
      }
      r += dir.dr;
      c += dir.dc;
    }
  }
  return moves;
}

/** All pawn moves: single/double advance, diagonal captures, en passant, and promotion expansion. */
function pawnMoves(pos: Position, from: Coord, color: Color): Move[] {
  const { board } = pos;
  const dir = pawnDir(color);
  const moves: Move[] = [];
  const oneRow = from.row + dir;

  // Single advance onto an empty square.
  if (board.inBounds(oneRow, from.col) && board.at(oneRow, from.col) === 'empty') {
    pushPawn(moves, from, { row: oneRow, col: from.col }, color);
    // Double advance from the starting row, only if BOTH squares are empty.
    const twoRow = from.row + 2 * dir;
    if (
      from.row === pawnStartRow(color) &&
      board.inBounds(twoRow, from.col) &&
      board.at(twoRow, from.col) === 'empty'
    ) {
      moves.push({ from, to: { row: twoRow, col: from.col } });
    }
  }

  // Diagonal captures (including en passant).
  for (const dc of [-1, 1]) {
    const c = from.col + dc;
    if (!board.inBounds(oneRow, c)) continue;
    const target = board.at(oneRow, c);
    if (target !== 'empty' && cellColor(target) !== color) {
      pushPawn(moves, from, { row: oneRow, col: c }, color);
    } else if (
      target === 'empty' &&
      pos.enPassant &&
      pos.enPassant.row === oneRow &&
      pos.enPassant.col === c
    ) {
      // En passant: the target square is the en-passant square, empty, diagonally forward.
      moves.push({ from, to: { row: oneRow, col: c } });
    }
  }
  return moves;
}

/** Push a pawn move, expanding to the four promotion choices when it reaches the far rank. */
function pushPawn(moves: Move[], from: Coord, to: Coord, color: Color): void {
  if (to.row === promotionRow(color)) {
    for (const promotion of ['Q', 'R', 'B', 'N'] as PromotionType[]) {
      moves.push({ from, to, promotion });
    }
  } else {
    moves.push({ from, to });
  }
}

/** King moves: the eight plain steps plus castling (with the through/into/out-of-check conditions). */
function kingMoves(pos: Position, from: Coord, color: Color): Move[] {
  const { board } = pos;
  const moves = stepMoves(board, from, color, KING_STEPS);

  const backRow = color === 'w' ? 7 : 0;
  // The king only castles from its home square and only if not currently in check (cannot castle out
  // of check).
  if (from.row === backRow && from.col === 4 && !isInCheck(board, color)) {
    const enemy = otherColor(color);
    const rights = pos.castling;
    // Kingside (O-O): rook on col 7; squares 5,6 empty; king passes through 5 and lands on 6, neither
    // attacked (cannot castle THROUGH or INTO check).
    const kingsideRight = color === 'w' ? rights.wK : rights.bK;
    if (
      kingsideRight &&
      board.at(backRow, 7) === piece(color, 'R') &&
      board.at(backRow, 5) === 'empty' &&
      board.at(backRow, 6) === 'empty' &&
      !isSquareAttacked(board, backRow, 5, enemy) &&
      !isSquareAttacked(board, backRow, 6, enemy)
    ) {
      moves.push({ from, to: { row: backRow, col: 6 } });
    }
    // Queenside (O-O-O): rook on col 0; squares 1,2,3 empty; king passes through 3 and lands on 2,
    // neither attacked. Square 1 (b-file) must be empty for the rook to pass but is NOT a king square,
    // so it is not an attack test.
    const queensideRight = color === 'w' ? rights.wQ : rights.bQ;
    if (
      queensideRight &&
      board.at(backRow, 0) === piece(color, 'R') &&
      board.at(backRow, 1) === 'empty' &&
      board.at(backRow, 2) === 'empty' &&
      board.at(backRow, 3) === 'empty' &&
      !isSquareAttacked(board, backRow, 3, enemy) &&
      !isSquareAttacked(board, backRow, 2, enemy)
    ) {
      moves.push({ from, to: { row: backRow, col: 2 } });
    }
  }
  return moves;
}

// --- applying a move (produces the next position) ---------------------------------------------------

/**
 * Apply a move to a position, returning the NEW position (the input is never mutated). This is a "trust
 * the shape" apply: it assumes `move` is one the piece can make (a pseudo-legal move) and handles the
 * special mechanics (castling rook shift, en-passant capture removal, promotion, en-passant target
 * setting, castling-rights loss, and the move counters). It does NOT check the king-safety filter -
 * {@link legalMoves} does that by rejecting an apply that leaves the mover in check.
 */
export function applyMove(pos: Position, move: Move): Position {
  const { board } = pos;
  const color = pos.turn;
  const moving = board.at(move.from.row, move.from.col);
  const type = cellType(moving)!;
  const captured = board.at(move.to.row, move.to.col);

  let next = board;

  // En-passant capture: a pawn moving diagonally to the empty en-passant square captures the pawn that
  // sits on the FROM row, in the TO column.
  const isEnPassant =
    type === 'P' &&
    move.from.col !== move.to.col &&
    captured === 'empty' &&
    pos.enPassant != null &&
    pos.enPassant.row === move.to.row &&
    pos.enPassant.col === move.to.col;
  if (isEnPassant) {
    next = next.set(move.from.row, move.to.col, 'empty');
  }

  // Move the piece; a promoting pawn becomes its chosen piece (default queen if somehow unset).
  const placed =
    type === 'P' && move.to.row === promotionRow(color)
      ? piece(color, (move.promotion ?? 'Q') as PieceType)
      : moving;
  next = next.set(move.from.row, move.from.col, 'empty');
  next = next.set(move.to.row, move.to.col, placed);

  // Castling: the king moved two squares; shift the rook to the other side of the king.
  if (type === 'K' && Math.abs(move.to.col - move.from.col) === 2) {
    const backRow = move.from.row;
    if (move.to.col === 6) {
      // Kingside: rook h -> f.
      next = next.set(backRow, 7, 'empty');
      next = next.set(backRow, 5, piece(color, 'R'));
    } else if (move.to.col === 2) {
      // Queenside: rook a -> d.
      next = next.set(backRow, 0, 'empty');
      next = next.set(backRow, 3, piece(color, 'R'));
    }
  }

  // Update castling rights: any king move drops both of that color's rights; a rook leaving its home
  // square (or being captured on it) drops that side's right.
  const castling: CastlingRights = { ...pos.castling };
  dropCastlingForMove(castling, color, type, move);
  dropCastlingForCapturedRook(castling, captured, move.to);

  // En-passant target: set only when a pawn advances two squares; the square it skipped over.
  const enPassant: Coord | null =
    type === 'P' && Math.abs(move.to.row - move.from.row) === 2
      ? { row: (move.from.row + move.to.row) / 2, col: move.from.col }
      : null;

  // Move counters: the halfmove clock resets on a pawn move or any capture, else increments; the
  // fullmove number increments after Black moves.
  const isCapture = captured !== 'empty' || isEnPassant;
  const halfmove = type === 'P' || isCapture ? 0 : pos.halfmove + 1;
  const fullmove = color === 'b' ? pos.fullmove + 1 : pos.fullmove;

  return {
    board: next,
    turn: otherColor(color),
    castling,
    enPassant,
    halfmove,
    fullmove,
  };
}

/** Drop castling rights lost by the mover: a king move loses both; a rook leaving its home loses one. */
function dropCastlingForMove(
  castling: CastlingRights,
  color: Color,
  type: PieceType,
  move: Move,
): void {
  if (type === 'K') {
    if (color === 'w') {
      castling.wK = false;
      castling.wQ = false;
    } else {
      castling.bK = false;
      castling.bQ = false;
    }
  } else if (type === 'R') {
    const homeRow = color === 'w' ? 7 : 0;
    if (move.from.row === homeRow && move.from.col === 7) {
      if (color === 'w') castling.wK = false;
      else castling.bK = false;
    } else if (move.from.row === homeRow && move.from.col === 0) {
      if (color === 'w') castling.wQ = false;
      else castling.bQ = false;
    }
  }
}

/** Drop the opponent's castling right when their rook is captured on its home square. */
function dropCastlingForCapturedRook(castling: CastlingRights, captured: Cell, to: Coord): void {
  if (captured === 'wR') {
    if (to.row === 7 && to.col === 7) castling.wK = false;
    else if (to.row === 7 && to.col === 0) castling.wQ = false;
  } else if (captured === 'bR') {
    if (to.row === 0 && to.col === 7) castling.bK = false;
    else if (to.row === 0 && to.col === 0) castling.bQ = false;
  }
}

// --- legal move generation (the king-safety filter) -------------------------------------------------

/**
 * Every LEGAL move for the piece on `{row,col}`: the pseudo-legal moves that do NOT leave the mover's
 * own king in check (the pin / check-evasion filter). This is the primitive the engine validates a
 * player's move against and that check/checkmate/stalemate are derived from.
 */
export function legalMovesFrom(pos: Position, row: number, col: number): Move[] {
  const color = pos.turn;
  return pseudoMovesFrom(pos, row, col).filter((move) => {
    const after = applyMove(pos, move);
    return !isInCheck(after.board, color);
  });
}

/** Every legal move for the side to move, across all its pieces. */
export function allLegalMoves(pos: Position): Move[] {
  const moves: Move[] = [];
  pos.board.forEach((cell, coord) => {
    if (cellColor(cell) === pos.turn) {
      moves.push(...legalMovesFrom(pos, coord.row, coord.col));
    }
  });
  return moves;
}

/** True when the side to move has at least one legal move. */
export function hasLegalMove(pos: Position): boolean {
  let found = false;
  pos.board.forEach((cell, coord) => {
    if (
      !found &&
      cellColor(cell) === pos.turn &&
      legalMovesFrom(pos, coord.row, coord.col).length > 0
    ) {
      found = true;
    }
  });
  return found;
}

/**
 * Is a specific move legal for the side to move? Matched by from/to and, for a promoting pawn move, the
 * promotion piece: a promotion move must name a matching promotion; a non-promotion move matches a
 * non-promotion candidate. (So an underpromotion to a rook is a distinct legal move from a queen
 * promotion on the same squares.)
 */
export function isLegalMove(pos: Position, move: Move): boolean {
  const candidates = legalMovesFrom(pos, move.from.row, move.from.col);
  return candidates.some(
    (m) =>
      sameSquare(m.from, move.from) &&
      sameSquare(m.to, move.to) &&
      (m.promotion ?? null) === (move.promotion ?? null),
  );
}

// --- end conditions ---------------------------------------------------------------------------------

/** The outcome of a finished game, from the game state alone (resignation is handled by the module). */
export type Result = 'white' | 'black' | 'draw';

/** Checkmate: the side to move is in check and has no legal move. */
export function isCheckmate(pos: Position): boolean {
  return isInCheck(pos.board, pos.turn) && !hasLegalMove(pos);
}

/** Stalemate: the side to move is NOT in check but has no legal move (a draw). */
export function isStalemate(pos: Position): boolean {
  return !isInCheck(pos.board, pos.turn) && !hasLegalMove(pos);
}

/**
 * Draw by insufficient material: neither side has enough force to deliver checkmate. The standard
 * FIDE cases: K vs K; K+minor (bishop or knight) vs K; and K+B vs K+B with the two bishops on the
 * SAME color squares. Any pawn, rook, or queen (or two knights / bishop+knight, which CAN mate) means
 * material is sufficient, so this returns false.
 */
export function isInsufficientMaterial(pos: Position): boolean {
  const minors: { color: Color; type: PieceType; square: Coord }[] = [];
  let sufficient = false;
  pos.board.forEach((cell, coord) => {
    if (cell === 'empty') return;
    const type = cellType(cell)!;
    if (type === 'K') return;
    if (type === 'P' || type === 'R' || type === 'Q') {
      sufficient = true;
      return;
    }
    // A bishop or knight.
    minors.push({ color: cellColor(cell)!, type, square: coord });
  });
  if (sufficient) return false;

  // No minors: bare kings.
  if (minors.length === 0) return true;
  // A single minor (either side): insufficient.
  if (minors.length === 1) return true;
  // Two minors: only K+B vs K+B with same-colored bishops is a forced draw; anything else (two
  // knights, bishop+knight, or two bishops on one side) is treated as sufficient (a mate can exist or
  // the position is not a trivially dead draw).
  if (minors.length === 2) {
    const [a, b] = minors as [(typeof minors)[number], (typeof minors)[number]];
    if (
      a.type === 'B' &&
      b.type === 'B' &&
      a.color !== b.color &&
      squareColor(a.square) === squareColor(b.square)
    ) {
      return true;
    }
    return false;
  }
  return false;
}

/** The light/dark color of a square (used for the same-colored-bishops insufficient-material case). */
function squareColor(sq: Coord): 'light' | 'dark' {
  return (sq.row + sq.col) % 2 === 0 ? 'light' : 'dark';
}

/**
 * The result of a finished position from state alone: checkmate -> the mating side wins; stalemate or
 * insufficient material -> a draw. Returns null while the game continues. (The fifty-move rule and
 * threefold repetition are tracked as counters but not auto-claimed here - documented as optional.)
 */
export function resultOf(pos: Position): Result | null {
  if (isCheckmate(pos)) {
    // The side to move is checkmated, so the OTHER color won.
    return pos.turn === 'w' ? 'black' : 'white';
  }
  if (isStalemate(pos) || isInsufficientMaterial(pos)) return 'draw';
  return null;
}
