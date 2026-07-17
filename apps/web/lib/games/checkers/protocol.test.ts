import { describe, expect, it } from 'vitest';
import { asCheckersSim, sameCoord } from './protocol';

// Decoder tests (spec 0055): the client boundary must accept a well-formed Checkers sim and REJECT a
// malformed one as a whole (null -> skipped render), never render it half-decoded. Mirrors the real
// engine frame shape (packages/games/checkers/src/types.ts).

function goodSim(over = false) {
  return {
    size: 2,
    cells: ['empty', 'violet', 'amber-king', 'empty'],
    toMove: over ? null : 'violet',
    activePlayer: over ? '' : 'p1',
    legal: over ? [] : [{ from: { row: 0, col: 1 }, path: [{ row: 1, col: 0 }] }],
    violet: 1,
    amber: 1,
    over,
    outcome: over ? 'violet' : null,
  };
}

describe('asCheckersSim', () => {
  it('decodes a well-formed sim (incl. a king cell and a move path)', () => {
    const sim = asCheckersSim(goodSim());
    expect(sim).not.toBeNull();
    expect(sim?.size).toBe(2);
    expect(sim?.cells).toEqual(['empty', 'violet', 'amber-king', 'empty']);
    expect(sim?.toMove).toBe('violet');
    expect(sim?.legal[0]?.from).toEqual({ row: 0, col: 1 });
    expect(sim?.legal[0]?.path).toEqual([{ row: 1, col: 0 }]);
  });

  it('decodes a multi-hop jump path', () => {
    const sim = asCheckersSim({
      ...goodSim(),
      legal: [
        {
          from: { row: 5, col: 4 },
          path: [
            { row: 3, col: 2 },
            { row: 1, col: 4 },
          ],
        },
      ],
    });
    expect(sim?.legal[0]?.path).toHaveLength(2);
  });

  it('decodes a finished game (null toMove, outcome set)', () => {
    const sim = asCheckersSim(goodSim(true));
    expect(sim?.over).toBe(true);
    expect(sim?.toMove).toBeNull();
    expect(sim?.outcome).toBe('violet');
  });

  it('rejects a non-object', () => {
    expect(asCheckersSim(null)).toBeNull();
    expect(asCheckersSim(42)).toBeNull();
    expect(asCheckersSim('nope')).toBeNull();
  });

  it('rejects a cell array whose length does not match size*size', () => {
    expect(asCheckersSim({ ...goodSim(), cells: ['empty', 'violet'] })).toBeNull();
  });

  it('rejects an invalid cell value', () => {
    expect(
      asCheckersSim({ ...goodSim(), cells: ['empty', 'violet', 'amber', 'gold-king'] }),
    ).toBeNull();
  });

  it('rejects a malformed move (missing path)', () => {
    expect(asCheckersSim({ ...goodSim(), legal: [{ from: { row: 0, col: 1 } }] })).toBeNull();
  });

  it('rejects a move with an empty path', () => {
    expect(
      asCheckersSim({ ...goodSim(), legal: [{ from: { row: 0, col: 1 }, path: [] }] }),
    ).toBeNull();
  });

  it('rejects a malformed coordinate in a path', () => {
    expect(
      asCheckersSim({
        ...goodSim(),
        legal: [{ from: { row: 0, col: 1 }, path: [{ row: 0.5, col: 1 }] }],
      }),
    ).toBeNull();
  });

  it('rejects a missing scalar field', () => {
    const { violet, ...rest } = goodSim();
    void violet;
    expect(asCheckersSim(rest)).toBeNull();
  });

  it('coerces an unknown outcome to null', () => {
    const sim = asCheckersSim({ ...goodSim(), outcome: 'draw' });
    expect(sim?.outcome).toBeNull();
  });
});

describe('sameCoord', () => {
  it('compares two coordinates by row + col', () => {
    expect(sameCoord({ row: 2, col: 3 }, { row: 2, col: 3 })).toBe(true);
    expect(sameCoord({ row: 2, col: 3 }, { row: 2, col: 4 })).toBe(false);
  });
});
