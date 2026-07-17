// Chess's live-snapshot decoder for the game-pluggable client (spec 0056). Chess is a LIVE-model board
// game with PERFECT information: the engine streams the whole position on the `sim` frame and the web is
// a pure renderer that decodes that opaque `unknown` snapshot here at the client boundary. A shape the
// renderer does not understand is a null (a skipped render), never a thrown one. These types mirror
// packages/games/chess/src/types.ts exactly; a drift here breaks rendering, so they stay in lockstep.

/** A piece color. */
export type Color = 'w' | 'b';

/** A piece type: Pawn, Knight, Bishop, Rook, Queen, King. */
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';

/** A board cell: 'empty' or a two-character `<color><type>` piece code (e.g. 'wP', 'bK'). */
export type Cell = 'empty' | `${Color}${PieceType}`;

/** The four promotion choices. */
export type PromotionType = 'Q' | 'R' | 'B' | 'N';

/** A board square: row (0 = Black back rank) and col (0 = a-file). */
export interface Square {
  row: number;
  col: number;
}

/** The move a client submits as the `move` string: `JSON.stringify({ from, to, promotion? })`. */
export interface ChessMove {
  from: Square;
  to: Square;
  promotion?: PromotionType;
}

/** The result of a finished game. */
export type Outcome = 'white' | 'black' | 'draw' | null;

/** Why a finished game ended, for the on-screen result line. */
export type EndReason = 'checkmate' | 'stalemate' | 'insufficient' | 'resign' | null;

/**
 * A live snapshot of the whole game, streamed on the `sim` frame. The client REPLACES its state from the
 * newest snapshot. Everything is public (perfect information) - there is no hidden field.
 */
export interface ChessSim {
  size: number;
  cells: Cell[];
  toMove: 'white' | 'black' | null;
  activePlayer: string;
  legal: ChessMove[];
  check: boolean;
  over: boolean;
  outcome: Outcome;
  endReason: EndReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

const PIECE_TYPES = new Set<string>(['P', 'N', 'B', 'R', 'Q', 'K']);

function asCell(value: unknown): Cell | null {
  if (value === 'empty') return 'empty';
  if (typeof value !== 'string' || value.length !== 2) return null;
  const color = value[0];
  const type = value[1];
  if ((color === 'w' || color === 'b') && PIECE_TYPES.has(type!)) return value as Cell;
  return null;
}

/** Decode the row-major cell array; returns null if any entry is not a valid cell. */
function asCells(value: unknown, expected: number): Cell[] | null {
  if (!Array.isArray(value) || value.length !== expected) return null;
  const out: Cell[] = [];
  for (const item of value) {
    const cell = asCell(item);
    if (!cell) return null;
    out.push(cell);
  }
  return out;
}

function asSquare(value: unknown): Square | null {
  if (!isRecord(value)) return null;
  return isInt(value.row) && isInt(value.col) ? { row: value.row, col: value.col } : null;
}

function asPromotion(value: unknown): PromotionType | undefined {
  return value === 'Q' || value === 'R' || value === 'B' || value === 'N' ? value : undefined;
}

/** Decode a single move `{ from, to, promotion? }`, or null. */
function asMove(value: unknown): ChessMove | null {
  if (!isRecord(value)) return null;
  const from = asSquare(value.from);
  const to = asSquare(value.to);
  if (!from || !to) return null;
  const promotion = asPromotion(value.promotion);
  return promotion ? { from, to, promotion } : { from, to };
}

/** Decode the legal-move list; returns null if any entry is malformed. */
function asMoves(value: unknown): ChessMove[] | null {
  if (!Array.isArray(value)) return null;
  const out: ChessMove[] = [];
  for (const item of value) {
    const move = asMove(item);
    if (!move) return null;
    out.push(move);
  }
  return out;
}

function asToMove(value: unknown): 'white' | 'black' | null {
  return value === 'white' || value === 'black' ? value : null;
}

function asOutcome(value: unknown): Outcome {
  return value === 'white' || value === 'black' || value === 'draw' ? value : null;
}

function asEndReason(value: unknown): EndReason {
  return value === 'checkmate' ||
    value === 'stalemate' ||
    value === 'insufficient' ||
    value === 'resign'
    ? value
    : null;
}

/**
 * Decode a `sim` payload as a Chess live snapshot, or null if it is not one. The board size drives the
 * expected cell count, so a mismatched board is rejected as a whole (a skipped render) rather than
 * rendered half-decoded.
 */
export function asChessSim(value: unknown): ChessSim | null {
  if (!isRecord(value)) return null;
  if (!isInt(value.size) || value.size <= 0) return null;
  const cells = asCells(value.cells, value.size * value.size);
  const legal = asMoves(value.legal);
  if (
    cells &&
    legal &&
    typeof value.activePlayer === 'string' &&
    typeof value.check === 'boolean' &&
    typeof value.over === 'boolean'
  ) {
    return {
      size: value.size,
      cells,
      toMove: value.toMove === null ? null : asToMove(value.toMove),
      activePlayer: value.activePlayer,
      legal,
      check: value.check,
      over: value.over,
      outcome: asOutcome(value.outcome),
      endReason: asEndReason(value.endReason),
    };
  }
  return null;
}
