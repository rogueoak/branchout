// The physics core for Teeter Tower (spec 0044). Teeter is a LIVE game: instead of simulating a
// single drop to settle and freezing a keyframe track, the module holds a continuously-running
// matter world in process and steps it every engine tick. This file owns the matter primitives -
// piece generation, the live world (create/step/add-piece/measure), legality, and the payload
// builders that turn the live world into a streamable `TeeterSim` snapshot.
//
// Piece SHAPES stay deterministic (a seeded PRNG keyed on (seed, pieceIndex)) so every client sees
// the same piece stream; the settle itself is now real-time (the world runs), so a reconnecting
// device rebuilds the world from a compact scratch snapshot rather than replaying a pure track.

import Matter from 'matter-js';
import decomp from 'poly-decomp';
import type { SeededRng } from './rng';
import { createRng, deriveSeed } from './rng';
import {
  CENTER_X,
  DEATH_Y,
  DROP_HALF_RANGE,
  GROUND_TOP,
  MAX_FALL_SPEED,
  PALETTE,
  PIECE_DENSITY,
  PIECE_FRICTION,
  PIECE_FRICTION_AIR,
  PIECE_FRICTION_STATIC,
  PLATFORM_H,
  PLATFORM_W,
  SPAWN_Y,
} from './levels';
import type { Body as BodyPayload, Eye, Piece, Skin, Vec2 } from './types';

const { Bodies, Body, Common, Composite, Constraint, Engine, Query } = Matter;

// Wire poly-decomp once at module load so `Bodies.fromVertices` decomposes the concave "blob" piece
// into convex parts instead of silently falling back to a convex hull (which also logs a console.warn
// on every step). poly-decomp is deterministic, so a given seed always yields the same geometry.
Common.setDecomp(decomp);

// ---------------------------------------------------------------------------
// Fixed-timestep tuning (deterministic shapes; real-time solver stepping)
// ---------------------------------------------------------------------------

/** Fixed physics step, ms. 60 Hz, matching the prototype's runner. */
export const STEP_MS = 1000 / 60;
/**
 * Physics substeps per engine tick. The engine ticks at 40ms (25 fps, spec 0044); stepping the
 * solver at a fixed 60 Hz means ~2 substeps per tick, which keeps the feel stable and frame-rate
 * independent (the solver never sees a variable dt).
 */
export const SUBSTEPS_PER_TICK = 2;

// ---------------------------------------------------------------------------
// Persisted body shape (what the module keeps in scratch so a reconnect rebuilds the world)
// ---------------------------------------------------------------------------

/** A placed piece as persisted in scratch: local geometry + world transform + motion + cosmetics. */
export interface StoredBody {
  id: number;
  /** One local-space polygon loop per collision part (compound pieces have several). */
  verts: Vec2[][];
  x: number;
  y: number;
  angle: number;
  /**
   * Per-body velocity persisted with the transform (spec 0044), so a rebuild-from-snapshot resumes
   * the tower's motion rather than re-settling every body from rest (which can diverge from the live
   * world). Absent on a legacy snapshot -> restored as rest (0), matching the old behavior.
   */
  vx: number;
  vy: number;
  angularVelocity: number;
  skin: Skin;
  eyes: Eye[];
}

/** The aim piece as persisted in scratch (local geometry + cosmetics; no world transform yet). */
export interface StoredPiece {
  id: number;
  verts: Vec2[][];
  eyes: Eye[];
  skin: Skin;
  spinSeed: number;
}

// ---------------------------------------------------------------------------
// Deterministic piece generation (ported from the prototype's makePiece)
// ---------------------------------------------------------------------------

type PieceType = 'block' | 'plank' | 'ell' | 'blob' | 'tri';
const TYPE_BAG: readonly PieceType[] = [
  'block',
  'block',
  'plank',
  'plank',
  'ell',
  'ell',
  'blob',
  'tri',
];

/** A generated piece: a matter body plus its cosmetics, all in local space (centered at origin). */
export interface GeneratedPiece {
  body: Matter.Body;
  skin: Skin;
  eyes: Eye[];
  /** The prototype's spin seed (a signed rotation speed) the renderer uses to spin the piece. */
  spinSeed: number;
}

/**
 * Build a piece body centered at the origin, deterministically from `rng`. Mirrors the prototype's
 * makePiece shape mix and jitter exactly, so a given seed always yields the same shape. The body is
 * created dynamic-but-inert here; callers place it into the world as needed.
 */
