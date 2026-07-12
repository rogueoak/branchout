// Physics-core tests: the ported legality rules (overlap + min-drop-line), scoring/height, piece
// determinism, and the settle simulation. These target the pure functions in physics.ts directly,
// where a held piece can be positioned at any (including illegal) transform - the exact placements
// the prototype's overlapsScene / evaluatePlacement / requiredDropHeight guarded against.

import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import {
  buildWorld,
  evaluatePlacement,
  heightToScore,
  heldBodyAt,
  makePiece,
  overlapsScene,
  requiredDropHeight,
  simulateDrop,
  storedTowerHeight,
  toBodyPayloads,
  towerHeight,
  type StoredBody,
} from './physics';
import { GROUND_TOP, LEVELS } from './levels';

/** A stored rectangle body, centered at (x, y-half..y+half), for building test scenes. */
function block(id: number, x: number, y: number, w: number, h: number): StoredBody {
  const hw = w / 2;
  const hh = h / 2;
  return {
    id,
    verts: [
      [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ],
    ],
    x,
    y,
    angle: 0,
    skin: { fill: '#fff', stroke: '#000' },
    eyes: [],
  };
}

describe('requiredDropHeight (min-drop line, ported)', () => {
  it('returns the first unmet quarter line above the current height', () => {
    const target = 300;
    expect(requiredDropHeight(target, 0)).toBe(75); // 25% line
    expect(requiredDropHeight(target, 80)).toBe(150); // past 25%, next is 50%
    expect(requiredDropHeight(target, 160)).toBe(225); // next is 75%
    expect(requiredDropHeight(target, 240)).toBe(300); // final target line
  });

  it('returns null once every line is cleared', () => {
    expect(requiredDropHeight(300, 300)).toBeNull();
    expect(requiredDropHeight(300, 999)).toBeNull();
  });
});

