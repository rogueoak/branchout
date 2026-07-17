// The Chess game module (spec 0056). Chess is the THIRD board game and uses the LIVE model proven by
// Reversi/Checkers: the game sits in ONE live phase, `collectMove` applies a move to the shared
// position, and `tick` streams a `ChessSim` when it changes; `over` ends it. Like Reversi there is NO
// in-process world - the whole position (board + castling rights + en-passant target + move counters)
// is fully serializable and lives entirely in scratch - so there is no `disposeLive` and a reconnect /
// engine restart just reads the position back from scratch.
//
// Turn model: the two players hold seat 0 (White / Violet, moves first) and seat 1 (Black / Amber),
// assigned by roster order at configure. `collectMove` accepts a move only from the side to move and
// only if it is FULLY legal (piece geometry, path, turn, and that it does not leave the mover's own
// king in check - castling/en-passant/promotion included); else it rejects to that one device. A
// special `resign` move lets the side to move concede. The game ends on checkmate, stalemate, draw by
// insufficient material, or resignation. Standings are a custom 2-player ranking by result (win 2,
// draw 1, loss 0).

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
import { assignSeats, gridFromCells, Turns } from '@branchout/game-board';
import {
  allLegalMoves,
  applyMove,
  BOARD_SIZE,
  colorOf,
  cellColor,
  fullCastling,
  isCheckmate,
  isInCheck,
  isInsufficientMaterial,
  isLegalMove,
  isStalemate,
  seatOfColor,
  startingPosition,
  type CastlingRights,
  type Cell,
  type Color,
  type Move,
  type Position,
  type PromotionType,
} from './rules';
import type { ChessMove, ChessSim, EndReason, Outcome } from './types';

export const CHESS_GAME_ID = 'chess';

/** Host-supplied configuration. Chess is fixed standard rules; there is nothing to tune. */
export type ChessConfig = Record<string, never>;

/** Validate + default the config. Chess takes no options, so any object (or nothing) is accepted. */
export function validateConfig(config: unknown): ChessConfig {
  if (config != null && typeof config !== 'object') {
    throw new Error(`chess config must be an object or empty, got ${typeof config}`);
  }
  return {};
}

/** How a finished game ended, so the sim can label the result. */
type FinishReason = Exclude<EndReason, null>;

/**
 * The module's persisted state - the ENTIRE game (Chess has no in-process world). Fully JSON-safe: the
 * position is a flat cell array plus the FEN-like extras, the seats are player ids, so a reconnect /
 * engine restart rebuilds the exact game from scratch alone.
 */
interface ChessScratch {
  /** The board, row-major (`cells[row * BOARD_SIZE + col]`). */
  cells: Cell[];
  /** The color to move ('w' | 'b'). */
  turn: Color;
  /** Which castles are still potentially available. */
  castling: CastlingRights;
  /** The en-passant target square (the skipped square of a double pawn push), or null. */
  enPassant: { row: number; col: number } | null;
  /** The halfmove clock (plies since the last capture or pawn move), for the fifty-move rule. */
  halfmove: number;
  /** The fullmove number (increments after each Black move). */
  fullmove: number;
  /** The two seats: `seats[0]` = White (Violet, moves first), `seats[1]` = Black (Amber). */
  seats: [string, string];
  /** True once the game is over. */
  over: boolean;
  /** The result once over, else null. */
  outcome: Outcome;
  /** Why the game ended, else null. */
  endReason: FinishReason | null;
}

function defaultCastling(value: unknown): CastlingRights {
  const c = (value ?? {}) as Partial<CastlingRights>;
  return {
    wK: c.wK ?? false,
    wQ: c.wQ ?? false,
    bK: c.bK ?? false,
    bQ: c.bQ ?? false,
  };
}

function asScratch(scratch: Readonly<Record<string, unknown>>): ChessScratch {
  const s = scratch as Partial<ChessScratch>;
  const start = startingPosition();
  const cells =
    Array.isArray(s.cells) && s.cells.length === BOARD_SIZE * BOARD_SIZE
      ? (s.cells as Cell[])
      : start.board.toCells();
  const seats: [string, string] = Array.isArray(s.seats)
    ? [s.seats[0] ?? '', s.seats[1] ?? '']
    : ['', ''];
  const ep = s.enPassant;
  const enPassant =
    ep && typeof ep.row === 'number' && typeof ep.col === 'number'
      ? { row: ep.row, col: ep.col }
      : null;
  const outcome: Outcome =
    s.outcome === 'white' || s.outcome === 'black' || s.outcome === 'draw' ? s.outcome : null;
  const endReason: FinishReason | null =
    s.endReason === 'checkmate' ||
    s.endReason === 'stalemate' ||
    s.endReason === 'insufficient' ||
    s.endReason === 'resign'
      ? s.endReason
      : null;
  return {
    cells,
    turn: s.turn === 'b' ? 'b' : 'w',
    castling: s.castling ? defaultCastling(s.castling) : fullCastling(),
    enPassant,
    halfmove: typeof s.halfmove === 'number' ? s.halfmove : 0,
    fullmove: typeof s.fullmove === 'number' ? s.fullmove : 1,
    seats,
    over: s.over ?? false,
    outcome,
    endReason,
  };
}

