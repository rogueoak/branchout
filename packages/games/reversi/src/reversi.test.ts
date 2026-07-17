// Reversi module tests (spec 0054 - live board model). These prove the lifecycle wiring over the pure
// rules: configure assigns seats + the opening, collectMove enforces turn + legality (rejecting to the
// device), applying a move flips + advances the turn, a forced pass skips a stuck side, the game ends
// when neither can move, tick streams the sim, and standings rank by final disc count.

import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createReversiGame, REVERSI_GAME_ID } from './reversi';
import { BOARD_SIZE, type Cell } from './rules';
import type { ReversiSim } from './types';

/** Call the module's `tick` (which is optional on GameModule but always present for a live game). */
function tick(game: ReturnType<typeof createReversiGame>, context: RoundContext): ReversiSim {
  if (!game.tick) throw new Error('reversi is a live game and must implement tick');
  return game.tick(context).sim as ReversiSim;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id, connected: true }));
}

function ctx(overrides: Partial<RoundContext>): RoundContext {
  return {
    room: 'r',
    game: REVERSI_GAME_ID,
    phase: 'collecting',
    round: 1,
    players: players('violet', 'amber'),
    scores: {},
    scratch: {},
    config: {},
    ...overrides,
  };
}

/** A cells array from a board picture ('.' empty, 'V' violet, 'A' amber). */
function cellsFrom(rows: string[]): Cell[] {
  const cells: Cell[] = [];
  for (const row of rows) {
    for (const ch of row) cells.push(ch === 'V' ? 'violet' : ch === 'A' ? 'amber' : 'empty');
  }
  return cells;
}

const mv = (row: number, col: number): string => JSON.stringify({ row, col });

describe('configure', () => {
  it('assigns seat 0 to the first player and opens on the standard position', () => {
    const game = createReversiGame();
    const result = game.configure({}, players('violet', 'amber'));
    const s = result.scratch as { seats: string[]; turn: number; cells: Cell[] };
    expect(s.seats).toEqual(['violet', 'amber']);
    expect(s.turn).toBe(0);
    expect(s.cells).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });

  it('accepts an empty/object config, rejects a non-object', () => {
    const game = createReversiGame();
    expect(() => game.configure({}, players('violet', 'amber'))).not.toThrow();
    expect(() => game.configure(undefined, players('violet', 'amber'))).not.toThrow();
    expect(() => game.configure(42, players('violet', 'amber'))).toThrow();
  });
});

describe('startRound', () => {
  it('returns the opening board as the prompt sim', () => {
    const game = createReversiGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const started = game.startRound(ctx({ scratch }));
    const sim = started.prompt as ReversiSim;
    expect(sim.size).toBe(BOARD_SIZE);
    expect(sim.toMove).toBe('violet');
    expect(sim.activePlayer).toBe('violet');
    expect(sim.violet).toBe(2);
    expect(sim.amber).toBe(2);
    // Violet has the four standard opening moves highlighted.
    expect(sim.legal).toHaveLength(4);
  });
});

describe('collectMove - turn + legality enforcement', () => {
  it('rejects a move from the player who is not to move', () => {
    const game = createReversiGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const res = game.collectMove(ctx({ scratch }), 'amber', mv(2, 3));
    expect(res.rejected).toEqual({ reason: 'not your turn' });
  });

  it('rejects an illegal placement', () => {
    const game = createReversiGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    // (0,0) brackets nothing from the opening.
    const res = game.collectMove(ctx({ scratch }), 'violet', mv(0, 0));
    expect(res.rejected).toEqual({ reason: 'illegal move' });
  });

  it('rejects a malformed move', () => {
    const game = createReversiGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const res = game.collectMove(ctx({ scratch }), 'violet', 'not json');
    expect(res.rejected).toEqual({ reason: 'malformed move' });
  });

  it('rejects any move once the game is over', () => {
    const game = createReversiGame();
    // A finished board (over: true). Even the seat to move is refused - the game accepts no more moves.
    const full = cellsFrom([
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'AAAAAAAA',
      'AAAAAAAA',
      'AAAAAAAA',
      'AAAAAAAA',
    ]);
    const scratch = { cells: full, seats: ['violet', 'amber'], turn: 0, passed: false, over: true };
    const res = game.collectMove(ctx({ scratch }), 'violet', mv(0, 0));
    expect(res.rejected).toEqual({ reason: 'game over' });
  });

  it('applies a legal move: flips the bracketed disc and passes the turn to amber', () => {
    const game = createReversiGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const res = game.collectMove(ctx({ scratch }), 'violet', mv(2, 3));
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { cells: Cell[]; turn: number };
    // After violet's opening move, it's amber's turn.
    expect(s.turn).toBe(1);
    // Violet now has 4 discs, amber 1 (one flipped).
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.violet).toBe(4);
    expect(sim.amber).toBe(1);
    expect(sim.toMove).toBe('amber');
    expect(sim.activePlayer).toBe('amber');
  });
});

