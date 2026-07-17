import { describe, expect, it } from 'vitest';
import { asChessSim } from './protocol';

// The decoder is the client boundary: a well-formed sim decodes; a malformed one returns null (a
// skipped render, never a throw). These mirror the engine's ChessSim shape (packages/games/chess types).

function validSim(overrides: Record<string, unknown> = {}) {
  return {
    size: 8,
    cells: Array.from({ length: 64 }, () => 'empty'),
    toMove: 'white',
    activePlayer: 'p1',
    legal: [
      { from: { row: 6, col: 4 }, to: { row: 4, col: 4 } },
      { from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, promotion: 'Q' },
    ],
    check: false,
    over: false,
    outcome: null,
    endReason: null,
    ...overrides,
  };
}

describe('asChessSim', () => {
  it('decodes a well-formed sim', () => {
    const sim = asChessSim(validSim());
    expect(sim).not.toBeNull();
    expect(sim!.size).toBe(8);
    expect(sim!.toMove).toBe('white');
    expect(sim!.legal).toHaveLength(2);
    expect(sim!.legal[1]!.promotion).toBe('Q');
  });

  it('decodes piece codes and the empty square', () => {
    const cells = Array.from({ length: 64 }, () => 'empty') as string[];
    cells[0] = 'bR';
    cells[63] = 'wK';
    const sim = asChessSim(validSim({ cells }));
    expect(sim!.cells[0]).toBe('bR');
    expect(sim!.cells[63]).toBe('wK');
  });

  it('rejects a bad cell code', () => {
    const cells = Array.from({ length: 64 }, () => 'empty') as string[];
    cells[0] = 'xZ'; // not a valid color/type
    expect(asChessSim(validSim({ cells }))).toBeNull();
  });

  it('rejects a wrong-length board', () => {
    expect(asChessSim(validSim({ cells: ['empty'] }))).toBeNull();
  });

  it('rejects a malformed legal-move entry', () => {
    expect(asChessSim(validSim({ legal: [{ from: { row: 0 } }] }))).toBeNull();
  });

  it('decodes a finished game with an outcome + end reason', () => {
    const sim = asChessSim(
      validSim({ toMove: null, over: true, outcome: 'white', endReason: 'checkmate', legal: [] }),
    );
    expect(sim!.over).toBe(true);
    expect(sim!.outcome).toBe('white');
    expect(sim!.endReason).toBe('checkmate');
    expect(sim!.toMove).toBeNull();
  });

  it('returns null for a non-object / missing fields', () => {
    expect(asChessSim(null)).toBeNull();
    expect(asChessSim(42)).toBeNull();
    expect(asChessSim({ size: 8 })).toBeNull();
  });
});
