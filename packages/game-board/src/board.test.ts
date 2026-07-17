// Unit tests for the reusable, game-agnostic board harness (spec 0054): the Grid value type, the
// compass steps, and two-player turn/seat management. These are game-agnostic - Reversi, Checkers,
// and Chess all reuse this exact machinery, so pinning it here protects every consumer.

import { describe, it, expect } from 'vitest';
import {
  ALL_DIRECTIONS,
  assignSeats,
  DIAGONAL,
  emptyGrid,
  Grid,
  gridFromCells,
  ORTHOGONAL,
  otherSeat,
  Turns,
} from './board';
import type { SessionPlayer } from '@branchout/game-sdk';

function player(id: string): SessionPlayer {
  return { player: id, nickname: id, connected: true };
}

describe('Grid', () => {
  it('round-trips through a flat cell array (JSON-safe)', () => {
    const g = emptyGrid<number>(3, 0).set(1, 2, 7);
    const cells = g.toCells();
    expect(cells).toHaveLength(9);
    const back = gridFromCells<number>(3, cells);
    expect(back.at(1, 2)).toBe(7);
    expect(back.at(0, 0)).toBe(0);
  });

  it('set does not mutate the original grid', () => {
    const g = emptyGrid<number>(2, 0);
    const g2 = g.set(0, 0, 5);
    expect(g.at(0, 0)).toBe(0);
    expect(g2.at(0, 0)).toBe(5);
  });

  it('bounds-checks coordinates', () => {
    const g = emptyGrid<number>(2, 0);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(2, 0)).toBe(false);
    expect(g.inBounds(-1, 0)).toBe(false);
    expect(() => g.at(2, 2)).toThrow();
  });

  it('rejects a mismatched cell count', () => {
    expect(() => new Grid(3, [1, 2, 3])).toThrow();
  });

  it('counts and iterates every cell with its coordinate', () => {
    const g = emptyGrid<string>(2, '.').set(0, 1, 'x').set(1, 0, 'x');
    expect(g.count((c) => c === 'x')).toBe(2);
    const seen: string[] = [];
    g.forEach((c, { row, col }) => seen.push(`${row},${col}:${c}`));
    expect(seen).toEqual(['0,0:.', '0,1:x', '1,0:x', '1,1:.']);
  });
});

describe('compass steps', () => {
  it('has four orthogonals, four diagonals, eight total', () => {
    expect(ORTHOGONAL).toHaveLength(4);
    expect(DIAGONAL).toHaveLength(4);
    expect(ALL_DIRECTIONS).toHaveLength(8);
  });

  it('every step is a unit move with no duplicates', () => {
    const keys = new Set(ALL_DIRECTIONS.map((s) => `${s.dr},${s.dc}`));
    expect(keys.size).toBe(8);
    for (const s of ALL_DIRECTIONS) {
      expect(Math.abs(s.dr)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.dc)).toBeLessThanOrEqual(1);
      expect(s.dr === 0 && s.dc === 0).toBe(false);
    }
  });
});

describe('Turns + seats', () => {
  it('assigns seat 0 to the first player, seat 1 to the second', () => {
    const turns = assignSeats([player('a'), player('b')]);
    expect(turns.seats).toEqual(['a', 'b']);
    expect(turns.turn).toBe(0);
    expect(turns.activePlayer()).toBe('a');
  });

  it('resolves the seat a player holds', () => {
    const turns = assignSeats([player('a'), player('b')]);
    expect(turns.seatOf('a')).toBe(0);
    expect(turns.seatOf('b')).toBe(1);
    expect(turns.seatOf('c')).toBeNull();
  });

  it('advance passes the turn to the other seat', () => {
    const turns = assignSeats([player('a'), player('b')]);
    const next = turns.advance();
    expect(next.turn).toBe(1);
    expect(next.activePlayer()).toBe('b');
    // Original is unchanged (immutable).
    expect(turns.turn).toBe(0);
  });

  it('withTurn sets a specific seat (for a forced pass back)', () => {
    const turns = new Turns(['a', 'b'], 1).withTurn(0);
    expect(turns.turn).toBe(0);
    expect(turns.activePlayer()).toBe('a');
  });

  it('otherSeat flips', () => {
    expect(otherSeat(0)).toBe(1);
    expect(otherSeat(1)).toBe(0);
  });

  it('leaves seat 1 empty when only one player is present', () => {
    const turns = assignSeats([player('solo')]);
    expect(turns.seats).toEqual(['solo', '']);
  });
});