describe('forced pass', () => {
  it('skips a side with no legal move and flags the pass', () => {
    const game = createReversiGame();
    // A verified position (found by brute-force search): it is violet to move and violet plays (0,2);
    // after that flip AMBER has no legal move but VIOLET still does, so the turn PASSES back to violet
    // and `passed` is flagged. This exercises the forced-skip branch of resolveTurn end to end.
    const cells = cellsFrom([
      'AV.VAA.A',
      'AAAVAAAV',
      'VVVAVAVV',
      'AVVAVAVA',
      'AAVAAAVV',
      'VAAVVAAV',
      'AVVAAVVV',
      'VVAVVVAV',
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 0, passed: false, over: false };
    const res = game.collectMove(ctx({ scratch }), 'violet', mv(0, 2));
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { turn: number; passed: boolean; over: boolean };
    // Amber was skipped: the turn came back to violet (seat 0) with the pass flagged, not over.
    expect(s.over).toBe(false);
    expect(s.passed).toBe(true);
    expect(s.turn).toBe(0);
  });
});

describe('game over + standings', () => {
  it('ends when neither side can move and ranks by disc count', () => {
    const game = createReversiGame();
    // A full, violet-majority board: no empty squares, so neither side can move -> over. Violet 40,
    // amber 24.
    const full = cellsFrom([
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'AAAAAAAA',
      'AAAAAAAA',
      'AAAAAAAA',
    ]);
    const scratch = { cells: full, seats: ['violet', 'amber'], turn: 0, passed: false, over: true };
    const sim = tick(game, ctx({ scratch }));
    expect(sim.over).toBe(true);
    expect(sim.outcome).toBe('violet'); // 40 violet vs 24 amber
    const standings = game.endGame(ctx({ scratch }));
    // Violet ranks first (more discs).
    const violet = standings.find((s) => s.player === 'violet');
    const amber = standings.find((s) => s.player === 'amber');
    expect(violet?.rank).toBe(1);
    expect(amber?.rank).toBe(2);
    expect(violet?.score).toBe(40);
    expect(amber?.score).toBe(24);
  });

  it('reaches over through a real move on a near-terminal board (not a pre-set flag)', () => {
    const game = createReversiGame();
    // A near-terminal position (verified by search): the board is full except (0,0). Violet has NO
    // legal move; amber's ONLY legal move is (0,0), which along the top row brackets the whole run of
    // violet discs up to amber at (0,7). Filling it makes the board full, so AFTER the move neither
    // side can move and the game ends - driven entirely through collectMove -> resolveTurn's over
    // branch, not an injected over:true. A regression that stops setting `over` on the last move
    // would fail here.
    const cells = cellsFrom([
      '.VVVVVVA',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
    ]);
    // turn 1 = amber to move (the only side with a move); over is NOT pre-set.
    const scratch = { cells, seats: ['violet', 'amber'], turn: 1, passed: false, over: false };
    const res = game.collectMove(ctx({ scratch }), 'amber', mv(0, 0));
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { over: boolean; cells: Cell[] };
    // The over flag was produced by the move, not injected.
    expect(s.over).toBe(true);
    expect(s.cells.includes('empty')).toBe(false);
    // And a subsequent tick agrees the game is over.
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.over).toBe(true);
    expect(sim.toMove).toBeNull();
    // Amber's last move flips the top-row violets, but violet still holds the board majority.
    expect(sim.outcome).toBe('violet');
    expect(sim.violet).toBe(56);
    expect(sim.amber).toBe(8);
  });

  it('reports a draw and shared rank on an equal disc count', () => {
    const game = createReversiGame();
    const tied = cellsFrom([
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'AAAAAAAA',
      'AAAAAAAA',
      'AAAAAAAA',
      'AAAAAAAA',
    ]);
    const scratch = { cells: tied, seats: ['violet', 'amber'], turn: 0, passed: false, over: true };
    const sim = tick(game, ctx({ scratch }));
    expect(sim.outcome).toBe('draw');
    const standings = game.endGame(ctx({ scratch }));
    expect(standings.every((s) => s.rank === 1)).toBe(true);
  });
});

describe('tick', () => {
  it('streams the current board without a world to step', () => {
    const game = createReversiGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const sim = tick(game, ctx({ scratch }));
    expect(sim.over).toBe(false);
    expect(sim.cells).toHaveLength(BOARD_SIZE * BOARD_SIZE);
  });
});
