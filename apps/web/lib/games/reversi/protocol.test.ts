import { describe, expect, it } from 'vitest';
import { asReversiSim } from './protocol';

// Decoder tests (spec 0054): the client boundary must accept a well-formed Reversi sim and REJECT a
// malformed one as a whole (null -> skipped render), never render it half-decoded. Mirrors the real
// engine frame shape (packages/games/reversi/src/types.ts).

function goodSim(over = false) {
  return {
    size: 2,
    cells: ['empty', 'violet', 'amber', 'empty'],
    toMove: over ? null : 'violet',
    activePlayer: over ? '' : 'p1',
    legal: over ? [] : [{ row: 0, col: 0 }],
    violet: 1,
    amber: 1,
    passed: false,
    over,
    outcome: over ? 'violet' : null,
  };
}

describe('asReversiSim', () => {
  it('decodes a well-formed sim', () => {
    const sim = asReversiSim(goodSim());
    expect(sim).not.toBeNull();
    expect(sim?.size).toBe(2);
    expect(sim?.cells).toHaveLength(4);
    expect(sim?.toMove).toBe('violet');
    expect(sim?.legal).toEqual([{ row: 0, col: 0 }]);
  });

  it('decodes a finished game (null toMove, outcome set)', () => {
    const sim = asReversiSim(goodSim(true));
    expect(sim?.over).toBe(true);
    expect(sim?.toMove).toBeNull();
    expect(sim?.outcome).toBe('violet');
  });

  it('rejects a non-object', () => {
    expect(asReversiSim(null)).toBeNull();
    expect(asReversiSim(42)).toBeNull();
    expect(asReversiSim('nope')).toBeNull();
  });

  it('rejects a cell array whose length does not match size*size', () => {
    expect(asReversiSim({ ...goodSim(), cells: ['empty', 'violet'] })).toBeNull();
  });

  it('rejects an invalid cell value', () => {
    expect(
      asReversiSim({ ...goodSim(), cells: ['empty', 'violet', 'amber', 'purple'] }),
    ).toBeNull();
  });

  it('rejects a malformed legal-move entry', () => {
    expect(asReversiSim({ ...goodSim(), legal: [{ row: 0 }] })).toBeNull();
    expect(asReversiSim({ ...goodSim(), legal: [{ row: 0.5, col: 1 }] })).toBeNull();
  });

  it('rejects a missing scalar field', () => {
    const { violet, ...rest } = goodSim();
    void violet;
    expect(asReversiSim(rest)).toBeNull();
  });

  it('coerces an unknown outcome to null', () => {
    const sim = asReversiSim({ ...goodSim(), outcome: 'weird' });
    expect(sim?.outcome).toBeNull();
  });
});
