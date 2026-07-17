// Deterministic unit tests for Checkers's rules (spec 0055): the forward man moves and jumps, the
// king's four-way moves, MANDATORY CAPTURE (a jump exists -> only jumps are legal), MULTI-JUMP chains
// (a partial jump is not a legal stop), CROWNING (a man that reaches the far row becomes a king, and a
// mid-chain crown ends the turn), and end/scoring. These are pure over the board - no engine, no rng -
// so they pin the correctness-heavy core exactly.

import { describe, it, expect } from 'vitest';
import { gridFromCells, type Coord, type Seat } from '@branchout/game-board';
import {
  applyMove,
  BOARD_SIZE,
  captureHopsFrom,
  colorOf,
  crownRow,
  forwardSteps,
  hasLegalMove,
  isDarkSquare,
  isGameOverFor,
  isLegalMove,
  jumpPathsFrom,
  legalMoves,
  movesEqual,
  PIECES_PER_SIDE,
  scoreOf,
  seatHasCapture,
  startingBoard,
  stepMovesFrom,
  stepsFor,
  winnerOf,
  type Cell,
  type Move,
  type Piece,
} from './rules';

const VIOLET: Seat = 0;
const AMBER: Seat = 1;

const V = (king = false): Piece => ({ seat: 0, king });
const A = (king = false): Piece => ({ seat: 1, king });

/**
 * Build a board from a picture: rows of chars. '.' empty, 'v' violet man, 'V' violet king, 'a' amber
 * man, 'A' amber king. (Only dark squares hold pieces in a real game, but the grid itself does not
 * enforce that - the rules do - so tests can place a piece anywhere.)
 */
function board(rows: string[]): ReturnType<typeof gridFromCells<Cell>> {
  const cells: Cell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push(
        ch === 'v' ? V() : ch === 'V' ? V(true) : ch === 'a' ? A() : ch === 'A' ? A(true) : null,
      );
    }
  }
  return gridFromCells<Cell>(BOARD_SIZE, cells);
}

const EMPTY_ROW = '........';
const at = (row: number, col: number): Coord => ({ row, col });

describe('board geometry', () => {
  it('marks the dark (playable) squares as (row + col) odd', () => {
    expect(isDarkSquare(0, 1)).toBe(true);
    expect(isDarkSquare(0, 0)).toBe(false);
    expect(isDarkSquare(7, 0)).toBe(true);
    expect(isDarkSquare(5, 5)).toBe(false);
  });

  it('crowns violet on row 0 and amber on the far row', () => {
    expect(crownRow(VIOLET)).toBe(0);
    expect(crownRow(AMBER)).toBe(BOARD_SIZE - 1);
  });

  it('maps a seat to a color', () => {
    expect(colorOf(0)).toBe('violet');
    expect(colorOf(1)).toBe('amber');
  });
});

describe('startingBoard', () => {
  it('places 12 men per side on the dark squares of the three home rows', () => {
    const b = startingBoard();
    expect(scoreOf(b)).toEqual({ violet: PIECES_PER_SIDE, amber: PIECES_PER_SIDE });
    // Amber occupies the top three rows, Violet the bottom three; rows 3-4 are empty.
    const amberRows = new Set<number>();
    const violetRows = new Set<number>();
    b.forEach((cell, coord) => {
      if (cell?.seat === 1) amberRows.add(coord.row);
      if (cell?.seat === 0) violetRows.add(coord.row);
      // Every placed piece is on a dark square and is a man (not a king).
      if (cell) {
        expect(isDarkSquare(coord.row, coord.col)).toBe(true);
        expect(cell.king).toBe(false);
      }
    });
    expect([...amberRows].sort()).toEqual([0, 1, 2]);
    expect([...violetRows].sort()).toEqual([5, 6, 7]);
  });
});

describe('man direction', () => {
  it('a violet man steps UP the board (toward row 0)', () => {
    expect(forwardSteps(VIOLET).every((s) => s.dr === -1)).toBe(true);
    expect(stepsFor(V())).toHaveLength(2);
  });

  it('an amber man steps DOWN the board (toward row 7)', () => {
    expect(forwardSteps(AMBER).every((s) => s.dr === 1)).toBe(true);
  });

  it('a king moves in all four diagonal directions', () => {
    expect(stepsFor(V(true))).toHaveLength(4);
    expect(stepsFor(A(true))).toHaveLength(4);
  });
});

