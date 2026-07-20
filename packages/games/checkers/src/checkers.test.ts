// Checkers module tests (spec 0055 - live board model). These prove the lifecycle wiring over the pure
// rules: configure assigns seats + the opening, collectMove enforces turn + legality (rejecting to the
// device, incl. mandatory capture and full multi-jump), applying a move flips the turn, the game ends
// when the side to move is stuck - reached through a REAL capturing move, not an injected flag - tick
// streams the sim, and standings rank the winner first.

import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { createCheckersGame, CHECKERS_GAME_ID, validateConfig } from './checkers';
import { BOARD_SIZE, type Cell, type Piece } from './rules';
import type { CheckersSim } from './types';

/** Call the module's `tick` (optional on GameModule but always present for a live game). */
function tick(game: ReturnType<typeof createCheckersGame>, context: RoundContext): CheckersSim {
  if (!game.tick) throw new Error('checkers is a live game and must implement tick');
  return game.tick(context).sim as CheckersSim;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id, connected: true }));
}

function ctx(overrides: Partial<RoundContext>): RoundContext {
  return {
    room: 'r',
    game: CHECKERS_GAME_ID,
    phase: 'collecting',
    round: 1,
    players: players('violet', 'amber'),
    scores: {},
    scratch: {},
    config: {},
    ...overrides,
  };
}

const V = (king = false): Piece => ({ seat: 0, king });
const A = (king = false): Piece => ({ seat: 1, king });

/** A cells array from a board picture ('.' empty, 'v'/'V' violet man/king, 'a'/'A' amber man/king). */
function cellsFrom(rows: string[]): Cell[] {
  const cells: Cell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push(
        ch === 'v' ? V() : ch === 'V' ? V(true) : ch === 'a' ? A() : ch === 'A' ? A(true) : null,
      );
    }
  }
  return cells;
}

const EMPTY_ROW = '........';

/** A move string as the client sends it. */
const mv = (from: [number, number], path: [number, number][]): string =>
  JSON.stringify({
    from: { row: from[0], col: from[1] },
    path: path.map(([row, col]) => ({ row, col })),
  });

describe('configure', () => {
  it('assigns seat 0 to the first player and opens on the standard position', () => {
    const game = createCheckersGame();
    const result = game.configure({}, players('violet', 'amber'));
    const s = result.scratch as { seats: string[]; turn: number; cells: Cell[] };
    expect(s.seats).toEqual(['violet', 'amber']);
    expect(s.turn).toBe(0);
    expect(s.cells).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    // 12 men each at the opening.
    expect(s.cells.filter((c) => c?.seat === 0)).toHaveLength(12);
    expect(s.cells.filter((c) => c?.seat === 1)).toHaveLength(12);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });

  it('accepts an empty/object config, rejects a non-object', () => {
    const game = createCheckersGame();
    expect(() => game.configure({}, players('violet', 'amber'))).not.toThrow();
    expect(() => game.configure(undefined, players('violet', 'amber'))).not.toThrow();
    expect(() => game.configure(42, players('violet', 'amber'))).toThrow();
  });
});

describe('showAvailableMoves (authoritative host setting)', () => {
  it('defaults ON when the config omits it, and threads into the prompt + streamed sim', () => {
    // The ENGINE is the source of truth for the hint default (the web mirror only follows it); a
    // regression to default-off here would silently kill hints for the now-public game.
    expect(validateConfig({}).showAvailableMoves).toBe(true);
    expect(validateConfig(undefined).showAvailableMoves).toBe(true);
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    expect((scratch as { showAvailableMoves: boolean }).showAvailableMoves).toBe(true);
    // It threads into the prompt the client first renders...
    const started = game.startRound(ctx({ scratch }));
    expect((started.prompt as CheckersSim).showAvailableMoves).toBe(true);
    // ...and into the streamed tick sim the board renders from.
    expect(tick(game, ctx({ scratch })).showAvailableMoves).toBe(true);
  });

  it('is OFF only when the host explicitly turns it off, and that threads through too', () => {
    expect(validateConfig({ showAvailableMoves: false }).showAvailableMoves).toBe(false);
    const game = createCheckersGame();
    const scratch = game.configure(
      { showAvailableMoves: false },
      players('violet', 'amber'),
    ).scratch;
    expect(tick(game, ctx({ scratch })).showAvailableMoves).toBe(false);
  });
});

