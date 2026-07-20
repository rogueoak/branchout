// The Checkers game module (spec 0055). Checkers is the SECOND board game and reuses the LIVE model +
// board harness Reversi established (spec 0054): the game sits in ONE live phase, `collectMove` applies
// a move to the shared board, and `tick` streams a `CheckersSim` when the board changes; `over` ends
// it. Like Reversi there is NO in-process world - the board is fully serializable and lives entirely in
// scratch - so there is no `disposeLive`, and a reconnect / engine restart just reads the board back.
// Only the rules (rules.ts) are Checkers-specific; the turn management (Turns), the grid, the
// board-in-scratch pattern, and sim-on-change streaming all come from the shared harness.
//
// Turn model: the two players hold seat 0 (Violet, moves first, sits at the bottom) and seat 1 (Amber),
// assigned by roster order at configure. `collectMove` accepts a move only from the seat to move and
// only if it is a legal move (turn + full legality incl. mandatory capture and the full multi-jump
// path), else it rejects to that one device. After a move the turn simply flips; if the NEW side to
// move has no legal move, the game is over and that side loses (there is no forced pass or draw in
// checkers). Standings rank the two players: the winner first, then the loser (a stuck side loses even
// with pieces on the board), and the pieces-remaining count is the reported score.

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
  colorOf,
  hasLegalMove,
  isLegalMove,
  legalMoves,
  scoreOf,
  startingBoard,
  type Cell,
  type Move,
  type Piece,
} from './rules';
import type { CheckersMove, CheckersSim, Outcome, WireCell } from './types';

export const CHECKERS_GAME_ID = 'checkers';

/**
 * Host-supplied configuration. Checkers is fixed 8x8 standard rules; the one host option is whether
 * the board shows the legal-move hints (movable-source rings + destination dots). Default on; a host
 * may turn it off for a tougher game where you spot your own moves.
 */
export interface CheckersConfig {
  /** Paint the legal-move hints for the side to move. Default true. */
  showAvailableMoves: boolean;
}

/**
 * Validate + default the config. Any object (or nothing) is accepted; `showAvailableMoves` defaults to
 * true and is only off when the host explicitly set it false, so an old or empty config keeps hints on.
 */
export function validateConfig(config: unknown): CheckersConfig {
  if (config != null && typeof config !== 'object') {
    throw new Error(`checkers config must be an object or empty, got ${typeof config}`);
  }
  const raw = (config ?? {}) as Partial<CheckersConfig>;
  return { showAvailableMoves: raw.showAvailableMoves !== false };
}

/**
 * The module's persisted state - the ENTIRE game (Checkers has no in-process world). Fully JSON-safe:
 * the board is a flat cell array, the seats are player ids, and the turn is a seat index, so a
 * reconnect / engine restart rebuilds the exact position from scratch alone.
 */
interface CheckersScratch {
  /** The board, row-major (`cells[row * BOARD_SIZE + col]`). Each cell is a Piece or null. */
  cells: Cell[];
  /** The two seats: `seats[0]` = Violet (moves first), `seats[1]` = Amber. */
  seats: [string, string];
  /** Whose seat is to move (0 or 1). */
  turn: Seat;
  /** True once the side to move has no legal move - the game is over. */
  over: boolean;
  /** Host setting: whether the board paints the legal-move hints. Default true. */
  showAvailableMoves: boolean;
}

function asScratch(scratch: Readonly<Record<string, unknown>>): CheckersScratch {
  const s = scratch as Partial<CheckersScratch>;
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
    over: s.over ?? false,
    // Default ON: a scratch snapshot without the field (a pre-setting game) keeps hints on.
    showAvailableMoves: s.showAvailableMoves !== false,
  };
}

