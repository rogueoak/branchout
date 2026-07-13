// Physics-core tests (spec 0044 - live physics). These target the pure/primitive functions in
// physics.ts directly: the ported legality rules (overlap + min-drop-line), scoring/height, piece
// determinism (seeded shapes), and the live world (create/step/add-piece/measure). The settle is now
// real-time - the world runs continuously - so we assert it converges and culls, not a pure track.

import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from './rng';
import {
  TRAP_DENSITY_MULT,
  addPieceToWorld,
  createWorld,
  evaluatePlacement,
  heightToScore,
  heldBodyAt,
  localVerts,
  makePiece,
  overlapsScene,
  pieceForIndex,
  requiredDropHeight,
  sceneSettled,
  stepWorld,
  storedPieceFrom,
  toBodyPayloads,
  toStoredBodies,
  clampDropY,
  worldHeight,
  type LiveWorld,
  type StoredBody,
} from './physics';
import {
  CENTER_X,
  GROUND_TOP,
  LEVELS,
  PIECE_DENSITY,
  PLATFORM_W,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WIDE_PLATFORM_W,
} from './levels';

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

/** A live world at level 0 with the given placed bodies (no pendulum, open platform - no walls). */
function worldWith(bodies: StoredBody[], target = LEVELS[0]!.target, pendulum = false): LiveWorld {
  return createWorld({
    seed: 1,
    levelIndex: 0,
    bestHeight: 0,
    stableHeight: 0,
    piecesThisLevel: 0,
    totalScore: 0,
    pieceIndex: 0,
    bodies,
    next: null,
    target,
    pendulum,
    platformWidth: PLATFORM_W,
    walls: false,
  });
}

