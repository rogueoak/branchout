// Deterministic unit tests for Reversi's rules (spec 0054): the flip/bracket logic in all eight
// directions, legal-move generation from the opening, the forced-pass condition, and end/scoring.
// These are pure over the board - no engine, no rng - so they pin the correctness-heavy core exactly.

import { describe, it, expect } from 'vitest';
import { emptyGrid, gridFromCells, type Seat } from '@branchout/game-board';
import {
  applyMove,
  BOARD_SIZE,
  discOf,
  flipsFor,
  hasLegalMove,
  isGameOver,
  isLegalMove,
  legalMoves,
  scoreOf,
  startingBoard,
  winnerOf,
  type Cell,
} from './rules';

const VIOLET: Seat = 0;
const AMBER: Seat = 1;

/** Build a board from a picture: rows of chars, '.' empty, 'V' violet, 'A' amber. */
function board(rows: string[]): ReturnType<typeof gridFromCells<Cell>> {
  const cells: Cell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push(ch === 'V' ? 'violet' : ch === 'A' ? 'amber' : 'empty');
    }
  }
  return gridFromCells<Cell>(BOARD_SIZE, cells);
}

const EMPTY_ROW = '........';

describe('startingBoard', () => {
  it('places the four center discs on their diagonals', () => {
    const b = startingBoard();
    expect(b.at(3, 3)).toBe('amber');
    expect(b.at(4, 4)).toBe('amber');
    expect(b.at(3, 4)).toBe('violet');
    expect(b.at(4, 3)).toBe('violet');
    // Exactly four discs, everything else empty.
    expect(scoreOf(b)).toEqual({ violet: 2, amber: 2 });
    expect(b.count((c) => c === 'empty')).toBe(BOARD_SIZE * BOARD_SIZE - 4);
  });
});

