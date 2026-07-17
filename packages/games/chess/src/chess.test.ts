// Chess module tests (spec 0056 - live board model). These prove the lifecycle wiring over the pure
// rules: configure assigns seats + the opening, collectMove enforces turn + FULL legality (rejecting to
// the device), applying a move advances the position, a real mating move ends the game with the right
// winner, stalemate and insufficient material draw, resignation concedes, tick streams the sim, and
// standings rank by result. The end/terminal transitions are reached through a real collectMove, never
// by hand-setting scratch (per the build kit).

import { describe, expect, it } from 'vitest';
import type { RoundContext, SessionPlayer } from '@branchout/game-sdk';
import { gridFromCells } from '@branchout/game-board';
import { createChessGame, CHESS_GAME_ID } from './chess';
import { BOARD_SIZE, piece, startingPosition, type Cell, type CastlingRights } from './rules';
import type { ChessSim } from './types';

function tick(game: ReturnType<typeof createChessGame>, context: RoundContext): ChessSim {
  if (!game.tick) throw new Error('chess is a live game and must implement tick');
  return game.tick(context).sim as ChessSim;
}

function players(...ids: string[]): SessionPlayer[] {
  return ids.map((id) => ({ player: id, nickname: id, connected: true }));
}

function ctx(overrides: Partial<RoundContext>): RoundContext {
  return {
    room: 'r',
    game: CHESS_GAME_ID,
    phase: 'collecting',
    round: 1,
    players: players('white', 'black'),
    scores: {},
    scratch: {},
    config: {},
    ...overrides,
  };
}

/** A board from eight ASCII rows (row 0 = Black back rank), same convention as rules.test.ts. */
function boardCells(rows: string[]): Cell[] {
  const cells: Cell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      if (ch === '.') cells.push('empty');
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        cells.push(piece(color, ch.toUpperCase() as never));
      }
    }
  }
  return cells;
}

/** A scratch record for a given board + side to move (seats white/black). */
function scratchFor(
  rows: string[],
  turn: 'w' | 'b',
  castling: Partial<CastlingRights> = {},
): Record<string, unknown> {
  return {
    cells: boardCells(rows),
    turn,
    castling: { wK: false, wQ: false, bK: false, bQ: false, ...castling },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
    seats: ['white', 'black'],
    over: false,
    outcome: null,
    endReason: null,
  };
}

/** A `move` string for from/to (algebraic), plus optional promotion. */
function moveStr(from: string, to: string, promotion?: string): string {
  const toSq = (a: string): { row: number; col: number } => ({
    col: a.charCodeAt(0) - 'a'.charCodeAt(0),
    row: BOARD_SIZE - Number(a[1]),
  });
  return JSON.stringify(
    promotion ? { from: toSq(from), to: toSq(to), promotion } : { from: toSq(from), to: toSq(to) },
  );
}

const EMPTY_ROW = '........';

describe('configure + startRound', () => {
  it('assigns seats, sets the standard opening, and White is to move', () => {
    const game = createChessGame();
    const result = game.configure({}, players('white', 'black'));
    expect(result.rounds).toBe(1);
    const scratch = result.scratch as Record<string, unknown>;
    expect(scratch.seats).toEqual(['white', 'black']);
    expect(scratch.turn).toBe('w');
    // The opening board matches startingPosition.
    expect(scratch.cells).toEqual(startingPosition().board.toCells());

    const started = game.startRound(ctx({ scratch }));
    const sim = started.prompt as ChessSim;
    expect(sim.toMove).toBe('white');
    expect(sim.activePlayer).toBe('white');
    // 20 legal opening moves for White.
    expect(sim.legal).toHaveLength(20);
    expect(sim.over).toBe(false);
  });
});

describe('collectMove enforcement', () => {
  it('rejects an out-of-turn move to the device', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    // Black tries to move on White's turn.
    const res = game.collectMove(ctx({ scratch }), 'black', moveStr('e7', 'e5'));
    expect(res.rejected?.reason).toBe('not your turn');
  });

  it('rejects a malformed move', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const res = game.collectMove(ctx({ scratch }), 'white', 'not json');
    expect(res.rejected?.reason).toBe('malformed move');
  });

  it('rejects an illegal move (a pawn jumping three squares)', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const res = game.collectMove(ctx({ scratch }), 'white', moveStr('e2', 'e5'));
    expect(res.rejected?.reason).toBe('illegal move');
  });

  it('rejects a move that would leave the mover in check (a pinned piece)', () => {
    // White king e1, white bishop e2 pinned by a black rook e8. Moving the bishop is illegal.
    const scratch = scratchFor(
      ['....r...', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, '....B...', '....K..k'],
      'w',
    );
    const game = createChessGame();
    const res = game.collectMove(ctx({ scratch }), 'white', moveStr('e2', 'd3'));
    expect(res.rejected?.reason).toBe('illegal move');
  });

  it('accepts and applies a legal move, advancing the turn', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const res = game.collectMove(ctx({ scratch }), 'white', moveStr('e2', 'e4'));
    expect(res.rejected).toBeUndefined();
    const next = res.scratch;
    // The sim now shows Black to move, with the pawn on e4.
    const sim = tick(game, ctx({ scratch: next }));
    expect(sim.toMove).toBe('black');
    expect(sim.activePlayer).toBe('black');
    const e4 = sim.cells[4 * BOARD_SIZE + 4];
    expect(e4).toBe('wP');
  });
});

