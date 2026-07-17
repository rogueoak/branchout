// The Reversi game module (spec 0054). Reversi is the FIRST board game, and it uses the LIVE model
// (like Teeter Tower): the game sits in ONE live phase, `collectMove` applies a placement to the
// shared board, and `tick` streams a `ReversiSim` when the board changes; `over` ends it. Unlike
// Teeter there is NO in-process world - the board is fully serializable and lives entirely in scratch
// - so there is no `disposeLive` (nothing to release) and a reconnect / engine restart just reads the
// board back from scratch. This is the clean board-harness path Checkers and Chess will reuse: turn
// management (Turns), the grid, move validation, board-in-scratch, and sim-on-change streaming are all
// generic; only the rules (rules.ts) are Reversi-specific.
//
// Turn model: the two players hold seat 0 (Violet, moves first) and seat 1 (Amber), assigned by
// roster order at configure. `collectMove` accepts a placement only from the seat to move and only on
// a legal square (else it rejects to that one device). After a move, if the next side has no legal
// move but the other does, the turn PASSES back automatically (a forced skip); if neither can move,
// the game is over. Standings are a custom 2-player ranking by final disc count.

import { rankStandings, type Standing } from '@branchout/protocol';
import type {
  AdvanceResult,
  ConfigureResult,
  DisputeVoteResult,
  DisputeWindowResult,
  GameModule,
  GamePlugin,
  LiveTickResult,
  RevealResult,
  RoundContext,
  ScratchResult,
  SessionPlayer,
  StartRoundResult,
} from '@branchout/game-sdk';
import { assignSeats, gridFromCells, otherSeat, Turns, type Seat } from '@branchout/game-board';
import {
  applyMove,
  BOARD_SIZE,
  discOf,
  hasLegalMove,
  isLegalMove,
  legalMoves,
  scoreOf,
  startingBoard,
  winnerOf,
  type Cell,
} from './rules';
import type { Outcome, ReversiMove, ReversiSim } from './types';

export const REVERSI_GAME_ID = 'reversi';

/** Host-supplied configuration. Reversi is fixed 8x8 standard rules; there is nothing to tune. */
export type ReversiConfig = Record<string, never>;

/** Validate + default the config. Reversi takes no options, so any object (or nothing) is accepted. */
export function validateConfig(config: unknown): ReversiConfig {
  if (config != null && typeof config !== 'object') {
    throw new Error(`reversi config must be an object or empty, got ${typeof config}`);
  }
  return {};
}

/**
 * The module's persisted state - the ENTIRE game (Reversi has no in-process world). Fully JSON-safe:
 * the board is a flat cell array, the seats are player ids, and the turn is a seat index, so a
 * reconnect / engine restart rebuilds the exact position from scratch alone.
 */
interface ReversiScratch {
  /** The board, row-major (`cells[row * BOARD_SIZE + col]`). */
  cells: Cell[];
  /** The two seats: `seats[0]` = Violet (moves first), `seats[1]` = Amber. */
  seats: [string, string];
  /** Whose seat is to move (0 or 1). */
  turn: Seat;
  /** True when the LAST turn transition was a forced pass (surfaced in the sim for a client notice). */
  passed: boolean;
  /** True once neither side can move - the game is over. */
  over: boolean;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): ReversiScratch {
  const s = scratch as Partial<ReversiScratch>;
  const cells =
    Array.isArray(s.cells) && s.cells.length === BOARD_SIZE * BOARD_SIZE
      ? (s.cells as Cell[])
      : startingBoard().toCells();
  const seats: [string, string] = Array.isArray(s.seats)
    ? [s.seats[0] ?? '', s.seats[1] ?? '']
    : ['', ''];
  return {
    cells,
    seats,
    turn: s.turn === 1 ? 1 : 0,
    passed: s.passed ?? false,
    over: s.over ?? false,
  };
}