describe('flipsFor - the eight directions', () => {
  // A single violet disc placed on an empty square adjacent to a run of amber discs terminated by a
  // violet disc must flip the whole run. One test per direction, isolating the ray walk.

  it('flips to the EAST (row-wise, increasing col)', () => {
    // V at (3,0), amber run (3,1)(3,2), play violet at (3,3)? No - play at the empty end. Set:
    // V A A . -> play at col 3 brackets cols 1,2.
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      'VAA.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(b, VIOLET, 3, 3)).toEqual([
      { row: 3, col: 2 },
      { row: 3, col: 1 },
    ]);
  });

  it('flips to the WEST (decreasing col)', () => {
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '.AAV....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const flips = flipsFor(b, VIOLET, 3, 0);
    expect(flips).toContainEqual({ row: 3, col: 1 });
    expect(flips).toContainEqual({ row: 3, col: 2 });
    expect(flips).toHaveLength(2);
  });

  it('flips to the SOUTH (increasing row, same col)', () => {
    // Play violet at (0,0); amber run (1,0)(2,0) capped by violet (3,0) to the south. Walk order is
    // closest-first: (1,0) then (2,0).
    const b = board([
      '........',
      'A.......',
      'A.......',
      'V.......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(b, VIOLET, 0, 0)).toEqual([
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it('flips to the NORTH (decreasing row)', () => {
    // Play violet at (3,0); amber run (2,0)(1,0) capped by violet (0,0) to the north. Walk order is
    // closest-first: (2,0) then (1,0).
    const b = board([
      'V.......',
      'A.......',
      'A.......',
      '........',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(b, VIOLET, 3, 0)).toEqual([
      { row: 2, col: 0 },
      { row: 1, col: 0 },
    ]);
  });

  it('flips to the SOUTH-EAST diagonal', () => {
    // Empty (1,1); amber (2,2),(3,3); violet (4,4). Playing violet at (1,1) brackets SE, closest-first.
    const clean = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '..A.....',
      '...A....',
      '....V...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(clean, VIOLET, 1, 1)).toEqual([
      { row: 2, col: 2 },
      { row: 3, col: 3 },
    ]);
  });

  it('flips to the NORTH-WEST diagonal', () => {
    // violet (1,1); amber (2,2),(3,3); empty (4,4): playing violet at (4,4) brackets NW.
    const b = board([
      EMPTY_ROW,
      '.V......',
      '..A.....',
      '...A....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(b, VIOLET, 4, 4)).toEqual([
      { row: 3, col: 3 },
      { row: 2, col: 2 },
    ]);
  });

  it('flips to the NORTH-EAST diagonal', () => {
    // violet (4,1); amber (3,2),(2,3); empty (1,4): playing violet at (1,4) brackets NE.
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '...A....',
      '..A.....',
      '.V......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(b, VIOLET, 1, 4)).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 2 },
    ]);
  });

  it('flips to the SOUTH-WEST diagonal', () => {
    // violet (1,4); amber (2,3),(3,2); empty (4,1): playing violet at (4,1) brackets SW.
    const b = board([
      EMPTY_ROW,
      '....V...',
      '...A....',
      '..A.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(flipsFor(b, VIOLET, 4, 1)).toEqual([
      { row: 3, col: 2 },
      { row: 2, col: 3 },
    ]);
  });

  it('flips along MULTIPLE directions from one placement', () => {
    // A cross of amber arms around an empty (3,3), each arm capped by a violet: placing violet at
    // (3,3) brackets all four arms at once. West arm V(3,1) A(3,2); East arm A(3,4) V(3,5); North arm
    // V(1,3) A(2,3); South arm A(4,3) V(5,3).
    const cross = board([
      EMPTY_ROW,
      '...V....',
      '...A....',
      '.VA.AV..',
      '...A....',
      '...V....',
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const flips = flipsFor(cross, VIOLET, 3, 3);
    expect(flips).toContainEqual({ row: 3, col: 2 }); // W
    expect(flips).toContainEqual({ row: 3, col: 4 }); // E
    expect(flips).toContainEqual({ row: 2, col: 3 }); // N
    expect(flips).toContainEqual({ row: 4, col: 3 }); // S
    expect(flips).toHaveLength(4);
  });
});

describe('flipsFor - illegal placements bracket nothing', () => {
  it('rejects a placement on an occupied square', () => {
    const b = startingBoard();
    expect(flipsFor(b, VIOLET, 3, 3)).toEqual([]);
    expect(isLegalMove(b, VIOLET, 3, 3)).toBe(false);
  });

  it('rejects a placement adjacent only to own discs', () => {
    const b = board([
      'VV......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Playing next to only-own discs brackets no opponent run.
    expect(flipsFor(b, VIOLET, 0, 2)).toEqual([]);
  });

  it('rejects a run that runs off the board unterminated', () => {
    // amber run to the board edge with no violet cap -> nothing flips.
    const b = board([
      '.AA.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Playing violet at (0,0): east run A(0,1)A(0,2) then empty -> no cap -> no flip.
    expect(flipsFor(b, VIOLET, 0, 0)).toEqual([]);
  });

  it('rejects a run broken by an empty gap', () => {
    // V . A A V : the gap after V breaks the bracket.
    const b = board([
      'V.AAV...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Playing at (0,1): west is V (adjacent own, no run); east is A A V -> that DOES bracket. So this
    // placement IS legal to the east. Assert the east flip, and that the empty gap did not extend west.
    expect(flipsFor(b, VIOLET, 0, 1)).toEqual([
      { row: 0, col: 2 },
      { row: 0, col: 3 },
    ]);
  });
});

describe('legalMoves + applyMove from the opening', () => {
  it('violet has the four standard opening moves', () => {
    const moves = legalMoves(startingBoard(), VIOLET);
    expect(moves).toHaveLength(4);
    expect(moves).toContainEqual({ row: 2, col: 3 });
    expect(moves).toContainEqual({ row: 3, col: 2 });
    expect(moves).toContainEqual({ row: 4, col: 5 });
    expect(moves).toContainEqual({ row: 5, col: 4 });
  });

  it('applyMove places the disc and flips the bracketed line', () => {
    const after = applyMove(startingBoard(), VIOLET, 2, 3);
    // Violet placed at (2,3); the amber at (3,3) is bracketed by (2,3)V ... (4,3)V and flips.
    expect(after.at(2, 3)).toBe('violet');
    expect(after.at(3, 3)).toBe('violet');
    // Violet gains 2 (placement + flip), amber loses 1: 4 violet, 1 amber.
    expect(scoreOf(after)).toEqual({ violet: 4, amber: 1 });
  });

  it('applyMove throws on an illegal placement (a loud bug, not a silent no-op)', () => {
    expect(() => applyMove(startingBoard(), VIOLET, 0, 0)).toThrow(/illegal/i);
  });
});

describe('forced pass + game over', () => {
  it('detects when a side has no legal move but the other does (a forced pass)', () => {
    // A tiny corner where only amber can move. Violet fills a wall; amber has a bracket, violet none.
    // Build: violet occupies a diagonal that cannot bracket; amber can play. Simplest: an almost-full
    // board contrived so violet is stuck. Use a hand-made position:
    // row0: A A A V ... violet at (0,3) capping AAA; nothing empty adjacent for violet to flip.
    const b = board([
      'AAAV....',
      'V.......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Amber can play at (0,4)? east of A(0,2)? row0 is A A A V - no. Let amber bracket the violet at
    // (1,0): amber at (2,0) would bracket V(1,0) capped by A(0,0) going N. So amber has a move.
    expect(hasLegalMove(b, AMBER)).toBe(true);
    // Violet: is there any empty square bracketing an amber run capped by violet? (0,3)V caps AAA to
    // its west but that square is filled. Check violet has NO legal move here.
    expect(hasLegalMove(b, VIOLET)).toBe(false);
    // So the game is NOT over (amber can still move) - it's a violet pass.
    expect(isGameOver(b)).toBe(false);
  });

  it('is game over when neither side can move', () => {
    // A fully violet board: no empty squares, so no move for anyone.
    const allViolet = emptyGrid<Cell>(BOARD_SIZE, 'violet');
    expect(hasLegalMove(allViolet, VIOLET)).toBe(false);
    expect(hasLegalMove(allViolet, AMBER)).toBe(false);
    expect(isGameOver(allViolet)).toBe(true);
  });

  it('is game over when both sides must pass with empty squares remaining', () => {
    // The realistic ending: the board is NOT full, but neither side can bracket. A lone 2x2 block of
    // same-color discs in the corner cannot be bracketed by anyone - every empty neighbor lacks an OWN
    // disc on the far side to close a bracket - so both seats are stuck while empties remain. This is
    // the partition a full board never exercises.
    const stuck = board([
      'VV......',
      'VV......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Empty squares remain, yet neither side has a legal move.
    expect(stuck.count((c) => c === 'empty')).toBeGreaterThan(0);
    expect(hasLegalMove(stuck, VIOLET)).toBe(false);
    expect(hasLegalMove(stuck, AMBER)).toBe(false);
    expect(isGameOver(stuck)).toBe(true);
  });
});

describe('winnerOf', () => {
  it('scores the majority color as the winner', () => {
    const violetWins = board([
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVV',
      'VVVVVVVA',
      'AAAAAAAA',
      'AAAAAAAA',
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(scoreOf(violetWins).violet).toBeGreaterThan(scoreOf(violetWins).amber);
    expect(winnerOf(violetWins)).toBe(0);
  });

  it('reports a draw on an equal disc count', () => {
    const tied = board([
      'VVVVVVVV',
      'VVVVVVVV',
      'AAAAAAAA',
      'AAAAAAAA',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(scoreOf(tied)).toEqual({ violet: 16, amber: 16 });
    expect(winnerOf(tied)).toBe('draw');
  });

  it('maps the winning seat to a disc color', () => {
    expect(discOf(0)).toBe('violet');
    expect(discOf(1)).toBe('amber');
  });
});
