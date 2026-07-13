import { describe, expect, it } from 'vitest';
import { asTeeterSim } from './protocol';

const skin = { fill: '#ef476f', stroke: '#b52c4d' };
const eyes = [
  { x: -12, y: -6, r: 9 },
  { x: 12, y: -6, r: 9 },
];
const verts = [
  [
    { x: -30, y: -20 },
    { x: 30, y: -20 },
    { x: 30, y: 20 },
    { x: -30, y: 20 },
  ],
];

const body = { id: 1, verts, x: 410, y: 520, angle: 0, skin, eyes };
const piece = { id: 7, verts, eyes, skin, x: 410, y: 440, spinSeed: 0.02 };

function sim(overrides: Record<string, unknown> = {}) {
  return {
    bodies: [body],
    next: piece,
    activePlayer: 'p1',
    height: 120,
    score: 25,
    level: 0,
    target: 600,
    requiredLine: 480,
    over: false,
    ...overrides,
  };
}

describe('asTeeterSim', () => {
  it('decodes a well-formed live snapshot', () => {
    const decoded = asTeeterSim(sim());
    expect(decoded).not.toBeNull();
    expect(decoded?.activePlayer).toBe('p1');
    expect(decoded?.bodies).toHaveLength(1);
    expect(decoded?.bodies[0]?.verts[0]).toHaveLength(4);
    expect(decoded?.next?.id).toBe(7);
    expect(decoded?.next?.spinSeed).toBe(0.02);
    expect(decoded?.requiredLine).toBe(480);
    expect(decoded?.over).toBe(false);
  });

  it('accepts an empty tower and a null next piece (game over)', () => {
    const decoded = asTeeterSim(sim({ bodies: [], next: null, over: true }));
    expect(decoded?.bodies).toEqual([]);
    expect(decoded?.next).toBeNull();
    expect(decoded?.over).toBe(true);
  });

  it('returns null for a non-object or a foreign shape', () => {
    expect(asTeeterSim(null)).toBeNull();
    expect(asTeeterSim(42)).toBeNull();
    expect(asTeeterSim({ notMine: true })).toBeNull();
  });

  it('returns null on a missing or wrong-typed field', () => {
    // activePlayer must be a string.
    expect(asTeeterSim(sim({ activePlayer: 2 }))).toBeNull();
    // requiredLine must be a finite number.
    expect(asTeeterSim(sim({ requiredLine: 'high' }))).toBeNull();
    // over must be a boolean.
    expect(asTeeterSim(sim({ over: 'yes' }))).toBeNull();
    // next is Piece | null - an malformed object (not null) is rejected.
    expect(asTeeterSim(sim({ next: { id: 1 } }))).toBeNull();
  });

  it('rejects a body with a malformed vertex loop', () => {
    const badBody = { ...body, verts: [[{ x: 1 }]] };
    expect(asTeeterSim(sim({ bodies: [badBody] }))).toBeNull();
  });

  it('rejects a piece with a non-numeric spin seed or missing id', () => {
    expect(asTeeterSim(sim({ next: { ...piece, spinSeed: 'fast' } }))).toBeNull();
    const noId = { verts, eyes, skin, x: 410, y: 440, spinSeed: 0.02 };
    expect(asTeeterSim(sim({ next: noId }))).toBeNull();
  });
});