function toRecord(scratch: ReversiScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** Rebuild the working board + turn objects from a scratch snapshot. */
function boardAndTurns(scratch: ReversiScratch): {
  board: ReturnType<typeof gridFromCells<Cell>>;
  turns: Turns;
} {
  return {
    board: gridFromCells<Cell>(BOARD_SIZE, scratch.cells),
    turns: new Turns(scratch.seats, scratch.turn),
  };
}

/** The outcome color/draw string for a finished board, or null while play continues. */
function outcomeOf(scratch: ReversiScratch): Outcome {
  if (!scratch.over) return null;
  const board = gridFromCells<Cell>(BOARD_SIZE, scratch.cells);
  const w = winnerOf(board);
  return w === 'draw' ? 'draw' : discOf(w);
}

/** Parse a `move` string into a validated `{ row, col }`, or null if malformed. */
function parseMove(move: string): ReversiMove | null {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as Partial<ReversiMove>;
  if (typeof m.row !== 'number' || !Number.isInteger(m.row)) return null;
  if (typeof m.col !== 'number' || !Number.isInteger(m.col)) return null;
  return { row: m.row, col: m.col };
}

/** The streamable ReversiSim snapshot for the current scratch. */
function toSim(scratch: ReversiScratch): ReversiSim {
  const { board, turns } = boardAndTurns(scratch);
  const score = scoreOf(board);
  const toMove = scratch.over ? null : discOf(turns.turn);
  const legal = scratch.over ? [] : legalMoves(board, turns.turn);
  return {
    size: BOARD_SIZE,
    cells: scratch.cells.slice(),
    toMove,
    activePlayer: scratch.over ? '' : turns.activePlayer(),
    legal,
    violet: score.violet,
    amber: score.amber,
    passed: scratch.passed,
    over: scratch.over,
    outcome: outcomeOf(scratch),
  };
}

/**
 * Advance the turn after a move (or the opening), resolving forced passes and game end. Given the seat
 * that WOULD move next, if that seat has a legal move it takes the turn; if not but the other seat
 * does, the turn PASSES to the other seat (a forced skip, flagged); if neither can move, the game is
 * over. Pure over the scratch board; returns the next `{turn, passed, over}`.
 */
function resolveTurn(
  board: ReturnType<typeof gridFromCells<Cell>>,
  next: Seat,
): { turn: Seat; passed: boolean; over: boolean } {
  if (hasLegalMove(board, next)) return { turn: next, passed: false, over: false };
  const other = otherSeat(next);
  if (hasLegalMove(board, other)) return { turn: other, passed: true, over: false };
  // Neither side can move: the game is over (the `turn` value is inert once `over`).
  return { turn: next, passed: false, over: true };
}

/**
 * Build a Reversi module. No per-session world and no rng: the whole game is the serializable scratch
 * board, so `create` needs no state. (The rng arg is accepted for a uniform plugin shape but unused -
 * Reversi has no randomness; both players see the same fixed opening.)
 */
export function createReversiGame(): GameModule {
  return {
    id: REVERSI_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      validateConfig(config);
      const turns = assignSeats(players);
      const scratch: ReversiScratch = {
        cells: startingBoard().toCells(),
        seats: [turns.seats[0], turns.seats[1]],
        turn: 0, // Violet (seat 0) moves first from the standard opening.
        passed: false,
        over: false,
      };
      // A live game ends via tick.over, not a round count, but the SDK requires rounds >= 1. There is
      // no move window: placements are accepted whenever it is the active player's turn.
      return { scratch: toRecord(scratch), rounds: 1, moveWindowMs: 0 };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      // Render the opening board before tick 1 by returning the sim as the prompt.
      const scratch = asScratch(ctx.scratch);
      return { scratch: toRecord(scratch), prompt: toSim(scratch) };
    },

    collectMove(ctx: RoundContext, player: string, move: string): ScratchResult {
      const scratch = asScratch(ctx.scratch);

      if (scratch.over) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'game over' },
        };
      }

      const { board, turns } = boardAndTurns(scratch);

      // Only the seat to move may place (turn enforcement; the engine replies to that one device).
      if (player !== turns.activePlayer()) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'not your turn' },
        };
      }

      const parsed = parseMove(move);
      if (!parsed) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'malformed move' },
        };
      }

      // Legality: the square must be on the board, empty, and bracket at least one opponent line.
      if (!isLegalMove(board, turns.turn, parsed.row, parsed.col)) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'illegal move' },
        };
      }

      // Apply the placement + flips, then resolve whose turn is next (handling a forced pass / end).
      const next = applyMove(board, turns.turn, parsed.row, parsed.col);
      const resolved = resolveTurn(next, otherSeat(turns.turn));
      const updated: ReversiScratch = {
        cells: next.toCells(),
        seats: scratch.seats,
        turn: resolved.turn,
        passed: resolved.passed,
        over: resolved.over,
      };
      return { scratch: toRecord(updated) };
    },

    tick(ctx: RoundContext): LiveTickResult {
      // Reversi is turn-driven, not continuously animated: the board only changes on a move, which
      // collectMove already persisted. `tick` just streams the current board (the engine broadcasts
      // the sim) and reports `over`. There is no world to step.
      const scratch = asScratch(ctx.scratch);
      return { scratch: toRecord(scratch), sim: toSim(scratch), over: scratch.over };
    },

    // --- turn-based lifecycle callbacks: present for interface completeness, unused in the live flow ---

    collectVote(ctx: RoundContext): ScratchResult {
      return { scratch: ctx.scratch as Record<string, unknown> };
    },

    reveal(ctx: RoundContext): RevealResult {
      return { scratch: ctx.scratch as Record<string, unknown>, reveal: null, scores: [] };
    },

    disputeWindow(ctx: RoundContext): DisputeWindowResult {
      return { scratch: ctx.scratch as Record<string, unknown>, disputes: [] };
    },

    disputeVote(ctx: RoundContext): DisputeVoteResult {
      return { scratch: ctx.scratch as Record<string, unknown>, scores: [] };
    },

    leaderboard(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },

    advance(): AdvanceResult {
      // Never drive rounds for a live game; a host advance defensively ends it.
      return { done: true };
    },

    endGame(ctx: RoundContext): Standing[] {
      return standingsFor(ctx);
    },

    // No `disposeLive`: Reversi holds no in-process world (the board is entirely in scratch), so there
    // is nothing to release. This is the deliberate contrast with Teeter's Matter.js world (spec 0044).
  };
}

