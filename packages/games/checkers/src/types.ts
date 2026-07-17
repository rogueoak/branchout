// The Checkers wire contract (spec 0055): the `sim` snapshot the engine streams and the `move` string
// a client submits. Checkers is a LIVE-model board game with PERFECT information - the whole board is
// public, so the sim is broadcast to every device (no per-player private payload, no spec 0052). The
// web decoder (apps/web/lib/games/checkers/protocol.ts) mirrors these types exactly; a drift breaks
// rendering, so they stay in lockstep.

import type { Coord } from '@branchout/game-board';

/**
 * A cell's contents, flattened for the wire: 'empty', or a piece coded by color + rank so the client
 * renders it without reconstructing the engine's Piece shape. 'violet'/'amber' are men; the '-king'
 * variants are crowned.
 */
export type WireCell = 'empty' | 'violet' | 'amber' | 'violet-king' | 'amber-king';

/**
 * The move a client submits as the `move` string: `JSON.stringify({ from, path })`. `from` is the
 * piece's square; `path` is the ordered landing squares (one entry for a plain step, one per hop for a
 * multi-jump). The engine validates legality + turn and either applies it (streaming the new board) or
 * rejects it to that one device.
 */
export interface CheckersMove {
  from: Coord;
  path: Coord[];
}

/** The winning color of a finished game: seat 0 (violet) or seat 1 (amber). No draw in this ruleset. */
export type Outcome = 'violet' | 'amber' | null;

/**
 * A live snapshot of the whole game, streamed each change as the `sim` frame. The client REPLACES its
 * state from the newest snapshot. All fields are public (perfect information): there is no hidden
 * state to withhold.
 */
export interface CheckersSim {
  /** The board size (8), so the client lays out an NxN grid without a hardcoded constant. */
  size: number;
  /** The board, row-major (`cells[row * size + col]`): each square's coded piece or 'empty'. */
  cells: WireCell[];
  /** The color to move now ('violet' | 'amber'), or null once the game is over. */
  toMove: 'violet' | 'amber' | null;
  /** The playerId whose turn it is (the client enables tapping only when this is the local player). */
  activePlayer: string;
  /** Every legal move for the side to move, so the client can highlight sources/targets and gate taps. */
  legal: CheckersMove[];
  /** Live piece counts, for the scoreboard. */
  violet: number;
  amber: number;
  /** True once the side to move has no legal move - the game is over. */
  over: boolean;
  /** The result once over ('violet' | 'amber'), else null. There is no draw. */
  outcome: Outcome;
}