describe('level-1 side walls (feedback 0023: pieces do not slide off)', () => {
  /** A live world at the walled level-1 platform (the only walled level). */
  function walledWorld(): LiveWorld {
    return createWorld({
      seed: 1,
      levelIndex: 0,
      bestHeight: 0,
      stableHeight: 0,
      piecesThisLevel: 0,
      totalScore: 0,
      pieceIndex: 0,
      bodies: [],
      next: null,
      target: LEVELS[0]!.target,
      pendulum: false,
      platformWidth: WIDE_PLATFORM_W,
      walls: true,
    });
  }

  it('builds two static side curbs, inner faces flush with the platform edges', () => {
    const world = walledWorld();
    expect(world.walls).toHaveLength(2);
    expect(world.walls.every((w) => w.isStatic)).toBe(true);
    const xs = world.walls.map((w) => w.position.x).sort((a, b) => a - b);
    // One curb left of centre, one right, each near the wide platform's edge.
    expect(xs[0]!).toBeLessThan(CENTER_X);
    expect(xs[1]!).toBeGreaterThan(CENTER_X);
    expect(xs[1]! - xs[0]!).toBeCloseTo(WIDE_PLATFORM_W - WALL_THICKNESS, 5);
  });

  it('a piece at the platform edge is blocked ONLY because the wall is there', () => {
    const world = walledWorld();
    // A small box sitting at the right curb's centre - above the platform top (so it never touches the
    // platform), overlapping only the wall. Without the walls the scene reads clear; with them, blocked.
    const rightWallX = CENTER_X + WIDE_PLATFORM_W / 2 - WALL_THICKNESS / 2;
    const held = heldBodyAt(
      [
        [
          { x: -12, y: -12 },
          { x: 12, y: -12 },
          { x: 12, y: 12 },
          { x: -12, y: 12 },
        ],
      ],
      rightWallX,
      GROUND_TOP - WALL_HEIGHT / 2,
      0,
    );
    expect(overlapsScene(held, world.platform, [], world.pendulum, [])).toBe(false);
    expect(overlapsScene(held, world.platform, [], world.pendulum, world.walls)).toBe(true);
    // And the full placement verdict rejects it as an overlap (the server's authoritative gate).
    const verdict = evaluatePlacement(
      held,
      LEVELS[0]!.target,
      0,
      world.platform,
      [],
      world.pendulum,
      world.walls,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('overlap');
  });
});

describe('heavy trapezoid (the special reinforcement piece)', () => {
  const HEAVY = PIECE_DENSITY * TRAP_DENSITY_MULT;

  /** Find the first piece index (in the deterministic stream) that yields a trapezoid. */
  function firstTrapIndex(): number {
    for (let i = 0; i < 300; i++) {
      if (makePiece(createRng(deriveSeed(1, i))).body.density > PIECE_DENSITY * 1.5) return i;
    }
    return -1;
  }

  it('the trapezoid appears in the stream and is 4x denser than a normal piece', () => {
    const i = firstTrapIndex();
    expect(i).toBeGreaterThanOrEqual(0);
    const trap = makePiece(createRng(deriveSeed(1, i)));
    expect(trap.body.density).toBeCloseTo(HEAVY, 10);
    // It is a single convex body (no compound parts) and near-black.
    expect(trap.body.parts.length).toBe(1);
    expect(trap.skin.fill.toLowerCase()).toMatch(/^#0/);
  });

  it('keeps its 4x weight through the store + rebuild round-trip', () => {
    const trap = makePiece(createRng(deriveSeed(1, firstTrapIndex())));
    const stored = storedPieceFrom(42, trap);
    expect(stored.density).toBeCloseTo(HEAVY, 10);
    // Drop it in and snapshot: the placed body (and its persisted snapshot) keep the heavy density,
    // so a rebuild-from-snapshot does not silently make it light again.
    const world = worldWith([]);
    addPieceToWorld(world, stored, 410, GROUND_TOP - 200, 0);
    expect(toStoredBodies(world)[0]!.density).toBeCloseTo(HEAVY, 10);
  });
});

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

  it('holds the reported height until the scene settles (feedback 0026: no airborne instant-win)', () => {
    const world = worldWith([]);
    const target = LEVELS[0]!.target; // 450
    // Release a piece from well ABOVE the target line - its top starts ~500px up, over the 450 target.
    // The reported height is `stableHeight`, refreshed ONLY when the scene is settled (this mirrors the
    // tick). While the piece falls, the scene is not settled, so the reported height holds (0 here) and
    // the level never "clears" on the airborne peak.
    const piece = storedPieceFrom(1, pieceForIndex(42, 0));
    addPieceToWorld(world, piece, CENTER_X, GROUND_TOP - 480, 0);
    let stableHeight = 0;
    let maxReported = 0;
    // 220 steps lands well past the piece coming to rest (~step 70), so the final read is stable.
    for (let i = 0; i < 220; i++) {
      stepWorld(world); // mirrors the tick: step, THEN (only if settled) refresh the reported height
      if (sceneSettled(world)) stableHeight = worldHeight(world);
      maxReported = Math.max(maxReported, stableHeight);
    }
    // It comes to rest on the platform far below the release height, so the reported height is real
    // (> 0) but never reached the target - the level would not have cleared on the drop.
    expect(stableHeight).toBeGreaterThan(0);
    expect(stableHeight).toBeLessThan(target);
    expect(maxReported).toBeLessThan(target);
  });

  it('sceneSettled is false while a body moves and true once at rest (feedback 0026)', () => {
    const world = worldWith([]);
    const piece = storedPieceFrom(1, pieceForIndex(42, 0));
    addPieceToWorld(world, piece, CENTER_X, GROUND_TOP - 480, 0);
    stepWorld(world); // one step under gravity -> the piece is now moving
    expect(sceneSettled(world)).toBe(false);
    for (let i = 0; i < 220; i++) stepWorld(world);
    expect(sceneSettled(world)).toBe(true);
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

describe('compound (ell) round-trip through bodyFromStored (spec 0023)', () => {
  it('rebuilds the L with its arms spread, not collapsed onto the centroid', () => {
    // Seed 8 yields an "ell" (a compound body: parts.length > 1). Snapshot it to local vertex loops
    // and rebuild it via bodyFromStored (the reconnect / worker-restart path). The rebuilt collision
    // shape must match the original - Matter re-centres each part on setVertices, so the rebuild has to
    // restore each part's offset. If it collapses the arms onto (0,0), the collision shape drifts from
    // the drawn shape (overlaps/gaps in play).
    const original = makePiece(createRng(8)).body;
    expect(original.parts.length).toBeGreaterThan(2); // parent + >= 2 arms => a genuine compound

    const verts = localVerts(original);
    expect(verts.length).toBeGreaterThan(1); // more than one collision loop

    // Rebuild at a non-trivial transform via addPieceToWorld -> bodyFromStored, then read it back.
    const world = worldWith([]);
    const stored = storedPieceFrom(1, makePiece(createRng(8)));
    addPieceToWorld(world, stored, 410, GROUND_TOP - 200, 0);
    const rebuilt = world.placed[0]!.body;

    // Same part count (parent + arms) survived the round-trip.
    expect(rebuilt.parts.length).toBe(original.parts.length);

    // Overall bounds (width/height) match within a small epsilon - the arms are NOT collapsed.
    const w = (b: (typeof original)['bounds']): number => b.max.x - b.min.x;
    const h = (b: (typeof original)['bounds']): number => b.max.y - b.min.y;
    expect(w(rebuilt.bounds)).toBeCloseTo(w(original.bounds), 1);
    expect(h(rebuilt.bounds)).toBeCloseTo(h(original.bounds), 1);

    // The definitive signal: each arm keeps its offset from the compound centroid (a collapsed rebuild
    // would put every arm at (0,0)). Compare the sorted per-part offsets of original vs rebuilt.
    const offsets = (b: typeof original): { x: number; y: number }[] =>
      b.parts
        .slice(1)
        .map((p) => ({ x: p.position.x - b.position.x, y: p.position.y - b.position.y }))
        .sort((p, q) => p.x - q.x || p.y - q.y);
    const oOff = offsets(original);
    const rOff = offsets(rebuilt);
    // At least one arm sits off the centroid (proves the arrangement, not a single blob at origin).
    expect(oOff.some((o) => Math.hypot(o.x, o.y) > 1)).toBe(true);
    for (let i = 0; i < oOff.length; i++) {
      expect(rOff[i]!.x).toBeCloseTo(oOff[i]!.x, 1);
      expect(rOff[i]!.y).toBeCloseTo(oOff[i]!.y, 1);
    }
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