/**
 * Custom 2-player standings by final disc count. The engine applies no reveal scores for a live game,
 * so the score IS the disc count read off the board: each seat's playerId is ranked by its color's
 * count. `rankStandings` handles the tie (an equal count -> a shared rank -> a draw).
 */
function standingsFor(ctx: RoundContext): Standing[] {
  const scratch = asScratch(ctx.scratch);
  const board = gridFromCells<Cell>(BOARD_SIZE, scratch.cells);
  const score = scoreOf(board);
  const scores: Record<string, number> = { ...ctx.scores };
  if (scratch.seats[0]) scores[scratch.seats[0]] = score.violet;
  if (scratch.seats[1]) scores[scratch.seats[1]] = score.amber;
  return rankStandings(ctx.players, scores);
}

/**
 * Reversi as a plugin the engine registers. `create` builds the module (no services needed - the game
 * is deterministic and stateless outside scratch). The manifest is `insider` so it stays off the
 * public catalog, and exactly 2 players.
 */
export const reversiPlugin: GamePlugin<ReversiConfig, ReversiSim, unknown> = {
  manifest: {
    id: REVERSI_GAME_ID,
    name: 'Reversi',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 2, maxPlayers: 2 },
    visibility: 'insider',
  },
  // Reversi is deterministic and stateless outside scratch, so it needs none of the injected services.
  create: () => createReversiGame(),
};