export function makePiece(rng: SeededRng): GeneratedPiece {
  const skin = rng.pick(PALETTE);
  const opts: Matter.IChamferableBodyDefinition = {
    friction: PIECE_FRICTION,
    frictionStatic: PIECE_FRICTION_STATIC,
    frictionAir: PIECE_FRICTION_AIR,
    restitution: 0,
    density: PIECE_DENSITY,
  };

  const type = rng.pick(TYPE_BAG);
  const s = rng.range(0.85, 1.25); // per-piece size jitter
  let body: Matter.Body;

  if (type === 'blob') {
    const n = Math.floor(rng.range(5, 8));
    const R = 42 * s;
    const verts: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = R * rng.range(0.82, 1.08);
      verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    body = Bodies.fromVertices(0, 0, [verts], opts);
  } else if (type === 'plank') {
    body = Bodies.rectangle(0, 0, rng.range(120, 165) * s, rng.range(26, 38) * s, opts);
  } else if (type === 'block') {
    body = Bodies.rectangle(0, 0, rng.range(64, 90) * s, rng.range(58, 82) * s, opts);
  } else if (type === 'tri') {
    body = Bodies.polygon(0, 0, 3, rng.range(52, 66) * s, opts);
  } else {
    // "ell" - a compound L shape.
    const t = rng.range(28, 36) * s;
    const len = rng.range(78, 104) * s;
    const partOpts: Matter.IChamferableBodyDefinition = {
      friction: PIECE_FRICTION,
      frictionStatic: PIECE_FRICTION_STATIC,
    };
    const a = Bodies.rectangle(0, 0, len, t, partOpts);
    const b = Bodies.rectangle(-len / 2 + t / 2, -len / 2 + t / 2, t, len, partOpts);
    body = Body.create({ parts: [a, b], ...opts });
  }

  // fromVertices / compound bodies re-center the body on its centroid; force local origin so the
  // stored/streamed geometry is always centroid-relative.
  Body.setPosition(body, { x: 0, y: 0 });

  const eyeR = 8 + 3 * s;
  const spread = 12 * s;
  const eyes: Eye[] = [
    { x: -spread, y: -6 * s, r: eyeR },
    { x: spread, y: -6 * s, r: eyeR },
  ];
  const spinSeed = (rng.next() < 0.5 ? -1 : 1) * rng.range(0.015, 0.03);

  return { body, skin, eyes, spinSeed };
}

/**
 * The piece for a given (seed, pieceIndex), deterministically. The piece stream is keyed on the
 * base seed + the monotonic piece index, so startRound, collectMove (legality), and the aim preview
 * all produce the *same* piece for a given index without persisting the seed's live generator.
 */
export function pieceForIndex(seed: number, pieceIndex: number): GeneratedPiece {
  const rng = createRng(deriveSeed(seed, pieceIndex));
  return makePiece(rng);
}

/** Snapshot a generated piece into the compact stored form persisted in scratch. */
export function storedPieceFrom(id: number, piece: GeneratedPiece): StoredPiece {
  return {
    id,
    verts: localVerts(piece.body),
    eyes: piece.eyes,
    skin: piece.skin,
    spinSeed: piece.spinSeed,
  };
}

/** Local-space vertex loops for a body: one loop per non-parent collision part, centroid-relative. */
export function localVerts(body: Matter.Body): Vec2[][] {
  const parts = body.parts.length > 1 ? body.parts.slice(1) : body.parts;
  const cx = body.position.x;
  const cy = body.position.y;
  return parts.map((part) => part.vertices.map((v) => ({ x: v.x - cx, y: v.y - cy })));
}

/** Build the streamable Piece payload (local geometry + spawn) from a stored aim piece. */
export function toPiecePayload(piece: StoredPiece): Piece {
  return {
    id: piece.id,
    verts: piece.verts,
    eyes: piece.eyes,
    skin: piece.skin,
    x: CENTER_X,
    y: GROUND_TOP - SPAWN_Y,
    spinSeed: piece.spinSeed,
  };
}

// ---------------------------------------------------------------------------
// The live world: a continuously-running matter world held in process
// ---------------------------------------------------------------------------

/** A placed dynamic body plus the cosmetics + local geometry the snapshot streams. */
interface Placed {
  body: Matter.Body;
  id: number;
  skin: Skin;
  eyes: Eye[];
  verts: Vec2[][];
}

