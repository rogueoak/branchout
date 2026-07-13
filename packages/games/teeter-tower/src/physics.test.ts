// Physics-core tests (spec 0044 - live physics). These target the pure/primitive functions in
// physics.ts directly: the ported legality rules (overlap + min-drop-line), scoring/height, piece
// determinism (seeded shapes), and the live world (create/step/add-piece/measure). The settle is now
// real-time - the world runs continuously - so we assert it converges and culls, not a pure track.

import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import {
  addPieceToWorld,
  createWorld,
  evaluatePlacement,
  heightToScore,
  heldBodyAt,
  makePiece,
  overlapsScene,
  pieceForIndex,
  requiredDropHeight,
  stepWorld,
  storedPieceFrom,
  toBodyPayloads,
  toStoredBodies,
  clampDropY,
  worldHeight,
  type LiveWorld,
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
    vx: 0,
    vy: 0,
    angularVelocity: 0,
    skin: { fill: '#fff', stroke: '#000' },
    eyes: [],
  };
}

/** A live world at level 0 with the given placed bodies (no pendulum). */
function worldWith(bodies: StoredBody[], target = LEVELS[0]!.target, pendulum = false): LiveWorld {
  return createWorld({
    seed: 1,
    levelIndex: 0,
    bestHeight: 0,
    totalScore: 0,
    pieceIndex: 0,
    bodies,
    next: null,
    target,
    pendulum,
  });
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
    const world = worldWith([block(1, 410, GROUND_TOP - 40, 120, 80)]); // sits on the platform
    const placed = world.placed.map((p) => p.body);
    const height = worldHeight(world);

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
    expect(overlapsScene(held, world.platform, placed, world.pendulum)).toBe(true);
    const verdict = evaluatePlacement(held, target, height, world.platform, placed, world.pendulum);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('overlap');
  });

  it('flags a held piece dropped below the required min-drop line', () => {
    const target = LEVELS[0]!.target;
    const world = worldWith([]); // empty tower, required line = 25% of target
    const placed = world.placed.map((p) => p.body);
    // A held piece whose bottom is near the platform is below the required line.
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
      GROUND_TOP - 30, // bottom at GROUND_TOP-10, far below the 25% line
      0,
    );
    const verdict = evaluatePlacement(held, target, 0, world.platform, placed, world.pendulum);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('line');
  });

  it('accepts a clear piece placed above the line', () => {
    const target = LEVELS[0]!.target;
    const world = worldWith([]);
    const placed = world.placed.map((p) => p.body);
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
      GROUND_TOP - 200, // bottom at GROUND_TOP-180, above the 25% line
      0,
    );
    const verdict = evaluatePlacement(held, target, 0, world.platform, placed, world.pendulum);
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

describe('worldHeight', () => {
  it('measures the tallest body top above the platform', () => {
    const world = worldWith([block(1, 410, GROUND_TOP - 50, 100, 100)]); // top at GROUND_TOP-100
    expect(worldHeight(world)).toBe(100);
    expect(worldHeight(worldWith([]))).toBe(0);
  });
});

describe('piece determinism', () => {
  it('the same seed yields identical piece geometry, skin, eyes, and spin', () => {
    const a = makePiece(createRng(12345));
    const b = makePiece(createRng(12345));
    expect(toBodyPayloads(worldWith([]))).toEqual([]); // sanity: empty payload
    expect(a.skin).toEqual(b.skin);
    expect(a.eyes).toEqual(b.eyes);
    expect(a.spinSeed).toBe(b.spinSeed);
    // Vertex geometry (world-placed at origin) matches.
    expect(a.body.vertices.map((v) => [Math.round(v.x), Math.round(v.y)])).toEqual(
      b.body.vertices.map((v) => [Math.round(v.x), Math.round(v.y)]),
    );
  });

  it('pieceForIndex is deterministic per (seed, index) and varies across indices', () => {
    const a = storedPieceFrom(0, pieceForIndex(999, 0));
    const b = storedPieceFrom(0, pieceForIndex(999, 0));
    expect(a).toEqual(b);
    const c = storedPieceFrom(1, pieceForIndex(999, 1));
    const differs =
      JSON.stringify(a.verts) !== JSON.stringify(c.verts) || a.spinSeed !== c.spinSeed;
    expect(differs).toBe(true);
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

describe('the live world', () => {
  it('steps a dropped piece down onto the platform (height grows, then settles)', () => {
    const world = worldWith([]);
    const piece = storedPieceFrom(1, pieceForIndex(42, 0));
    addPieceToWorld(world, piece, 410, GROUND_TOP - 200, 0);
    // Step the world enough ticks for the piece to fall and settle on the platform.
    for (let i = 0; i < 120; i++) stepWorld(world);
    expect(world.placed).toHaveLength(1);
    expect(worldHeight(world)).toBeGreaterThan(0);
  });

  it('culls a body that falls past the death line off the platform edge', () => {
    const world = worldWith([]);
    const piece = storedPieceFrom(1, pieceForIndex(7, 0));
    addPieceToWorld(world, piece, 410 + 900, GROUND_TOP - 200, 0); // way off the right edge
    for (let i = 0; i < 200; i++) stepWorld(world);
    expect(world.placed).toHaveLength(0); // fell off, culled
    expect(worldHeight(world)).toBe(0);
  });

  it('rebuilding from stored bodies reproduces the same tower height', () => {
    const world = worldWith([]);
    const piece = storedPieceFrom(1, pieceForIndex(42, 0));
    addPieceToWorld(world, piece, 410, GROUND_TOP - 200, 0);
    for (let i = 0; i < 120; i++) stepWorld(world);
    const settledHeight = worldHeight(world);
    // Snapshot the placed bodies and rebuild a fresh world from them.
    const bodies: StoredBody[] = world.placed.map((p) => ({
      id: p.id,
      verts: p.verts,
      x: p.body.position.x,
      y: p.body.position.y,
      angle: p.body.angle,
      vx: p.body.velocity.x,
      vy: p.body.velocity.y,
      angularVelocity: p.body.angularVelocity,
      skin: p.skin,
      eyes: p.eyes,
    }));
    const rebuilt = worldWith(bodies);
    expect(worldHeight(rebuilt)).toBe(settledHeight);
  });

  it('persists per-body velocity and restores it on rebuild (spec 0044)', () => {
    // A body mid-fall carries velocity; toStoredBodies must persist it and createWorld restore it, so
    // a rebuild resumes motion rather than re-settling from rest.
    const world = worldWith([]);
    const piece = storedPieceFrom(1, pieceForIndex(42, 0));
    addPieceToWorld(world, piece, 410, GROUND_TOP - 300, 0);
    for (let i = 0; i < 10; i++) stepWorld(world); // still falling: non-zero downward velocity
    const stored = toStoredBodies(world);
    expect(stored[0]!.vy).toBeGreaterThan(0);
    const rebuilt = worldWith(stored);
    // The rebuilt body resumes with (approximately) the stored velocity, not from rest.
    expect(rebuilt.placed[0]!.body.velocity.y).toBeCloseTo(stored[0]!.vy, 2);
  });
});

describe('clampDropY', () => {
  it('clamps a finite y into the world range and passes an in-range y through', () => {
    // Below the platform is clamped up to GROUND_TOP; far above the world is clamped to the ceiling;
    // an in-range value is unchanged.
    expect(clampDropY(GROUND_TOP + 500)).toBe(GROUND_TOP);
    expect(clampDropY(-100000)).toBe(GROUND_TOP - 2000);
    expect(clampDropY(GROUND_TOP - 300)).toBe(GROUND_TOP - 300);
  });
});
