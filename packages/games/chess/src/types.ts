// The Chess wire contract (spec 0056): the `sim` snapshot the engine streams and the `move` string a
// client submits. Chess is a LIVE-model board game with PERFECT information - the whole position is
// public, so the sim is broadcast to every device (no per-player private payload, no spec 0052). The
// web decoder (apps/web/lib/games/chess/protocol.ts) mirrors these types exactly; a drift breaks
// rendering, so they stay in lockstep.

import type { Cell, PromotionType } from './rules';

/** A board cell's contents - re-exported so the web decoder can import the shared piece codes. */
export type { Cell, PromotionType };

/** A coordinate the sim/move uses: row (0 = Black back rank) and col (0 = a-file). */
export interface Square {
  row: number;
  col: number;
}

/**
 * The move a client submits as the `move` string: `JSON.stringify({ from, to, promotion? })`. The
 * engine validates FULL legality (piece geometry, path, turn, and that the move does not leave the
 * mover's own king in check) and either applies it (streaming the new position) or rejects it to that
 * one device. `promotion` is required only when a pawn reaches the far rank (else ignored).
 */
export interface ChessMove {
  from: Square;
  to: Square;
  promotion?: PromotionType;
}

/** The result of a finished game: White wins, Black wins, or a draw. */
export type Outcome = 'white' | 'black' | 'draw' | null;

/** Why a finished game ended, for the on-screen result line. */
export type EndReason = 'checkmate' | 'stalemate' | 'insufficient' | 'resign' | null;

/**
 * A live snapshot of the whole game, streamed each change as the `sim` frame. The client REPLACES its
 * state from the newest snapshot. All fields are public (perfect information); there is no hidden state.
 */
export interface ChessSim {
  /** The board size (8), so the client lays out an NxN grid without a hardcoded constant. */
  size: number;
  /** The board, row-major (`cells[row * size + col]`): each square's piece code or 'empty'. */
  cells: Cell[];
  /** The color to move ('white' | 'black'), or null once the game is over. */
  toMove: 'white' | 'black' | null;
  /** The playerId whose turn it is (the client enables tapping only when this is the local player). */
  activePlayer: string;
  /**
   * The legal moves for the side to move, so the client highlights destinations and gates taps. A
   * promotion is represented by four entries (one per piece) sharing the same from/to.
   */
  legal: ChessMove[];
  /** True when the side to move is in check (the client can flag the king). */
  check: boolean;
  /** True once the game is over. */
  over: boolean;
  /** The result once over ('white' | 'black' | 'draw'), else null. */
  outcome: Outcome;
  /** Why the game ended (checkmate / stalemate / insufficient / resign), else null. */
  endReason: EndReason;
}