describe('startRound', () => {
  it('returns the opening board as the prompt sim, violet to move', () => {
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const started = game.startRound(ctx({ scratch }));
    const sim = started.prompt as CheckersSim;
    expect(sim.size).toBe(BOARD_SIZE);
    expect(sim.toMove).toBe('violet');
    expect(sim.activePlayer).toBe('violet');
    expect(sim.violet).toBe(12);
    expect(sim.amber).toBe(12);
    // The opening has plain-step moves only (no jumps yet).
    expect(sim.legal.length).toBeGreaterThan(0);
    expect(sim.legal.every((m) => m.path.length === 1)).toBe(true);
    // The wire cells are the flattened codes, not engine Piece objects.
    expect(sim.cells).toContain('violet');
    expect(sim.cells).toContain('amber');
    expect(sim.cells).toContain('empty');
  });
});

describe('collectMove - turn + legality enforcement', () => {
  it('rejects a move from the player who is not to move', () => {
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const res = game.collectMove(ctx({ scratch }), 'amber', mv([2, 1], [[3, 0]]));
    expect(res.rejected).toEqual({ reason: 'not your turn' });
  });

  it('rejects a malformed move', () => {
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const res = game.collectMove(ctx({ scratch }), 'violet', 'not json');
    expect(res.rejected).toEqual({ reason: 'malformed move' });
  });

  it('rejects an illegal placement (a non-diagonal / blocked move)', () => {
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    // A man on row 5 cannot jump straight to row 4 col 0 in a straight line.
    const res = game.collectMove(ctx({ scratch }), 'violet', mv([5, 0], [[4, 0]]));
    expect(res.rejected).toEqual({ reason: 'illegal move' });
  });

  it('rejects a plain step when a capture is available (mandatory capture)', () => {
    const game = createCheckersGame();
    // Violet man at (4,3) can jump amber at (3,2). A different violet man at (6,1) could step, but the
    // mandatory-capture rule makes that step illegal this turn.
    const cells = cellsFrom([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..a.....',
      '...v....',
      EMPTY_ROW,
      '.v......',
      EMPTY_ROW,
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 0, over: false };
    // The free man's step is rejected...
    const stepRes = game.collectMove(ctx({ scratch }), 'violet', mv([6, 1], [[5, 0]]));
    expect(stepRes.rejected).toEqual({ reason: 'illegal move' });
    // ...but the jump is accepted.
    const jumpRes = game.collectMove(ctx({ scratch }), 'violet', mv([4, 3], [[2, 1]]));
    expect(jumpRes.rejected).toBeUndefined();
  });

  it('rejects a PARTIAL multi-jump (must play the full chain)', () => {
    const game = createCheckersGame();
    // Violet (5,4) can chain (4,3) then (2,3): landing (3,2) then (1,4).
    const cells = cellsFrom([
      EMPTY_ROW,
      EMPTY_ROW,
      '...a....',
      EMPTY_ROW,
      '...a....',
      '....v...',
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 0, over: false };
    // Stopping after one hop is rejected.
    const partial = game.collectMove(ctx({ scratch }), 'violet', mv([5, 4], [[3, 2]]));
    expect(partial.rejected).toEqual({ reason: 'illegal move' });
    // The full chain is accepted, and captures both.
    const full = game.collectMove(
      ctx({ scratch }),
      'violet',
      mv(
        [5, 4],
        [
          [3, 2],
          [1, 4],
        ],
      ),
    );
    expect(full.rejected).toBeUndefined();
    const s = full.scratch as { cells: Cell[]; turn: number };
    expect(s.cells.filter((c) => c?.seat === 1)).toHaveLength(0);
    // The turn passes to amber (seat 1).
    expect(s.turn).toBe(1);
  });

  it('rejects any move once the game is over', () => {
    const game = createCheckersGame();
    const cells = cellsFrom([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 1, over: true };
    const res = game.collectMove(ctx({ scratch }), 'amber', mv([3, 4], [[4, 5]]));
    expect(res.rejected).toEqual({ reason: 'game over' });
  });

  it('applies a legal step and passes the turn to amber', () => {
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const res = game.collectMove(ctx({ scratch }), 'violet', mv([5, 0], [[4, 1]]));
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { cells: Cell[]; turn: number };
    expect(s.turn).toBe(1);
    // Sim now shows amber to move.
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.toMove).toBe('amber');
    expect(sim.activePlayer).toBe('amber');
    expect(sim.violet).toBe(12);
    expect(sim.amber).toBe(12);
  });
});

describe('crowning through the module', () => {
  it('crowns a man that reaches the far row and streams it as a king', () => {
    const game = createCheckersGame();
    // Violet man at (1,2), empty ahead; it steps to (0,1) and crowns. Give amber a piece so amber is
    // not already stuck (we only want to check the crown, not end the game).
    const cells = cellsFrom([
      EMPTY_ROW,
      '..v.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '......a.',
      EMPTY_ROW,
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 0, over: false };
    const res = game.collectMove(ctx({ scratch }), 'violet', mv([1, 2], [[0, 1]]));
    expect(res.rejected).toBeUndefined();
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.cells[0 * BOARD_SIZE + 1]).toBe('violet-king');
  });
});

describe('game over + standings', () => {
  it('reaches over through a real capture that removes the last opponent piece', () => {
    const game = createCheckersGame();
    // Violet man at (4,3) jumps amber's ONLY man at (3,2), landing (2,1). Afterward amber has no piece
    // -> amber (the side now to move) has no legal move -> the game is over, driven entirely through
    // collectMove, not an injected over:true. Violet wins.
    const cells = cellsFrom([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..a.....',
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 0, over: false };
    const res = game.collectMove(ctx({ scratch }), 'violet', mv([4, 3], [[2, 1]]));
    expect(res.rejected).toBeUndefined();
    const s = res.scratch as { over: boolean; turn: number; cells: Cell[] };
    // The over flag was produced by the move, not injected.
    expect(s.over).toBe(true);
    expect(s.turn).toBe(1); // it is (nominally) amber's turn, but amber is stuck
    expect(s.cells.filter((c) => c?.seat === 1)).toHaveLength(0);
    // A subsequent tick agrees and reports violet as the winner.
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.over).toBe(true);
    expect(sim.toMove).toBeNull();
    expect(sim.outcome).toBe('violet');
    // Standings rank violet first even though this is a piece-count-agnostic win.
    const standings = game.endGame(ctx({ scratch: res.scratch }));
    const violet = standings.find((st) => st.player === 'violet');
    const amber = standings.find((st) => st.player === 'amber');
    expect(violet?.rank).toBe(1);
    expect(amber?.rank).toBe(2);
  });

  it('ranks the winner first even when the loser has MORE pieces (stuck, not captured out)', () => {
    const game = createCheckersGame();
    // Amber (seat 1) is to move and is completely boxed in with pieces still on the board, so amber
    // loses; violet wins despite fewer pieces. Amber man at (0,0) blocked by a violet wall.
    const cells = cellsFrom([
      'a.......',
      '.v......',
      '..v.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const scratch = { cells, seats: ['violet', 'amber'], turn: 1, over: true };
    const sim = tick(game, ctx({ scratch }));
    expect(sim.outcome).toBe('violet');
    expect(sim.amber).toBe(1);
    expect(sim.violet).toBe(2);
    const standings = game.endGame(ctx({ scratch }));
    expect(standings.find((st) => st.player === 'violet')?.rank).toBe(1);
    expect(standings.find((st) => st.player === 'amber')?.rank).toBe(2);
  });
});

describe('tick', () => {
  it('streams the current board without a world to step', () => {
    const game = createCheckersGame();
    const scratch = game.configure({}, players('violet', 'amber')).scratch;
    const sim = tick(game, ctx({ scratch }));
    expect(sim.over).toBe(false);
    expect(sim.cells).toHaveLength(BOARD_SIZE * BOARD_SIZE);
  });
});
