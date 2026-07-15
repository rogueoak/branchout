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
    par: 8,
    pieces: 3,
    requiredLine: 480,
    platform: { width: 480, walls: false },
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
    expect(decoded?.platform).toEqual({ width: 480, walls: false });
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
    // par + pieces (feedback 0026) must be finite numbers.
    expect(asTeeterSim(sim({ par: 'lots' }))).toBeNull();
    expect(asTeeterSim(sim({ pieces: null }))).toBeNull();
    // over must be a boolean.
    expect(asTeeterSim(sim({ over: 'yes' }))).toBeNull();
    // next is Piece | null - an malformed object (not null) is rejected.
    expect(asTeeterSim(sim({ next: { id: 1 } }))).toBeNull();
    // platform must be a { width:number, walls:boolean } object.
    expect(asTeeterSim(sim({ platform: undefined }))).toBeNull();
    expect(asTeeterSim(sim({ platform: { width: 480 } }))).toBeNull();
    expect(asTeeterSim(sim({ platform: { width: 480, walls: 'yes' } }))).toBeNull();
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

  it('decodes the round-transition phase, defaulting to "playing" when absent (feedback 0032)', () => {
    // Each valid phase round-trips.
    expect(asTeeterSim(sim({ phase: 'playing' }))?.phase).toBe('playing');
    expect(asTeeterSim(sim({ phase: 'complete' }))?.phase).toBe('complete');
    expect(asTeeterSim(sim({ phase: 'intro' }))?.phase).toBe('intro');
    // Absent or invalid -> defaults to 'playing' (resilient to a pre-field engine frame), NOT a reject.
    const noPhase = sim();
    delete (noPhase as { phase?: unknown }).phase;
    expect(asTeeterSim(noPhase)).not.toBeNull();
    expect(asTeeterSim(noPhase)?.phase).toBe('playing');
    expect(asTeeterSim(sim({ phase: 'bogus' }))?.phase).toBe('playing');
    expect(asTeeterSim(sim({ phase: 42 }))?.phase).toBe('playing');
  });
});