function toRecord(scratch: ChessScratch): Record<string, unknown> {
  return scratch as unknown as Record<string, unknown>;
}

/** Rebuild a working {@link Position} from a scratch snapshot. */
function positionOf(scratch: ChessScratch): Position {
  return {
    board: gridFromCells<Cell>(BOARD_SIZE, scratch.cells),
    turn: scratch.turn,
    castling: scratch.castling,
    enPassant: scratch.enPassant,
    halfmove: scratch.halfmove,
    fullmove: scratch.fullmove,
  };
}

/** The Turns object for whose seat is to move (derived from the position's side to move). */
function turnsOf(scratch: ChessScratch): Turns {
  return new Turns(scratch.seats, seatOfColor(scratch.turn));
}

/** Map an internal color to the wire 'white'|'black'. */
function outcomeColor(color: Color): 'white' | 'black' {
  return color === 'w' ? 'white' : 'black';
}

/** Parse a `move` string into a validated {@link ChessMove} (or a resign marker), or null if malformed. */
type ParsedMove = { kind: 'move'; move: ChessMove } | { kind: 'resign' } | null;
function parseMove(move: string): ParsedMove {
  let raw: unknown;
  try {
    raw = JSON.parse(move);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.resign === true) return { kind: 'resign' };
  const from = asSquare(m.from);
  const to = asSquare(m.to);
  if (!from || !to) return null;
  const promotion = asPromotion(m.promotion);
  return { kind: 'move', move: promotion ? { from, to, promotion } : { from, to } };
}

function asSquare(value: unknown): { row: number; col: number } | null {
  if (value == null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.row !== 'number' || !Number.isInteger(v.row)) return null;
  if (typeof v.col !== 'number' || !Number.isInteger(v.col)) return null;
  return { row: v.row, col: v.col };
}

function asPromotion(value: unknown): PromotionType | undefined {
  return value === 'Q' || value === 'R' || value === 'B' || value === 'N' ? value : undefined;
}

/** Convert an internal rule Move to the wire ChessMove shape. */
function toWireMove(m: Move): ChessMove {
  return m.promotion
    ? { from: m.from, to: m.to, promotion: m.promotion }
    : { from: m.from, to: m.to };
}

/** The streamable ChessSim snapshot for the current scratch. */
function toSim(scratch: ChessScratch): ChessSim {
  const pos = positionOf(scratch);
  const turns = turnsOf(scratch);
  const toMove = scratch.over ? null : outcomeColor(scratch.turn);
  const legal = scratch.over ? [] : allLegalMoves(pos).map(toWireMove);
  const check = scratch.over ? false : isInCheck(pos.board, scratch.turn);
  return {
    size: BOARD_SIZE,
    cells: scratch.cells.slice(),
    toMove,
    activePlayer: scratch.over ? '' : turns.activePlayer(),
    legal,
    check,
    over: scratch.over,
    outcome: scratch.outcome,
    endReason: scratch.endReason,
  };
}

/**
 * Resolve the end of the game AFTER a move is applied: checkmate -> the mover won; stalemate or
 * insufficient material -> a draw; otherwise play continues. Pure over the position; returns the
 * `{over, outcome, endReason}` to fold into scratch.
 */
function resolveEnd(pos: Position): {
  over: boolean;
  outcome: Outcome;
  endReason: FinishReason | null;
} {
  if (isCheckmate(pos)) {
    // The side to move (pos.turn) is checkmated, so the OTHER color won.
    const winner: Color = pos.turn === 'w' ? 'b' : 'w';
    return { over: true, outcome: outcomeColor(winner), endReason: 'checkmate' };
  }
  if (isStalemate(pos)) return { over: true, outcome: 'draw', endReason: 'stalemate' };
  if (isInsufficientMaterial(pos))
    return { over: true, outcome: 'draw', endReason: 'insufficient' };
  return { over: false, outcome: null, endReason: null };
}

/**
 * Build a Chess module. No per-session world and no rng: the whole game is the serializable scratch
 * position, so `create` needs no state. (Both players see the same fixed opening; there is no
 * randomness.)
 */