describe('overlapsScene / evaluatePlacement (ported legality)', () => {
  it('flags a held piece that overlaps a tower body', () => {
    const target = LEVELS[0]!.target;
    const tower = [block(1, 410, GROUND_TOP - 40, 120, 80)]; // sits on the platform
    const world = buildWorld(tower, target, false);
    const height = towerHeight(world.placed);

    // A held block placed at the same spot overlaps the tower body.
    const held = heldBodyAt(
      [
        [
          { x: -40, y: -30 },
          { x: 40, y: -30 },
          { x: 40, y: 30 },
          { x: -40, y: 30 },
        ],
      ],
      410,
      GROUND_TOP - 40,
      0,
    );
    expect(overlapsScene(held, world.platform, world.placed, world.pendulum)).toBe(true);
    const verdict = evaluatePlacement(
      held,
      target,
      height,
      world.platform,
      world.placed,
      world.pendulum,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('overlap');
  });

  it('flags a held piece dropped below the required min-drop line', () => {
    const target = LEVELS[0]!.target;
    const world = buildWorld([], target, false); // empty tower, required line = 75
    // A held piece whose bottom is well below the 75 line (near the platform) is illegal.
    const held = heldBodyAt(
      [
        [
          { x: -40, y: -20 },
          { x: 40, y: -20 },
          { x: 40, y: 20 },
          { x: -40, y: 20 },
        ],
      ],
      410,
      GROUND_TOP - 30, // bottom at GROUND_TOP-10, far below the 75 line at GROUND_TOP-75
      0,
    );
    const verdict = evaluatePlacement(
      held,
      target,
      0,
      world.platform,
      world.placed,
      world.pendulum,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('line');
  });

  it('accepts a clear piece placed above the line', () => {
    const target = LEVELS[0]!.target;
    const world = buildWorld([], target, false);
    const held = heldBodyAt(
      [
        [
          { x: -30, y: -20 },
          { x: 30, y: -20 },
          { x: 30, y: 20 },
          { x: -30, y: 20 },
        ],
      ],
      410,
      GROUND_TOP - 200, // bottom at GROUND_TOP-180, well above the 75 line
      0,
    );
    const verdict = evaluatePlacement(
      held,
      target,
      0,
      world.platform,
      world.placed,
      world.pendulum,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBeNull();
  });
});

describe('heightToScore (banded scoring, ported)', () => {
  it('bands height into 0/25/50/75/100 by quarter of target', () => {
    const target = 300;
    expect(heightToScore(0, target)).toBe(0);
    expect(heightToScore(74, target)).toBe(0);
    expect(heightToScore(75, target)).toBe(25);
    expect(heightToScore(150, target)).toBe(50);
    expect(heightToScore(225, target)).toBe(75);
    expect(heightToScore(300, target)).toBe(100);
    expect(heightToScore(999, target)).toBe(100); // clamped
  });
});

describe('towerHeight / storedTowerHeight', () => {
  it('measures the tallest body top above the platform', () => {
    const tower = [block(1, 410, GROUND_TOP - 50, 100, 100)]; // top at GROUND_TOP-100
    expect(storedTowerHeight(tower)).toBe(100);
    expect(storedTowerHeight([])).toBe(0);
  });
});

describe('piece determinism', () => {
  it('the same seed yields identical piece geometry, skin, eyes, and spin', () => {
    const a = makePiece(createRng(12345));
    const b = makePiece(createRng(12345));
    expect(toBodyPayloads([])).toEqual([]); // sanity: empty payload
    expect(a.skin).toEqual(b.skin);
    expect(a.eyes).toEqual(b.eyes);
    expect(a.spinSeed).toBe(b.spinSeed);
    // Vertex geometry (world-placed at origin) matches.
    expect(a.body.vertices.map((v) => [Math.round(v.x), Math.round(v.y)])).toEqual(
      b.body.vertices.map((v) => [Math.round(v.x), Math.round(v.y)]),
    );
  });

  it('different seeds generally yield different pieces', () => {
    const a = makePiece(createRng(1));
    const b = makePiece(createRng(2));
    const differs =
      a.spinSeed !== b.spinSeed ||
      JSON.stringify(a.skin) !== JSON.stringify(b.skin) ||
      a.body.vertices.length !== b.body.vertices.length;
    expect(differs).toBe(true);
  });
});

describe('simulateDrop', () => {
  it('is a pure function of its inputs: identical runs produce identical towers and tracks', () => {
    const piece = makePiece(createRng(42));
    const drop = {
      id: 1,
      verts: [piece.body.vertices.map((v) => ({ x: v.x, y: v.y }))],
      eyes: piece.eyes,
      skin: piece.skin,
      x: 410,
      y: GROUND_TOP - 200,
      angle: 0,
    };
    const target = LEVELS[0]!.target;
    const a = simulateDrop([], drop, target, false);
    const b = simulateDrop([], drop, target, false);
    expect(a.tower).toEqual(b.tower);
    expect(a.track).toEqual(b.track);
    expect(a.height).toBe(b.height);
    // The piece fell and rests on the platform (height > 0), and the track has a settle sequence.
    expect(a.height).toBeGreaterThan(0);
    expect(a.track.length).toBeGreaterThan(1);
  });

  it('culls a body that falls past the death line off the platform edge', () => {
    // A piece dropped far off the platform's edge tumbles off and is culled from the tower.
    const piece = makePiece(createRng(7));
    const drop = {
      id: 1,
      verts: [piece.body.vertices.map((v) => ({ x: v.x, y: v.y }))],
      eyes: piece.eyes,
      skin: piece.skin,
      x: 410 + 900, // way off the right edge
      y: GROUND_TOP - 200,
      angle: 0,
    };
    const result = simulateDrop([], drop, LEVELS[0]!.target, false);
    expect(result.tower).toHaveLength(0); // fell off, culled
    expect(result.height).toBe(0);
  });
});
