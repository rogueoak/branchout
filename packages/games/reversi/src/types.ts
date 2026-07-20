// The Reversi wire contract (spec 0054): the `sim` snapshot the engine streams and the `move` string
// a client submits. Reversi is a LIVE-model board game with PERFECT information - the whole board is
// public, so the sim is broadcast to every device (no per-player private payload, no spec 0052). The
// web decoder (apps/web/lib/games/reversi/protocol.ts) mirrors these types exactly; a drift breaks
// rendering, so they stay in lockstep.

import type { Cell } from './rules';

/** A disc color, or an empty square - the cell contents streamed for every board square. */
export type { Cell };

/**
 * The move a client submits as the `move` string: `JSON.stringify({ row, col })` - the empty square
 * the active player places their disc on. The engine validates legality + turn and either applies it
 * (streaming the new board) or rejects it to that one device.
 */
export interface ReversiMove {
  row: number;
  col: number;
}

/** The winner of a finished game: seat 0 (violet), seat 1 (amber), or a draw. */
export type Outcome = 'violet' | 'amber' | 'draw' | null;

/**
 * A live snapshot of the whole game, streamed each change as the `sim` frame. The client REPLACES its
 * state from the newest snapshot. All fields are public (perfect information): there is no hidden
 * state to withhold.
 */
export interface ReversiSim {
  /** The board size (8), so the client lays out an NxN grid without a hardcoded constant. */
  size: number;
  /** The board, row-major (`cells[row * size + col]`): each square's disc color or 'empty'. */
  cells: Cell[];
  /** The color to move now ('violet' | 'amber'), or null once the game is over. */
  toMove: Exclude<Cell, 'empty'> | null;
  /** The playerId whose turn it is (the client enables tapping only when this is the local player). */
  activePlayer: string;
  /** The squares the active player may legally place on, so the client highlights + gates taps. */
  legal: ReversiMove[];
  /** Live disc counts, for the scoreboard. */
  violet: number;
  amber: number;
  /**
   * True when the previous turn was a forced PASS (the side to move had no legal move and was
   * skipped), so the client can announce "Amber had no move - Violet plays again". Cleared on the
   * next real move.
   */
  passed: boolean;
  /** True once neither side can move - the game is over. */
  over: boolean;
  /** The result once over ('violet' | 'amber' | 'draw'), else null. */
  outcome: Outcome;
  /**
   * Whether the board should paint the legal-move hint dots for the side to move. Host-configured
   * (default true); a host may turn it off for a tougher game. Streamed in the sim so the pure
   * renderer reads it off state like everything else - no separate config channel to the client.
   */
  showAvailableMoves: boolean;
}