function toRecord(scratch: CheckersScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** Rebuild the working board + turn objects from a scratch snapshot. */
function boardAndTurns(scratch: CheckersScratch): {
  board: ReturnType<typeof gridFromCells<Cell>>;
  turns: Turns;
} {
  return {
    board: gridFromCells<Cell>(BOARD_SIZE, scratch.cells),
    turns: new Turns(scratch.seats, scratch.turn),
  };
}

/** Code one cell for the wire: 'empty', or color(+'-king' when crowned). */
function wireCellOf(cell: Cell): WireCell {
  if (!cell) return 'empty';
  const color = colorOf(cell.seat);
  return cell.king ? (`${color}-king` as WireCell) : color;
}

/** The outcome color for a finished board (the side NOT to move won), or null while play continues. */
function outcomeOf(scratch: CheckersScratch): Outcome {
  if (!scratch.over) return null;
  // The side to move is stuck and loses, so the OTHER seat is the winner.
  return colorOf(otherSeat(scratch.turn));
}

/** Parse a `move` string into a validated `{ from, path }`, or null if malformed. */
function parseMove(move: string): CheckersMove | null {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as Partial<CheckersMove>;
  const from = parseCoord(m.from);
  if (!from) return null;
  if (!Array.isArray(m.path) || m.path.length === 0) return null;
  const path: CheckersMove['path'] = [];
  for (const step of m.path) {
    const coord = parseCoord(step);
    if (!coord) return null;
    path.push(coord);
  }
  return { from, path };
}

function parseCoord(value: unknown): { row: number; col: number } | null {
  if (value == null || typeof value !== 'object') return null;
  const c = value as { row?: unknown; col?: unknown };
  if (typeof c.row !== 'number' || !Number.isInteger(c.row)) return null;
  if (typeof c.col !== 'number' || !Number.isInteger(c.col)) return null;
  return { row: c.row, col: c.col };
}

/** The streamable CheckersSim snapshot for the current scratch. */
function toSim(scratch: CheckersScratch): CheckersSim {
  const { board, turns } = boardAndTurns(scratch);
  const score = scoreOf(board);
  const toMove = scratch.over ? null : colorOf(turns.turn);
  // A rule Move is structurally a CheckersMove ({from, path}), so it serializes directly to the wire.
  const legal: CheckersMove[] = scratch.over ? [] : legalMoves(board, turns.turn);
  return {
    size: BOARD_SIZE,
    cells: scratch.cells.map(wireCellOf),
    toMove,
    activePlayer: scratch.over ? '' : turns.activePlayer(),
    legal,
    violet: score.violet,
    amber: score.amber,
    over: scratch.over,
    outcome: outcomeOf(scratch),
    showAvailableMoves: scratch.showAvailableMoves,
  };
}

/**
 * Resolve the game state after a move: flip the turn to the other seat, then check whether that seat
 * has any legal move. If it does, play continues on its turn; if not, the game is over (that side is
 * stuck and loses). Pure over the scratch board; returns the next `{turn, over}`.
 */
function resolveTurn(
  board: ReturnType<typeof gridFromCells<Cell>>,
  next: Seat,
): { turn: Seat; over: boolean } {
  return { turn: next, over: !hasLegalMove(board, next) };
}

/**
 * Build a Checkers module. No per-session world and no rng: the whole game is the serializable scratch
 * board, so `create` needs no state. (The rng arg is accepted for a uniform plugin shape but unused -
 * Checkers has no randomness; both players see the same fixed opening.)
 */
export function createCheckersGame(): GameModule {
  return {
    id: CHECKERS_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      const { showAvailableMoves } = validateConfig(config);
      const turns = assignSeats(players);
      const scratch: CheckersScratch = {
        cells: startingBoard().toCells(),
        seats: [turns.seats[0], turns.seats[1]],
        turn: 0, // Violet (seat 0) moves first from the standard opening.
        over: false,
        showAvailableMoves,
      };
      // A live game ends via tick.over, not a round count, but the SDK requires rounds >= 1. There is
      // no move window: moves are accepted whenever it is the active player's turn.
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

      // Only the seat to move may move (turn enforcement; the engine replies to that one device).
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

      // Legality: the move must be one of the seat's legal moves (this enforces mandatory capture and
      // the full multi-jump continuation - a partial jump is not in the legal list, so it is rejected).
      // The parsed wire move already has the {from, path} shape a rule Move needs.
      const candidate: Move = parsed;
      if (!isLegalMove(board, turns.turn, candidate)) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'illegal move' },
        };
      }

      // Apply the move (step or full jump chain + any crowning), then flip the turn and detect end.
      const next = applyMove(board, turns.turn, candidate);
      const resolved = resolveTurn(next, otherSeat(turns.turn));
      const updated: CheckersScratch = {
        cells: next.toCells(),
        seats: scratch.seats,
        turn: resolved.turn,
        over: resolved.over,
        showAvailableMoves: scratch.showAvailableMoves,
      };
      return { scratch: toRecord(updated) };
    },

    tick(ctx: RoundContext): LiveTickResult {
      // Checkers is turn-driven, not continuously animated: the board only changes on a move, which
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

    // No `disposeLive`: Checkers holds no in-process world (the board is entirely in scratch), so there
    // is nothing to release (the same board-harness contract Reversi set, spec 0054).
  };
}

/**
 * Custom 2-player standings. Checkers is won by leaving the opponent with no move, NOT by piece count -
 * a side can be stuck (and lose) with pieces still on the board - so the RANK is by the game result:
 * the winner outranks the loser once over. To express that through the shared `rankStandings` (which
 * ranks by a numeric score), the winner is given a large win bonus on top of their piece count and the
 * loser just their piece count; mid-game (not over) both are ranked by their live piece count. The
 * reported score stays meaningful (more pieces = higher), and the winner is always ranked first.
 */
function standingsFor(ctx: RoundContext): Standing[] {
  const scratch = asScratch(ctx.scratch);
  const board = gridFromCells<Cell>(BOARD_SIZE, scratch.cells);
  const score = scoreOf(board);
  const scores: Record<string, number> = { ...ctx.scores };
  const violetScore = score.violet;
  const amberScore = score.amber;
  const WIN_BONUS = 1000;
  if (scratch.over) {
    // The side to move is stuck and loses; the other side wins. Give the winner a bonus so they rank
    // first regardless of piece counts (a stuck side can still have more pieces on the board).
    const winner = otherSeat(scratch.turn);
    if (scratch.seats[0]) scores[scratch.seats[0]] = violetScore + (winner === 0 ? WIN_BONUS : 0);
    if (scratch.seats[1]) scores[scratch.seats[1]] = amberScore + (winner === 1 ? WIN_BONUS : 0);
  } else {
    if (scratch.seats[0]) scores[scratch.seats[0]] = violetScore;
    if (scratch.seats[1]) scores[scratch.seats[1]] = amberScore;
  }
  return rankStandings(ctx.players, scores);
}

/**
 * Checkers as a plugin the engine registers. `create` builds the module (no services needed - the game
 * is deterministic and stateless outside scratch). The manifest is `public` (WS14: Checkers graduated
 * from insider testing), mirroring the web module's `visibility`, and exactly 2 players.
 */
export const checkersPlugin: GamePlugin<CheckersConfig, CheckersSim, unknown> = {
  manifest: {
    id: CHECKERS_GAME_ID,
    name: 'Checkers',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 2, maxPlayers: 2 },
    visibility: 'public',
  },
  // Checkers is deterministic and stateless outside scratch, so it needs none of the injected services.
  create: () => createCheckersGame(),
};

// Re-exported for the module's own callers / tests.
export type { Piece };
