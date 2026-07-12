import { describe, expect, it } from 'vitest';
import { asTeeterPrompt, asTeeterReveal, pickTeeterReveal } from './protocol';

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
const piece = { verts, eyes, skin, x: 410, y: 440, spinSeed: 0.02 };

describe('asTeeterPrompt', () => {
  it('decodes a well-formed prompt', () => {
    const prompt = asTeeterPrompt({
      round: 3,
      level: 0,
      target: 300,
      height: 120,
      activePlayer: 'p1',
      tower: [body],
      piece,
    });
    expect(prompt).not.toBeNull();
    expect(prompt?.round).toBe(3);
    expect(prompt?.activePlayer).toBe('p1');
    expect(prompt?.tower).toHaveLength(1);
    expect(prompt?.tower[0]?.verts[0]).toHaveLength(4);
    expect(prompt?.piece.spinSeed).toBe(0.02);
  });

  it('returns null on a missing or malformed field', () => {
    expect(asTeeterPrompt(null)).toBeNull();
    expect(
      asTeeterPrompt({ round: 1, level: 0, target: 300, height: 0, tower: [], piece }),
    ).toBeNull();
    // activePlayer must be a string.
    expect(
      asTeeterPrompt({
        round: 1,
        level: 0,
        target: 300,
        height: 0,
        activePlayer: 2,
        tower: [],
        piece,
      }),
    ).toBeNull();
  });

  it('rejects a tower body with a malformed vertex loop', () => {
    const badBody = { ...body, verts: [[{ x: 1 }]] };
    expect(
      asTeeterPrompt({
        round: 1,
        level: 0,
        target: 300,
        height: 0,
        activePlayer: 'p1',
        tower: [badBody],
        piece,
      }),
    ).toBeNull();
  });

  it('rejects a piece with a non-numeric spin seed', () => {
    expect(
      asTeeterPrompt({
        round: 1,
        level: 0,
        target: 300,
        height: 0,
        activePlayer: 'p1',
        tower: [],
        piece: { ...piece, spinSeed: 'fast' },
      }),
    ).toBeNull();
  });
});

describe('asTeeterReveal', () => {
  const track = [
    { t: 0, bodies: [{ id: 1, x: 410, y: 440, angle: 0 }] },
    { t: 48, bodies: [{ id: 1, x: 410, y: 500, angle: 0.1 }] },
  ];

  it('decodes a well-formed reveal', () => {
    const reveal = asTeeterReveal({
      track,
      tower: [body],
      height: 120,
      score: 25,
      level: 0,
      target: 300,
      cleared: false,
    });
    expect(reveal).not.toBeNull();
    expect(reveal?.track).toHaveLength(2);
    expect(reveal?.track[1]?.bodies[0]?.y).toBe(500);
    expect(reveal?.score).toBe(25);
    expect(reveal?.cleared).toBe(false);
  });

  it('accepts an empty track (a host force-close no-op settle)', () => {
    const reveal = asTeeterReveal({
      track: [],
      tower: [],
      height: 0,
      score: 0,
      level: 0,
      target: 300,
      cleared: false,
    });
    expect(reveal?.track).toEqual([]);
  });

  it('returns null on a malformed track frame or missing field', () => {
    expect(asTeeterReveal(null)).toBeNull();
    expect(
      asTeeterReveal({
        track: [{ t: 0, bodies: [{ id: 1, x: 1, y: 2 }] }],
        tower: [],
        height: 0,
        score: 0,
        level: 0,
        target: 300,
        cleared: false,
      }),
    ).toBeNull();
    // cleared must be a boolean.
    expect(
      asTeeterReveal({
        track,
        tower: [body],
        height: 1,
        score: 0,
        level: 0,
        target: 300,
        cleared: 'yes',
      }),
    ).toBeNull();
  });
});

describe('pickTeeterReveal', () => {
  it('picks the most recent decodable reveal, skipping foreign shapes', () => {
    const good = {
      track: [],
      tower: [],
      height: 50,
      score: 25,
      level: 0,
      target: 300,
      cleared: false,
    };
    expect(pickTeeterReveal([{ notMine: true }, good])?.score).toBe(25);
    expect(pickTeeterReveal([{ notMine: true }])).toBeNull();
    expect(pickTeeterReveal([])).toBeNull();
  });
});