describe('simple (non-capturing) moves', () => {
  it('a lone violet man has its two forward diagonal steps', () => {
    // Violet man at (4,3): steps to (3,2) and (3,4) (both empty, on-board).
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const moves = stepMovesFrom(b, at(4, 3));
    expect(moves).toContainEqual(at(3, 2));
    expect(moves).toContainEqual(at(3, 4));
    expect(moves).toHaveLength(2);
  });

  it('a man on the edge has only the in-bounds step', () => {
    // Violet man at (4,0): only (3,1) is on-board ((3,-1) is off).
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      'v.......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(stepMovesFrom(b, at(4, 0))).toEqual([at(3, 1)]);
  });

  it('a man cannot step onto an occupied square', () => {
    // Violet man at (4,3) with own/other pieces blocking both forward squares.
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..v.v...',
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(stepMovesFrom(b, at(4, 3))).toEqual([]);
  });
});

describe('captures (single jump)', () => {
  it('a violet man jumps an adjacent amber into the empty square beyond', () => {
    // Violet (4,3), amber (3,2), empty (2,1): violet jumps to (2,1) capturing (3,2).
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..a.....',
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const hops = captureHopsFrom(b, at(4, 3));
    expect(hops).toContainEqual({ to: at(2, 1), jumped: at(3, 2) });
    expect(hops).toHaveLength(1);
  });

  it('a man cannot jump its OWN piece', () => {
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..v.....',
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(captureHopsFrom(b, at(4, 3))).toEqual([]);
  });

  it('a man cannot jump when the landing square is occupied', () => {
    // amber to jump is at (3,2), but the landing (2,1) is blocked.
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '.a......',
      '..a.....',
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(captureHopsFrom(b, at(4, 3))).toEqual([]);
  });

  it('a man cannot jump BACKWARD (only forward), but a king can', () => {
    // Violet man at (2,3) with an amber BEHIND it at (3,4) and empty (4,5): a man cannot jump back.
    const manBoard = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '...v....',
      '....a...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(captureHopsFrom(manBoard, at(2, 3))).toEqual([]);
    // Same position but the violet is a KING: it can jump backward (SE) to (4,5).
    const kingBoard = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '...V....',
      '....a...',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(captureHopsFrom(kingBoard, at(2, 3))).toContainEqual({ to: at(4, 5), jumped: at(3, 4) });
  });
});

describe('mandatory capture', () => {
  it('when a jump exists, only jumps are legal (a plain step is filtered out)', () => {
    // Violet man at (4,3) can jump the amber at (3,2). Another violet man at (6,1) could step, but the
    // mandatory-capture rule means ONLY the jumping move is legal this turn.
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '..a.....',
      '...v....',
      EMPTY_ROW,
      '.v......',
      EMPTY_ROW,
    ]);
    expect(seatHasCapture(b, VIOLET)).toBe(true);
    const moves = legalMoves(b, VIOLET);
    // Every legal move is a jump (path landing two squares away), never the free man's step.
    expect(moves).toHaveLength(1);
    expect(moves[0]?.from).toEqual(at(4, 3));
    expect(moves[0]?.path).toEqual([at(2, 1)]);
  });

  it('when no jump exists, plain steps are the legal moves', () => {
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(seatHasCapture(b, VIOLET)).toBe(false);
    const moves = legalMoves(b, VIOLET);
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.path.length === 1)).toBe(true);
  });
});

describe('multi-jump chains', () => {
  it('chains two jumps into one maximal path (a single legal move)', () => {
    // Violet man at (5,4); amber at (4,3) then (2,3), with empty landings at (3,2) and (1,4). Violet
    // jumps (4,3) landing (3,2), then from (3,2) jumps (2,3) landing (1,4): one two-hop move.
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '...a....',
      EMPTY_ROW,
      '...a....',
      '....v...',
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const paths = jumpPathsFrom(b, at(5, 4));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toEqual([at(3, 2), at(1, 4)]);
  });

  it('a partial jump is NOT a legal move (must continue the chain)', () => {
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '...a....',
      EMPTY_ROW,
      '...a....',
      '....v...',
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Stopping after the first hop at (3,2) is illegal: the only legal move continues to (1,4).
    const partial: Move = { from: at(5, 4), path: [at(3, 2)] };
    const full: Move = { from: at(5, 4), path: [at(3, 2), at(1, 4)] };
    expect(isLegalMove(b, VIOLET, partial)).toBe(false);
    expect(isLegalMove(b, VIOLET, full)).toBe(true);
  });
});