/**
 * A live, continuously-running Teeter world. The engine steps it every tick (no matter Runner or
 * Render - we drive `Engine.update` ourselves), so it can be serialized to scratch and rebuilt after
 * a reconnect. All progression state (level, scores, piece index, seed) rides on the world.
 */
export interface LiveWorld {
  engine: Matter.Engine;
  platform: Matter.Body;
  placed: Placed[];
  pendulum: Matter.Body | null;
  pendulumPhase: number;
  /** Current internal level index (0-2). */
  levelIndex: number;
  /** Best height reached this level (px above the platform) - the per-level scoring basis. */
  bestHeight: number;
  /** Cumulative game score across levels (never resets; the HUD + standings read it). */
  totalScore: number;
  /** Monotonic index of the NEXT piece to spawn (also the next body id). */
  pieceIndex: number;
  /** The base seed the piece stream keys on. */
  seed: number;
  /** The current aim piece (local geometry + cosmetics), or null once the game is over. */
  next: StoredPiece | null;
  /** True once the final level cleared - the game is over and the world stops stepping. */
  over: boolean;
}

/** Rebuild a matter body from stored local vertex loops at a world transform. */
function bodyFromStored(verts: Vec2[][], x: number, y: number, angle: number): Matter.Body {
  const opts: Matter.IChamferableBodyDefinition = {
    friction: PIECE_FRICTION,
    frictionStatic: PIECE_FRICTION_STATIC,
    frictionAir: PIECE_FRICTION_AIR,
    restitution: 0,
    density: PIECE_DENSITY,
  };
  let body: Matter.Body;
  if (verts.length === 1) {
    const loop = verts[0] ?? [];
    body = Bodies.fromVertices(0, 0, [loop.map((v) => ({ ...v }))], opts);
  } else {
    const parts = verts.map((loop) =>
      Body.create({
        vertices: loop.map((v) => ({ ...v })),
        friction: PIECE_FRICTION,
        frictionStatic: PIECE_FRICTION_STATIC,
      }),
    );
    body = Body.create({ parts, ...opts });
  }
  Body.setPosition(body, { x, y });
  Body.setAngle(body, angle);
  return body;
}

/** Create the static platform (matching the prototype's grip). */
function makePlatform(): Matter.Body {
  const platform = Bodies.rectangle(CENTER_X, GROUND_TOP + PLATFORM_H / 2, PLATFORM_W, PLATFORM_H, {
    isStatic: true,
  });
  platform.friction = PIECE_FRICTION;
  platform.frictionStatic = PIECE_FRICTION_STATIC;
  return platform;
}

/** Add the level-3 pendulum (a driven wrecking ball) to the world. Returns the bob body. */
function addPendulum(engine: Matter.Engine, target: number): Matter.Body {
  const pivot: Vec2 = { x: 520, y: GROUND_TOP - target + 10 };
  const rodLen = GROUND_TOP - target * 0.5 - pivot.y;
  const bob = Bodies.circle(pivot.x + 140, pivot.y + rodLen * 0.7, 34, {
    density: 0.02,
    frictionAir: 0.002,
    friction: 0.4,
    restitution: 0.3,
  });
  const rod = Constraint.create({ pointA: pivot, bodyB: bob, length: rodLen, stiffness: 1 });
  Composite.add(engine.world, [bob, rod]);
  return bob;
}

/** A fresh matter engine with gravity + solver iterations identical to the prototype. */
function makeEngine(): Matter.Engine {
  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  return engine;
}

/**
 * Create a fresh live world for a level: a new engine, the static platform, the level's pendulum
 * (when present), and the placed bodies rebuilt from `bodies` (dynamic, at their world transforms).
 * Used both to start a level (empty `bodies`) and to rebuild a world from a scratch snapshot.
 */
