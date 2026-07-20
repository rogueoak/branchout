import { describe, expect, it } from 'vitest';
import { diffMove, hasMandatoryCapture, jumpPath, turnPopupMessage } from './turn-notice';
import { asCheckersSim, type WireCell } from './protocol';

/** An 8x8 sim of empty cells with the given legal moves, for the mandatory-capture helper. */
function simWith(
  legal: { from: { row: number; col: number }; path: { row: number; col: number }[] }[],
) {
  return asCheckersSim({
    size: 8,
    cells: Array.from({ length: 64 }, () => 'empty'),
    toMove: 'violet',
    activePlayer: 'p1',
    legal,
    violet: 12,
    amber: 12,
    over: false,
    outcome: null,
    showAvailableMoves: true,
  })!;
}

describe('diffMove (piece slide/capture/crown animation trigger)', () => {
  // A tiny 3x3 board is enough to exercise the index math; the helper is size-agnostic (indices only).
  const empty = (): WireCell[] => Array.from({ length: 9 }, () => 'empty');

  it('classifies a plain diagonal step (source vacated, destination filled, no captures)', () => {
    const prev = empty();
    prev[4] = 'violet';
    const next = empty();
    next[0] = 'violet';
    const move = diffMove(prev, next);
    expect(move).toEqual({
      from: 4,
      to: 0,
      color: 'violet',
      king: false,
      crowned: false,
      captures: [],
    });
  });

  it('classifies a jump: the opposite-color removed square is a capture, the mover-color one the source', () => {
    const prev = empty();
    prev[8] = 'violet'; // the mover
    prev[4] = 'amber'; // the jumped piece
    const next = empty();
    next[0] = 'violet'; // landed two squares on
    const move = diffMove(prev, next);
    expect(move?.from).toBe(8);
    expect(move?.to).toBe(0);
    expect(move?.color).toBe('violet');
    expect(move?.captures).toEqual([{ index: 4, color: 'amber', king: false }]);
  });

  it('classifies a MULTI-capture chain: one same-color source, BOTH opposite-color captures', () => {
    // The chaining split is the headline feature: a violet mover (index 8) jumps two amber pieces
    // (indices 3 and 6) and lands (index 0). The single mover-color removed square is the source; both
    // opposite-color removed squares are captures - none mis-classified as the source.
    const prev: WireCell[] = [
      'empty',
      'empty',
      'empty',
      'amber',
      'empty',
      'empty',
      'amber',
      'empty',
      'violet',
    ];
    const next: WireCell[] = Array.from({ length: 9 }, () => 'empty') as WireCell[];
    next[0] = 'violet';
    const move = diffMove(prev, next);
    expect(move?.from).toBe(8);
    expect(move?.to).toBe(0);
    expect(move?.color).toBe('violet');
    expect(move?.captures).toEqual([
      { index: 3, color: 'amber', king: false },
      { index: 6, color: 'amber', king: false },
    ]);
  });

  it('flags a crowning when a man lands as a king', () => {
    const prev = empty();
    prev[4] = 'violet';
    const next = empty();
    next[0] = 'violet-king';
    const move = diffMove(prev, next);
    expect(move?.king).toBe(true);
    expect(move?.crowned).toBe(true);
  });

  it('does NOT flag a crowning when an already-king piece moves', () => {
    const prev = empty();
    prev[4] = 'amber-king';
    const next = empty();
    next[0] = 'amber-king';
    const move = diffMove(prev, next);
    expect(move?.king).toBe(true);
    expect(move?.crowned).toBe(false);
  });

  it('returns null when the boards are identical (no move to animate)', () => {
    const board = empty();
    board[3] = 'violet';
    expect(diffMove(board, board)).toBeNull();
  });

  it('returns null when the board sizes differ (a skipped diff)', () => {
    expect(diffMove(['violet'], ['violet', 'empty'])).toBeNull();
  });
});

describe('turnPopupMessage (turn-start popup copy)', () => {
  it('says "Your turn" for the active player when no capture is forced', () => {
    expect(turnPopupMessage({ isActive: true, mustCapture: false })).toBe('Your turn');
  });

  it('adds the forced-jump hint for the active player when a capture is available', () => {
    expect(turnPopupMessage({ isActive: true, mustCapture: true })).toBe(
      'Your turn - you must jump',
    );
  });

  it('shows nothing for the waiting (non-active) player', () => {
    expect(turnPopupMessage({ isActive: false, mustCapture: false })).toBeNull();
    expect(turnPopupMessage({ isActive: false, mustCapture: true })).toBeNull();
  });
});

describe('hasMandatoryCapture (forced-jump detection off the legal list)', () => {
  it('is true when a legal move jumps (lands two rows away)', () => {
    expect(
      hasMandatoryCapture(simWith([{ from: { row: 5, col: 4 }, path: [{ row: 3, col: 2 }] }])),
    ).toBe(true);
  });

  it('is false when every legal move is a plain step (lands one row away)', () => {
    expect(
      hasMandatoryCapture(simWith([{ from: { row: 5, col: 4 }, path: [{ row: 4, col: 3 }] }])),
    ).toBe(false);
  });

  it('is false for a null sim', () => {
    expect(hasMandatoryCapture(null)).toBe(false);
  });
});

describe('jumpPath (routes the slide along the jump path waypoints)', () => {
  const idx = (row: number, col: number): number => row * 8 + col;

  it('a plain step is a straight [from, to] line', () => {
    const anim = {
      from: idx(5, 4),
      to: idx(4, 3),
      color: 'violet' as const,
      king: false,
      crowned: false,
      captures: [],
    };
    expect(jumpPath(anim, 8)).toEqual({ points: [idx(5, 4), idx(4, 3)], captures: [] });
  });

  it('a single jump stays a straight line (the lone capture sits at the midpoint)', () => {
    const cap = { index: idx(4, 3), color: 'amber' as const, king: false };
    const anim = {
      from: idx(5, 4),
      to: idx(3, 2),
      color: 'violet' as const,
      king: false,
      crowned: false,
      captures: [cap],
    };
    expect(jumpPath(anim, 8)).toEqual({ points: [idx(5, 4), idx(3, 2)], captures: [cap] });
  });

  it('a multi-jump traces each diagonal hop, ordering the captures source->landing', () => {
    // (5,4) jumps (4,3) landing (3,2), then jumps (2,3) landing (1,4). The captures are given in a
    // different order than the hops to prove jumpPath re-orders them along the reconstructed path.
    const capA = { index: idx(2, 3), color: 'amber' as const, king: false };
    const capB = { index: idx(4, 3), color: 'amber' as const, king: false };
    const anim = {
      from: idx(5, 4),
      to: idx(1, 4),
      color: 'violet' as const,
      king: false,
      crowned: false,
      captures: [capA, capB],
    };
    expect(jumpPath(anim, 8)).toEqual({
      points: [idx(5, 4), idx(3, 2), idx(1, 4)],
      captures: [capB, capA],
    });
  });
});