describe('crowning', () => {
  it('a man that STOPS on the far row is crowned a king', () => {
    // Violet man at (1,2) steps forward to (0,1) (row 0 = violet crown row) -> becomes a king.
    const b = board([
      EMPTY_ROW,
      '..v.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const after = applyMove(b, VIOLET, { from: at(1, 2), path: [at(0, 1)] });
    const crowned = after.at(0, 1);
    expect(crowned).toEqual({ seat: 0, king: true });
  });

  it('a man that crowns MID-CHAIN ends the turn there (does not keep jumping as a king)', () => {
    // Violet man at (2,3) jumps amber (1,2) landing on (0,1) = the crown row. Even though a fresh king
    // could (were the geometry there) jump on, the standard rule crowns and STOPS. Here we assert the
    // path ends at the crown square and the piece is a king.
    const b = board([
      EMPTY_ROW,
      '..a.....',
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const paths = jumpPathsFrom(b, at(2, 3));
    expect(paths).toEqual([[at(0, 1)]]);
    const after = applyMove(b, VIOLET, { from: at(2, 3), path: [at(0, 1)] });
    expect(after.at(0, 1)).toEqual({ seat: 0, king: true });
    // The jumped amber is gone.
    expect(after.at(1, 2)).toBeNull();
    expect(scoreOf(after)).toEqual({ violet: 1, amber: 0 });
  });
});

describe('applyMove', () => {
  it('applies a plain step and clears the origin', () => {
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const after = applyMove(b, VIOLET, { from: at(4, 3), path: [at(3, 2)] });
    expect(after.at(4, 3)).toBeNull();
    expect(after.at(3, 2)).toEqual({ seat: 0, king: false });
  });

  it('removes every jumped piece along a multi-jump', () => {
    const b = board([
      EMPTY_ROW,
      EMPTY_ROW,
      '...a....',
      EMPTY_ROW,
      '...a....',
      '....v...',
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    const after = applyMove(b, VIOLET, { from: at(5, 4), path: [at(3, 2), at(1, 4)] });
    expect(after.at(4, 3)).toBeNull(); // first jumped
    expect(after.at(2, 3)).toBeNull(); // second jumped
    expect(after.at(1, 4)).toEqual({ seat: 0, king: false });
    expect(scoreOf(after)).toEqual({ violet: 1, amber: 0 });
  });

  it('throws on an illegal move (a loud bug, not a silent no-op)', () => {
    const b = startingBoard();
    // Moving a piece straight (not diagonal) is never legal.
    expect(() => applyMove(b, VIOLET, { from: at(5, 0), path: [at(4, 0)] })).toThrow(/illegal/i);
  });

  it('movesEqual compares source + full path', () => {
    const a: Move = { from: at(5, 4), path: [at(3, 2), at(1, 4)] };
    const same: Move = { from: at(5, 4), path: [at(3, 2), at(1, 4)] };
    const diff: Move = { from: at(5, 4), path: [at(3, 2)] };
    expect(movesEqual(a, same)).toBe(true);
    expect(movesEqual(a, diff)).toBe(false);
  });
});

describe('opening legal moves', () => {
  it('violet has exactly the seven front-row man steps from the standard opening', () => {
    // From the opening, only the men on row 5 can step (into the empty row 4); there are 4 such men but
    // the two outer ones have one step each and the two inner have two -> 7 legal steps total. No jumps
    // exist yet (the sides are three rows apart), so all are plain steps.
    const moves = legalMoves(startingBoard(), VIOLET);
    expect(seatHasCapture(startingBoard(), VIOLET)).toBe(false);
    expect(moves.every((m) => m.path.length === 1)).toBe(true);
    expect(moves).toHaveLength(7);
    // Every move originates on row 5 and lands on row 4.
    for (const m of moves) {
      expect(m.from.row).toBe(5);
      expect(m.path[0]?.row).toBe(4);
    }
  });
});

describe('end + scoring', () => {
  it('a side with no pieces has no legal move (has lost)', () => {
    const onlyViolet = board([
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '...v....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(hasLegalMove(onlyViolet, AMBER)).toBe(false);
    expect(isGameOverFor(onlyViolet, AMBER)).toBe(true);
    // Violet still has moves, so the game is not over on violet's turn.
    expect(isGameOverFor(onlyViolet, VIOLET)).toBe(false);
  });

  it('a side whose every piece is blocked has no legal move (has lost)', () => {
    // Amber man boxed into the top-left corner by violet men, with no jump and no empty step.
    const stuck = board([
      'a.......',
      '.v......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    // Amber at (0,0) can only go down-diagonal to (1,1), which holds a violet; jumping needs an empty
    // (2,2) - it is empty - so this WOULD be a jump. Adjust: block the landing too.
    const boxed = board([
      'a.......',
      '.v......',
      '..v.....',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
    ]);
    expect(hasLegalMove(boxed, AMBER)).toBe(false);
    expect(isGameOverFor(boxed, AMBER)).toBe(true);
    void stuck;
  });

  it('the winner is the OTHER seat when the side to move is stuck (no draw)', () => {
    expect(winnerOf(AMBER)).toBe(VIOLET);
    expect(winnerOf(VIOLET)).toBe(AMBER);
  });

  it('scoreOf counts men + kings per side', () => {
    const mixed = board([
      'A.......',
      '.a......',
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '.....V..',
      '......v.',
      '.......v',
    ]);
    expect(scoreOf(mixed)).toEqual({ violet: 3, amber: 2 });
  });
});
