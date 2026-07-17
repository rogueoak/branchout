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
  dropHalfRangeForWidth,
  FLOOR_FRICTION_STATIC,
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
  WALL_HEIGHT,
  WALL_THICKNESS,
} from './levels';
import type { Body as BodyPayload, Eye, Piece, Skin, TeeterPhase, Vec2 } from './types';

const { Bodies, Body, Common, Composite, Constraint, Engine, Query, Vertices } = Matter;

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
  /**
   * The body's density, persisted so the heavy trapezoid (4x, `TRAP_DENSITY_MULT`) keeps its weight
   * across a rebuild-from-snapshot. Absent on a legacy snapshot -> the default `PIECE_DENSITY`.
   */
  density?: number;
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
  /** The piece's density (4x for the heavy trapezoid), so a dropped piece keeps its weight. */
  density?: number;
}

// ---------------------------------------------------------------------------
// Deterministic piece generation (ported from the prototype's makePiece)
// ---------------------------------------------------------------------------

export type PieceType =
  'block' | 'plank' | 'ell' | 'blob' | 'tri' | 'trap' | 'notchSide' | 'notchBottom';
// The type mix (feedback 0032). Blocks + planks (the reliable, easy-to-stack pieces) dominate; the
// HARD shapes (`ell`, `blob`, `tri`) drop to one slot each so they show up occasionally, not on a
// large share of drops (item 6). `trap` is the SPECIAL heavy reinforcement piece - one slot, placed
// deliberately to anchor a wall. Two new concave "notch" pieces (item 2) get one slot each: a
// side-notch block (interlocks sideways) and a bottom-notch block (two feet + a concave apex).
const TYPE_BAG: readonly PieceType[] = [
  'block',
  'block',
  'block',
  'plank',
  'plank',
  'plank',
  'notchSide',
  'notchBottom',
  'trap',
  'ell',
  'blob',
  'tri',
];

/** The heavy trapezoid's density multiplier vs a normal piece (5x heavier - reinforcement). */
export const TRAP_DENSITY_MULT = 5;

/**
 * A placed body counts toward the tower height only once it is (near) at rest: linear speed below
 * `SETTLE_SPEED` and angular speed below `SETTLE_ANGULAR` (feedback 0025). A piece under gravity
 * (`gravity.y = 1`) picks up ~0.28 speed after a single step, so a still-falling piece is well above
 * `SETTLE_SPEED` and never counts at its airborne release height; a resting piece sits near 0.
 */
export const SETTLE_SPEED = 0.16;
export const SETTLE_ANGULAR = 0.12;

/**
 * Max ticks to wait for the tower to settle before offering the next piece (feedback 0027) - the pause
 * between pieces. Normally the scene settles well within this; the cap only bites a never-resting scene
 * (e.g. the pendulum perpetually nudging the tower) so it can't withhold the next piece forever. At
 * TICK_MS (~40ms) this is ~2s.
 */
export const MAX_SETTLE_TICKS = 50;

/**
 * Round-transition beat lengths (feedback 0032). The engine ticks at ~40ms (spec 0044), so these are
 * countdowns in ticks. On clearing a non-final round the world holds the settled tower in `'complete'`
 * for `COMPLETE_TICKS` (~1.6s) - the client paints "Complete!" - then plays `'intro'` for
 * `INTRO_TICKS` (~1.2s) over the fresh empty tower - the client paints "Round X" - before resuming
 * play. Perceivable pauses that hold the sim + gate the next input, so they are server-authoritative.
 */
export const COMPLETE_TICKS = 40;
export const INTRO_TICKS = 30;
/** The heavy trapezoid's cosmetics: near-black with a faint outline so it reads on the dark sky. */
const TRAP_SKIN: Skin = { fill: '#0e0e16', stroke: '#4a4a5c' };

/** A generated piece: a matter body plus its cosmetics, all in local space (centered at origin). */
export interface GeneratedPiece {
  body: Matter.Body;
  skin: Skin;
  eyes: Eye[];
  /** The prototype's spin seed (a signed rotation speed) the renderer uses to spin the piece. */
  spinSeed: number;
  /**
   * The shape family this piece was drawn from (feedback 0032). Not persisted or streamed (the wire
   * carries geometry, not type); exposed so tests can assert the bag mix + that both notch pieces
   * appear, since the decomposed geometry alone cannot tell a notch from a blob.
   */
  type: PieceType;
}