export function createWorld(args: {
  seed: number;
  levelIndex: number;
  bestHeight: number;
  totalScore: number;
  pieceIndex: number;
  bodies: StoredBody[];
  next: StoredPiece | null;
  over?: boolean;
  target: number;
  pendulum: boolean;
}): LiveWorld {
  const engine = makeEngine();
  const platform = makePlatform();
  Composite.add(engine.world, platform);

  const placed: Placed[] = args.bodies.map((b) => {
    const body = bodyFromStored(b.verts, b.x, b.y, b.angle);
    // Restore persisted per-body velocity so a rebuilt tower resumes motion instead of re-settling
    // from rest (spec 0044). Legacy snapshots without velocity default to 0 (rest), as before.
    Body.setVelocity(body, { x: b.vx ?? 0, y: b.vy ?? 0 });
    Body.setAngularVelocity(body, b.angularVelocity ?? 0);
    Composite.add(engine.world, body);
    return { body, id: b.id, skin: b.skin, eyes: b.eyes, verts: b.verts };
  });

  const pendulum = args.pendulum ? addPendulum(engine, args.target) : null;

  return {
    engine,
    platform,
    placed,
    pendulum,
    pendulumPhase: 0,
    levelIndex: args.levelIndex,
    bestHeight: args.bestHeight,
    totalScore: args.totalScore,
    pieceIndex: args.pieceIndex,
    seed: args.seed,
    next: args.next,
    over: args.over ?? false,
  };
}

/**
 * Add a dropped piece into the live world as a DYNAMIC body at `{ x, y, angle }`. The caller has
 * already validated legality; this just introduces the body so gravity carries it onto the tower.
 * Returns the placed body's id.
 */
export function addPieceToWorld(
  world: LiveWorld,
  piece: StoredPiece,
  x: number,
  y: number,
  angle: number,
): number {
  const body = bodyFromStored(piece.verts, x, y, angle);
  Body.setVelocity(body, { x: 0, y: 0 });
  Body.setAngularVelocity(body, 0);
  Composite.add(world.engine.world, body);
  world.placed.push({
    body,
    id: piece.id,
    skin: piece.skin,
    eyes: piece.eyes,
    verts: piece.verts,
  });
  return piece.id;
}

/**
 * Step the live world one engine tick: cap fall speed on placed bodies, drive the pendulum, advance
 * the solver a couple of fixed substeps, then cull any body that fell past DEATH_Y. Real-time and
 * frame-rate independent (fixed dt), so a slow tick never destabilizes the solver.
 */