describe('end conditions reached through a real move', () => {
  it('a mating move ends the game with the mover as the winner (checkmate)', () => {
    // BEFORE the mate: white rook e1, white king g1; black king g8 boxed by f7/g7/h7. White plays
    // Re1-e8#. This is the decisive transition, reached by a real collectMove (not a hand-set end).
    const scratch = scratchFor(
      [
        '......k.', // black king g8
        '.....ppp', // f7 g7 h7
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '....R.K.', // white rook e1, white king g1
      ],
      'w',
    );
    const game = createChessGame();
    const res = game.collectMove(ctx({ scratch }), 'white', moveStr('e1', 'e8'));
    expect(res.rejected).toBeUndefined();
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.over).toBe(true);
    expect(sim.outcome).toBe('white');
    expect(sim.endReason).toBe('checkmate');
    // Standings: White scores 2, Black 0.
    const standings = game.endGame!(ctx({ scratch: res.scratch }));
    const white = standings.find((s) => s.player === 'white');
    const black = standings.find((s) => s.player === 'black');
    expect(white!.score).toBe(2);
    expect(black!.score).toBe(0);
    expect(white!.rank).toBeLessThan(black!.rank);
  });

  it('a move that produces stalemate draws the game', () => {
    // BEFORE: black king a8; white king c6; white queen g7. White plays Qg7-c7, stalemating Black
    // (not in check, no legal move) -> draw. This is the decisive transition via a real collectMove.
    const scratch = scratchFor(
      [
        'k.......', // black king a8
        '......Q.', // white queen g7 (row1 col6)
        '..K.....', // white king c6 (row2 col2)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
      ],
      'w',
    );
    const game = createChessGame();
    const res = game.collectMove(ctx({ scratch }), 'white', moveStr('g7', 'c7'));
    expect(res.rejected).toBeUndefined();
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.over).toBe(true);
    expect(sim.outcome).toBe('draw');
    expect(sim.endReason).toBe('stalemate');
    // Standings: a draw gives each player 1 and a shared top rank.
    const standings = game.endGame!(ctx({ scratch: res.scratch }));
    expect(standings.find((s) => s.player === 'white')!.score).toBe(1);
    expect(standings.find((s) => s.player === 'black')!.score).toBe(1);
  });

  it('a capture that leaves only two bare kings draws by insufficient material', () => {
    // White queen b7 vs a lone black knight on a8 defended by nothing; White plays Qxa8, leaving
    // K vs K -> insufficient material draw. (Black king h1, white king h3 keep it a clean capture.)
    const scratch = scratchFor(
      [
        'n.......', // black knight a8 (row0 col0)
        '.Q......', // white queen b7 (row1 col1)
        EMPTY_ROW,
        EMPTY_ROW,
        EMPTY_ROW,
        '.......K', // white king h3 (row5 col7)
        EMPTY_ROW,
        '.......k', // black king h1 (row7 col7)
      ],
      'w',
    );
    const game = createChessGame();
    const res = game.collectMove(ctx({ scratch }), 'white', moveStr('b7', 'a8'));
    expect(res.rejected).toBeUndefined();
    const sim = tick(game, ctx({ scratch: res.scratch }));
    // After Qxa8 the board is white K+Q vs black K -> that is NOT insufficient (a queen mates), so it
    // must NOT be over. This guards the insufficient-material check from over-firing.
    expect(sim.over).toBe(false);
  });

  it('resignation ends the game and the OTHER side wins', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const res = game.collectMove(ctx({ scratch }), 'white', JSON.stringify({ resign: true }));
    expect(res.rejected).toBeUndefined();
    const sim = tick(game, ctx({ scratch: res.scratch }));
    expect(sim.over).toBe(true);
    expect(sim.outcome).toBe('black'); // White resigned, so Black wins
    expect(sim.endReason).toBe('resign');
  });

  it('rejects a move once the game is over', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const resigned = game.collectMove(
      ctx({ scratch }),
      'white',
      JSON.stringify({ resign: true }),
    ).scratch;
    const res = game.collectMove(ctx({ scratch: resigned }), 'black', moveStr('e7', 'e5'));
    expect(res.rejected?.reason).toBe('game over');
  });
});

describe('perfect information + streaming', () => {
  it('the sim carries the whole board and no private payload is emitted', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const result = game.tick!(ctx({ scratch }));
    // No `private` key: chess is perfect information (no spec 0052 channel).
    expect((result as unknown as Record<string, unknown>).private).toBeUndefined();
    const sim = result.sim as ChessSim;
    expect(sim.cells).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    expect(sim.size).toBe(BOARD_SIZE);
  });

  it('reports check in the sim when the side to move is in check', () => {
    const scratch = scratchFor(
      ['....r...', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, '....K..k'],
      'w',
    );
    const game = createChessGame();
    const sim = tick(game, ctx({ scratch }));
    expect(sim.check).toBe(true);
  });
});

describe('config validation', () => {
  it('accepts empty/object config and rejects a non-object', () => {
    const game = createChessGame();
    expect(() => game.configure({}, players('white', 'black'))).not.toThrow();
    expect(() => game.configure(undefined, players('white', 'black'))).not.toThrow();
  });
});

describe('scratch round-trips through a serialized snapshot', () => {
  it('a JSON round-trip of scratch rebuilds the same sim', () => {
    const game = createChessGame();
    const scratch = game.configure({}, players('white', 'black')).scratch as Record<
      string,
      unknown
    >;
    const roundTripped = JSON.parse(JSON.stringify(scratch)) as Record<string, unknown>;
    const a = tick(game, ctx({ scratch }));
    const b = tick(game, ctx({ scratch: roundTripped }));
    expect(gridFromCells(BOARD_SIZE, b.cells).toCells()).toEqual(a.cells);
    expect(b.legal.length).toBe(a.legal.length);
  });
});