/**
 * Build a piece body centered at the origin, deterministically from `rng`. Mirrors the prototype's
 * makePiece shape mix and jitter exactly, so a given seed always yields the same shape. The body is
 * created dynamic-but-inert here; callers place it into the world as needed.
 */
export function makePiece(rng: SeededRng): GeneratedPiece {
  let skin = rng.pick(PALETTE);
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
  } else if (type === 'trap') {
    // The special heavy trapezoid: a wide base narrowing to the top (a stable footing to build a
    // wall on), 4x denser than a normal piece so it anchors the stack. Single convex body, so it
    // round-trips cleanly. Always near-black with the white googly eyes for contrast.
    const wb = rng.range(96, 128) * s; // bottom (wide)
    const wt = wb * rng.range(0.5, 0.62); // top (narrow)
    const h = rng.range(46, 60) * s;
    const verts: Vec2[] = [
      { x: -wb / 2, y: h / 2 },
      { x: wb / 2, y: h / 2 },
      { x: wt / 2, y: -h / 2 },
      { x: -wt / 2, y: -h / 2 },
    ];
    body = Bodies.fromVertices(0, 0, [verts], {
      ...opts,
      density: PIECE_DENSITY * TRAP_DENSITY_MULT,
    });
    skin = TRAP_SKIN;
  } else if (type === 'notchSide') {
    // A rectangle with a rectangular notch cut into its RIGHT edge (feedback 0032): one internal
    // (concave) angle, a flat bottom so it rests stably and interlocks sideways. A single concave
    // polygon via `Bodies.fromVertices` (poly-decomp already wired, like `blob`), so it decomposes
    // into convex parts and round-trips through the stored-body snapshot the same way `blob` does.
    // Vertices are LOCAL, y-down, wound counter-clockwise like `trap`.
    const w = rng.range(70, 96) * s;
    const h = rng.range(58, 78) * s;
    // Bigger cut-out (feedback 0032 follow-up): a taller, deeper wedge so the concave notch reads
    // clearly. `nd` caps below w/2 so the inner vertex stays within the body's right half.
    const nh = h * rng.range(0.42, 0.56); // notch height (fraction of the edge)
    const nd = w * rng.range(0.4, 0.5); // notch depth (into the body from the right edge)
    const verts: Vec2[] = [
      { x: -w / 2, y: -h / 2 }, // top-left
      { x: w / 2, y: -h / 2 }, // top-right
      { x: w / 2, y: -nh / 2 }, // notch-top (right edge)
      { x: w / 2 - nd, y: 0 }, // notch-inner (the concave vertex)
      { x: w / 2, y: nh / 2 }, // notch-bottom (right edge)
      { x: w / 2, y: h / 2 }, // bottom-right
      { x: -w / 2, y: h / 2 }, // bottom-left
    ];
    body = Bodies.fromVertices(0, 0, [verts], opts);
  } else if (type === 'notchBottom') {
    // A rectangle with a V-notch cut UP into its BOTTOM edge (feedback 0032): two feet + one concave
    // apex, a touch trickier to seat. Single concave polygon via `Bodies.fromVertices` (like `blob`),
    // so it decomposes into convex parts and round-trips through the snapshot as compound loops.
    // Vertices are LOCAL, y-down, wound counter-clockwise like `trap`.
    const w = rng.range(70, 96) * s;
    const h = rng.range(58, 78) * s;
    // Bigger cut-out (feedback 0032 follow-up): a wider, deeper V so the concave notch reads clearly.
    // `nd` caps below h/2 so the apex stays within the body's lower half.
    const nw = w * rng.range(0.42, 0.56); // notch width across the bottom edge
    const nd = h * rng.range(0.42, 0.54); // notch depth (up into the body)
    const verts: Vec2[] = [
      { x: -w / 2, y: h / 2 }, // bottom-left
      { x: -nw / 2, y: h / 2 }, // notch-left (start of the V)
      { x: 0, y: h / 2 - nd }, // notch-apex (the concave vertex)
      { x: nw / 2, y: h / 2 }, // notch-right (end of the V)
      { x: w / 2, y: h / 2 }, // bottom-right
      { x: w / 2, y: -h / 2 }, // top-right
      { x: -w / 2, y: -h / 2 }, // top-left
    ];
    body = Bodies.fromVertices(0, 0, [verts], opts);
  } else {
    // "ell" - a compound L shape. The parts carry the SAME physics as a single-body piece
    // (`restitution: 0` so it never bounces, and `density: PIECE_DENSITY` so the compound's mass is
    // computed from the parts at the right density - not matter's default, which left the L too
    // light and prone to sliding/flipping on landing). Grip (friction/frictionStatic) matches too.
    const t = rng.range(28, 36) * s;
    const len = rng.range(78, 104) * s;
    const partOpts: Matter.IChamferableBodyDefinition = {
      friction: PIECE_FRICTION,
      frictionStatic: PIECE_FRICTION_STATIC,
      restitution: 0,
      density: PIECE_DENSITY,
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

  return { body, skin, eyes, spinSeed, type };
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
    density: piece.body.density,
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
  /** The level's static side walls (level 1 only) - included in collisions + overlap checks. */
  walls: Matter.Body[];
  /** The current level's platform width (px) - the horizontal drop clamp derives from it. */
  platformWidth: number;
  placed: Placed[];
  pendulum: Matter.Body | null;
  pendulumPhase: number;
  /** Current internal level index (0-2). */
  levelIndex: number;
  /**
   * The last SETTLED tower height (px above the platform) - the reported height the tick refreshes only
   * when {@link sceneSettled} holds (feedback 0026). Scoring, level-clear, and the min-drop line read
   * this, not the live {@link worldHeight}, so a falling/tumbling tower does not jump the line.
   */
  stableHeight: number;
  /** Pieces the player has dropped THIS round (resets each level) - drives the over-par penalty. */
  piecesThisLevel: number;
  /**
   * Ticks elapsed since the last drop while waiting for the tower to settle before offering the next
   * piece (feedback 0027). In-memory only (a rebuild resets it); the tick offers the next piece once
   * the scene settles OR this hits a cap, so a never-resting scene can't withhold the next piece forever.
   */
  settleWaitTicks: number;
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
  /**
   * The round-transition phase (feedback 0032): `'playing'` during play, `'complete'` during the
   * post-clear beat (holding the settled tower, next piece withheld), `'intro'` during the "Round X"
   * beat over the fresh tower. Persisted in scratch so a reconnect mid-transition shows the right
   * banner; streamed on `TeeterSim.phase`.
   */
  phase: TeeterPhase;
  /** Ticks remaining in the current `'complete'`/`'intro'` beat (0 while `'playing'`). */
  phaseTicks: number;
}

/** Rebuild a matter body from stored local vertex loops at a world transform. */
function bodyFromStored(
  verts: Vec2[][],
  x: number,
  y: number,
  angle: number,
  density: number = PIECE_DENSITY,
): Matter.Body {
  const opts: Matter.IChamferableBodyDefinition = {
    friction: PIECE_FRICTION,
    frictionStatic: PIECE_FRICTION_STATIC,
    frictionAir: PIECE_FRICTION_AIR,
    restitution: 0,
    density,
  };
  let body: Matter.Body;
  if (verts.length === 1) {
    const loop = verts[0] ?? [];
    body = Bodies.fromVertices(0, 0, [loop.map((v) => ({ ...v }))], opts);
  } else {
    // Compound (e.g. the "ell"): each part's loop carries its OWN offset from the compound centroid.
    // Matter's setVertices re-centres a part's vertices on the part's origin, so we must position each
    // part at its loop's CENTROID; otherwise every part collapses onto (0,0) and the arms overlap - the
    // collision shape would then drift from the drawn shape (spec 0023). Positioning at the centroid and
    // passing the centroid-relative vertices reconstructs the arrangement faithfully.
    const parts = verts.map((loop) => {
      const pts = loop.map((v) => ({ ...v }));
      const c = Vertices.centre(pts);
      return Body.create({
        position: c,
        vertices: pts,
        friction: PIECE_FRICTION,
        frictionStatic: PIECE_FRICTION_STATIC,
      });
    });
    // `density` (via opts) applies at the COMPOUND level, not per-part. Fine today: the only heavy piece
    // (the trapezoid) is single-body, so this branch always runs at PIECE_DENSITY. A future compound
    // heavy piece would need per-part density here to restore its exact mass distribution.
    body = Body.create({ parts, ...opts });
  }
  Body.setPosition(body, { x, y });
  Body.setAngle(body, angle);
  return body;
}

/** Create the static platform at a given width (matching the prototype's grip). */
function makePlatform(platformWidth: number): Matter.Body {
  const platform = Bodies.rectangle(
    CENTER_X,
    GROUND_TOP + PLATFORM_H / 2,
    platformWidth,
    PLATFORM_H,
    { isStatic: true },
  );
  platform.friction = PIECE_FRICTION;
  // Floor-only static grip (feedback 0032): a much higher static friction pins a settled base row to
  // the platform (combined by `max` on the pair), leaving piece-on-piece grip untouched.
  platform.frictionStatic = FLOOR_FRICTION_STATIC;
  return platform;
}

/**
 * Create the short static side walls for a walled (level 1) platform: thin, high-friction curbs at the
 * platform's top-left and top-right edges so a piece resting near the edge cannot slide off. Returns an
 * empty list when the level has no walls.
 */
function makeWalls(platformWidth: number, walls: boolean): Matter.Body[] {
  if (!walls) return [];
  const halfW = platformWidth / 2;
  // Sit each wall on the platform TOP, its inner face flush with the platform edge.
  const wallCY = GROUND_TOP - WALL_HEIGHT / 2;
  const leftCX = CENTER_X - halfW + WALL_THICKNESS / 2;
  const rightCX = CENTER_X + halfW - WALL_THICKNESS / 2;
  return [leftCX, rightCX].map((cx) => {
    const wall = Bodies.rectangle(cx, wallCY, WALL_THICKNESS, WALL_HEIGHT, { isStatic: true });
    wall.friction = PIECE_FRICTION;
    // Floor-only static grip (feedback 0032): match the platform's high static friction so a piece
    // resting against a curb is gripped, not slowly slid off, without changing piece-on-piece grip.
    wall.frictionStatic = FLOOR_FRICTION_STATIC;
    return wall;
  });
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
  stableHeight: number;
  piecesThisLevel: number;
  totalScore: number;
  pieceIndex: number;
  bodies: StoredBody[];
  next: StoredPiece | null;
  over?: boolean;
  target: number;
  pendulum: boolean;
  /** The level's platform width (px). The horizontal drop clamp derives from it. */
  platformWidth: number;
  /** Whether the level's platform has short static side walls (level 1 only). */
  walls: boolean;
  /** The round-transition phase (feedback 0032); defaults to `'playing'`. */
  phase?: TeeterPhase;
  /** Ticks remaining in the current transition beat (feedback 0032); defaults to 0. */
  phaseTicks?: number;
}): LiveWorld {
  const engine = makeEngine();
  const platform = makePlatform(args.platformWidth);
  Composite.add(engine.world, platform);
  const walls = makeWalls(args.platformWidth, args.walls);
  for (const wall of walls) Composite.add(engine.world, wall);

  const placed: Placed[] = args.bodies.map((b) => {
    const body = bodyFromStored(b.verts, b.x, b.y, b.angle, b.density ?? PIECE_DENSITY);
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
    walls,
    platformWidth: args.platformWidth,
    placed,
    pendulum,
    pendulumPhase: 0,
    levelIndex: args.levelIndex,
    stableHeight: args.stableHeight,
    piecesThisLevel: args.piecesThisLevel,
    // In-memory only (feedback 0027): the between-piece settle wait starts fresh on a (re)build.
    settleWaitTicks: 0,
    bestHeight: args.bestHeight,
    totalScore: args.totalScore,
    pieceIndex: args.pieceIndex,
    seed: args.seed,
    next: args.next,
    over: args.over ?? false,
    // Round-transition beat (feedback 0032): defaults to normal play, so a fresh world / a legacy
    // snapshot without a phase comes back `'playing'` with no pending countdown.
    phase: args.phase ?? 'playing',
    phaseTicks: args.phaseTicks ?? 0,
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
  const body = bodyFromStored(piece.verts, x, y, angle, piece.density ?? PIECE_DENSITY);
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

/** Does the held body geometrically overlap the platform, side walls, tower, or pendulum? */
export function overlapsScene(
  body: Matter.Body,
  platform: Matter.Body,
  placed: Matter.Body[],
  pendulum: Matter.Body | null,
  walls: Matter.Body[] = [],
): boolean {
  const others = [platform, ...walls, ...placed];
  if (pendulum) others.push(pendulum);
  const hits = Query.collides(body, others);
  return hits.some((h) => h.depth > 2);
}

/**
 * The current RAW tower height in px above the platform top (0 when empty) - the topmost point of any
 * placed body right now, moving or not. The reported height that drives scoring/level-clear/the min-drop
 * line is NOT this: it is the world's `stableHeight`, which the tick only refreshes to this value when
 * the whole scene is at rest (see {@link sceneSettled} + feedback 0026), so a falling or tumbling tower
 * never jumps the reported height / line.
 */
export function worldHeight(world: LiveWorld): number {
  let top = GROUND_TOP;
  for (const p of world.placed) top = Math.min(top, p.body.bounds.min.y);
  return Math.max(0, Math.round(GROUND_TOP - top));
}

/**
 * Whether the scene has stabilized: every placed body is (near) at rest (linear + angular speed below
 * the settle thresholds). The tick only refreshes the reported `stableHeight` when this holds, so height
 * / score / level-clear / the min-drop line all wait for the tower to settle instead of reacting to a
 * piece mid-flight or a tumble (feedback 0026). Empty scene = settled. A just-dropped body has been
 * stepped once under gravity before this is checked, so it reads as moving (not falsely settled high).
 */
export function sceneSettled(world: LiveWorld): boolean {
  return world.placed.every(
    (p) => p.body.speed < SETTLE_SPEED && p.body.angularSpeed < SETTLE_ANGULAR,
  );
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

/**
 * The min-drop line as a world-y (the bottom of a dropped piece must sit above it), or null once every
 * line is cleared. Centralizes the `requiredDropHeight -> GROUND_TOP - reqH` mapping so `collectMove`'s
 * drop-at-line clamp and `evaluatePlacement`'s line check derive the same world-y (architect review of
 * PR #94). y grows downward, so a legal drop has its lowest point at `y < lineY`.
 */
export function lineYFor(target: number, height: number): number | null {
  const reqH = requiredDropHeight(target, height);
  return reqH == null ? null : GROUND_TOP - reqH;
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
  walls: Matter.Body[] = [],
): PlacementVerdict {
  const lineY = lineYFor(target, height);
  if (overlapsScene(body, platform, placed, pendulum, walls))
    return { ok: false, reason: 'overlap' };
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

/**
 * Clamp a drop x to the legal horizontal range around center for a given platform width. The half-range
 * derives from the level's platform (half its width plus the edge margin), so a wider level-1 platform
 * lets a drop reach across it while a narrower level keeps the tighter range.
 */
export function clampDropX(x: number, platformWidth: number = PLATFORM_W): number {
  const half = dropHalfRangeForWidth(platformWidth);
  return Math.max(CENTER_X - half, Math.min(CENTER_X + half, x));
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

/**
 * Clamp a held body's centroid y UP so its bottom rests just above the min-drop line (feedback 0032).
 * The below-line drop is no longer blocked - the piece is just dropped AT line height. Given the held
 * body's current bottom (`body.bounds.max.y`) and the line world-y `lineY`, returns the adjusted
 * centroid y: unchanged when the body already sits above the line, else shifted up by
 * `(bottom - lineY + margin)` so the new bottom is a hair above the line. Clamping UP moves the piece
 * AWAY from the tower, so it can never introduce an overlap the caller's overlap check would miss.
 * `lineY == null` (all lines cleared) leaves y untouched.
 */
export function clampDropYToLine(body: Matter.Body, lineY: number | null): number {
  const cy = body.position.y;
  if (lineY == null || body.bounds.max.y <= lineY) return cy;
  return cy - (body.bounds.max.y - lineY + 0.5);
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
    density: p.body.density,
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