export function stepWorld(world: LiveWorld): void {
  for (let i = 0; i < SUBSTEPS_PER_TICK; i++) {
    // Cap fall speed so a dropped piece lands soft instead of slamming the tower sideways.
    for (const p of world.placed) {
      if (p.body.velocity.y > MAX_FALL_SPEED) {
        Body.setVelocity(p.body, { x: p.body.velocity.x, y: MAX_FALL_SPEED });
      }
    }
    // Drive the pendulum (so it never dies out), matching the prototype.
    if (world.pendulum) {
      world.pendulumPhase += 0.02;
      const f = 0.00042 * world.pendulum.mass * Math.sin(world.pendulumPhase);
      Body.applyForce(world.pendulum, world.pendulum.position, { x: f, y: 0 });
    }
    Engine.update(world.engine, STEP_MS);
  }

  // Cull bodies that tumbled off the bottom.
  for (let i = world.placed.length - 1; i >= 0; i--) {
    const p = world.placed[i];
    if (p && p.body.position.y > DEATH_Y) {
      Composite.remove(world.engine.world, p.body);
      world.placed.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Legality (ported from overlapsScene / requiredDropHeight / evaluatePlacement)
// ---------------------------------------------------------------------------

/** Does the held body geometrically overlap the platform, tower, or pendulum? */
export function overlapsScene(
  body: Matter.Body,
  platform: Matter.Body,
  placed: Matter.Body[],
  pendulum: Matter.Body | null,
): boolean {
  const others = [platform, ...placed];
  if (pendulum) others.push(pendulum);
  const hits = Query.collides(body, others);
  return hits.some((h) => h.depth > 2);
}

/** The current tower height in px above the platform top (0 when empty). */
export function worldHeight(world: LiveWorld): number {
  let top = GROUND_TOP;
  for (const p of world.placed) top = Math.min(top, p.body.bounds.min.y);
  return Math.max(0, Math.round(GROUND_TOP - top));
}

/**
 * The min-drop line: a piece must be dropped fully above the next unmet 25%-of-target line above
 * the current tower height. Returns that line's height (px above the platform), or null once every
 * line is cleared. Ported verbatim from the prototype, keyed on the tower's current highest point.
 */
export function requiredDropHeight(target: number, height: number): number | null {
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const line = f * target;
    if (line > height + 0.5) return line;
  }
  return null;
}

/** Verdict for a placement: `ok`, or a reason (`overlap` | `line`) it is illegal. */
export interface PlacementVerdict {
  ok: boolean;
  reason: 'overlap' | 'line' | null;
}

/**
 * Evaluate whether the held body may be dropped where it sits: it must be clear of everything AND
 * (if a line is unmet) fully above the required point line. Ported from evaluatePlacement.
 */
export function evaluatePlacement(
  body: Matter.Body,
  target: number,
  height: number,
  platform: Matter.Body,
  placed: Matter.Body[],
  pendulum: Matter.Body | null,
): PlacementVerdict {
  const reqH = requiredDropHeight(target, height);
  const lineY = reqH == null ? null : GROUND_TOP - reqH;
  if (overlapsScene(body, platform, placed, pendulum)) return { ok: false, reason: 'overlap' };
  if (lineY != null && body.bounds.max.y > lineY) return { ok: false, reason: 'line' };
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Scoring (ported from heightToScore)
// ---------------------------------------------------------------------------

/** Height -> score: 0/25/50/75/100 bands, ported from the prototype. */
export function heightToScore(height: number, target: number): number {
  const frac = height / target;
  return Math.max(0, Math.min(100, Math.floor(frac * 4) * 25));
}

// ---------------------------------------------------------------------------
// Drop geometry + legality helpers
// ---------------------------------------------------------------------------

/** Clamp a drop x to the legal horizontal range around center (mirrors the prototype's aiming). */
export function clampDropX(x: number): number {
  return Math.max(CENTER_X - DROP_HALF_RANGE, Math.min(CENTER_X + DROP_HALF_RANGE, x));
}

/**
 * Hard cap on placed bodies in one world (spec 0044). v1 has no lose state, so `world.placed` could
 * otherwise grow unbounded (a player spamming legal drops) and swell the sim/snapshot without bound.
 * 60 comfortably exceeds the summed level piece budgets (11+20+22=53), so it never bites normal play
 * while still bounding the worst case.
 */
export const MAX_PLACED_BODIES = 60;

/**
 * Clamp a drop y to the world's legal vertical range: finite, never below the platform view
 * (`GROUND_TOP`) and never above a generous ceiling well past the tallest target. Mirrors clampDropX
 * so a malformed or wildly out-of-range dropY can never reach the solver. y grows downward, so the
 * range runs from the ceiling (small y) to the platform top (large y).
 */
export function clampDropY(y: number): number {
  const ceiling = GROUND_TOP - 2000; // well above the tallest target (620), so it never bites play
  return Math.max(ceiling, Math.min(GROUND_TOP, y));
}

/**
 * Build the held body for a legality check at a given transform, without mutating anything: makes a
 * body from local vertex loops, positioned at the drop origin. Used by collectMove to reject an
 * illegal placement before it is added. `x` is expected pre-clamped.
 */
export function heldBodyAt(verts: Vec2[][], x: number, y: number, angle: number): Matter.Body {
  return bodyFromStored(verts, x, y, angle);
}

// ---------------------------------------------------------------------------
// Payload builders (turn the live world into the streamable TeeterSim)
// ---------------------------------------------------------------------------

/** Convert the live world's placed bodies into the world-space Body[] the snapshot streams. */
export function toBodyPayloads(world: LiveWorld): BodyPayload[] {
  return world.placed.map((p) => ({
    id: p.id,
    verts: p.verts,
    x: round2(p.body.position.x),
    y: round2(p.body.position.y),
    angle: round4(p.body.angle),
    skin: p.skin,
    eyes: p.eyes,
  }));
}

/** Snapshot the live world's placed bodies into the compact stored form persisted in scratch. */
export function toStoredBodies(world: LiveWorld): StoredBody[] {
  return world.placed.map((p) => ({
    id: p.id,
    verts: p.verts,
    x: round2(p.body.position.x),
    y: round2(p.body.position.y),
    angle: round4(p.body.angle),
    // Persist per-body velocity so a rebuild resumes the tower's live motion (spec 0044).
    vx: round4(p.body.velocity.x),
    vy: round4(p.body.velocity.y),
    angularVelocity: round4(p.body.angularVelocity),
    skin: p.skin,
    eyes: p.eyes,
  }));
}

// Keep floats compact + stable on the wire (avoids float jitter bloating the snapshot).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