export function createChessGame(): GameModule {
  return {
    id: CHESS_GAME_ID,

    configure(config: unknown, players: readonly SessionPlayer[]): ConfigureResult {
      validateConfig(config);
      const turns = assignSeats(players);
      const start = startingPosition();
      const scratch: ChessScratch = {
        cells: start.board.toCells(),
        turn: 'w',
        castling: start.castling,
        enPassant: null,
        halfmove: 0,
        fullmove: 1,
        seats: [turns.seats[0], turns.seats[1]],
        over: false,
        outcome: null,
        endReason: null,
      };
      // A live game ends via tick.over, not a round count, but the SDK requires rounds >= 1. There is
      // no move window: moves are accepted whenever it is the active player's turn.
      return { scratch: toRecord(scratch), rounds: 1, moveWindowMs: 0 };
    },

    startRound(ctx: RoundContext): StartRoundResult {
      // Render the opening position before tick 1 by returning the sim as the prompt.
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

      const turns = turnsOf(scratch);

      // Only the side to move may act (turn enforcement; the engine replies to that one device).
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

      // Resignation: the side to move concedes; the other color wins.
      if (parsed.kind === 'resign') {
        const winner: Color = scratch.turn === 'w' ? 'b' : 'w';
        const updated: ChessScratch = {
          ...scratch,
          over: true,
          outcome: outcomeColor(winner),
          endReason: 'resign',
        };
        return { scratch: toRecord(updated) };
      }

      const pos = positionOf(scratch);
      const wire = parsed.move;
      const ruleMove: Move = wire.promotion
        ? { from: wire.from, to: wire.to, promotion: wire.promotion }
        : { from: wire.from, to: wire.to };

      // Full legality: geometry, path, turn, castling/en-passant conditions, AND that the move does not
      // leave the mover's own king in check. isLegalMove is the single authority.
      if (!isLegalMove(pos, ruleMove)) {
        return {
          scratch: ctx.scratch as Record<string, unknown>,
          rejected: { reason: 'illegal move' },
        };
      }

      // Apply the move, then resolve the end state (checkmate / stalemate / insufficient material).
      const after = applyMove(pos, ruleMove);
      const end = resolveEnd(after);
      const updated: ChessScratch = {
        cells: after.board.toCells(),
        turn: after.turn,
        castling: after.castling,
        enPassant: after.enPassant,
        halfmove: after.halfmove,
        fullmove: after.fullmove,
        seats: scratch.seats,
        over: end.over,
        outcome: end.outcome,
        endReason: end.endReason,
      };
      return { scratch: toRecord(updated) };
    },

    tick(ctx: RoundContext): LiveTickResult {
      // Chess is turn-driven, not continuously animated: the position only changes on a move, which
      // collectMove already persisted. `tick` streams the current position and reports `over`.
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

    // No `disposeLive`: Chess holds no in-process world (the whole position is in scratch), so there is
    // nothing to release.
  };
}

/**
 * Custom 2-player standings by result. The engine applies no reveal scores for a live game, so the score
 * IS the game result: the winner gets 2, a draw gives each 1, the loser 0. While the game is unfinished
 * both sit at 0 (a draw-in-progress), which `rankStandings` renders as a tie. This keeps the engine's
 * individual-standings contract.
 */
function standingsFor(ctx: RoundContext): Standing[] {
  const scratch = asScratch(ctx.scratch);
  const scores: Record<string, number> = { ...ctx.scores };
  const white = scratch.seats[0];
  const black = scratch.seats[1];
  let whiteScore = 0;
  let blackScore = 0;
  if (scratch.over) {
    if (scratch.outcome === 'white') whiteScore = 2;
    else if (scratch.outcome === 'black') blackScore = 2;
    else if (scratch.outcome === 'draw') {
      whiteScore = 1;
      blackScore = 1;
    }
  }
  if (white) scores[white] = whiteScore;
  if (black) scores[black] = blackScore;
  return rankStandings(ctx.players, scores);
}

/**
 * Chess as a plugin the engine registers. `create` builds the module (no services needed - the game is
 * deterministic and stateless outside scratch). The manifest is `insider` so it stays off the public
 * catalog, and exactly 2 players.
 */
export const chessPlugin: GamePlugin<ChessConfig, ChessSim, unknown> = {
  manifest: {
    id: CHESS_GAME_ID,
    name: 'Chess',
    version: '1.0.0',
    configSchema: validateConfig,
    capabilities: { minPlayers: 2, maxPlayers: 2 },
    visibility: 'insider',
  },
  // Chess is deterministic and stateless outside scratch, so it needs none of the injected services.
  create: () => createChessGame(),
};

// Re-exported for the module's own tests + any consumer needing the color mapping.
export { colorOf, cellColor };
