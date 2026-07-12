// The headless, deterministic physics core for Teeter Tower. Everything here is a pure function of
// its inputs (a seed for shapes, a stored tower + a move for the settle), so the single server
// simulation is reproducible and clients render exactly what the server computed. No DOM, no
// wall-clock, no Math.random: matter-js supplies the solver; a seeded PRNG supplies the shapes; a
// fixed timestep with a hard step cap bounds the run so it can never hang.

import Matter from 'matter-js';
import type { SeededRng } from './rng';
import {
  CENTER_X,
  DEATH_Y,
  DROP_HALF_RANGE,
  GROUND_TOP,
  LEVELS,
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
import type { Body as BodyPayload, Eye, Frame, Piece, Skin, Vec2 } from './types';

const { Bodies, Body, Composite, Constraint, Engine, Query } = Matter;

// ---------------------------------------------------------------------------
// Fixed-timestep + settle tuning (all deterministic; no wall-clock anywhere)
// ---------------------------------------------------------------------------

/** Fixed physics step, ms. 60 Hz, matching the prototype's runner. */
export const STEP_MS = 1000 / 60;
/** Record a keyframe every K steps (sampling stride) to keep the track compact. */
export const TRACK_EVERY = 3;
/** Hard cap on simulated steps so a pathological drop can never spin forever. */
export const MAX_STEPS = 300;
/** Max body speed under which the tower counts as "calm". */
export const CALM_SPEED = 1.4;
/** Consecutive calm steps required before we stop early (mirrors the prototype's settle > 25). */
export const CALM_STEPS = 26;

// ---------------------------------------------------------------------------
// Persisted tower shape (what the module keeps in scratch between drops)
// ---------------------------------------------------------------------------

/** A settled piece as persisted in scratch: local geometry + world transform + cosmetics. */
export interface StoredBody {
  id: number;
  /** One local-space polygon loop per collision part (compound pieces have several). */
  verts: Vec2[][];
  x: number;
  y: number;
  angle: number;
  skin: Skin;
  eyes: Eye[];
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
 * created dynamic-but-inert here; callers place/freeze it as needed.
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

/** Local-space vertex loops for a body: one loop per non-parent collision part, centroid-relative. */
export function localVerts(body: Matter.Body): Vec2[][] {
  const parts = body.parts.length > 1 ? body.parts.slice(1) : body.parts;
  const cx = body.position.x;
  const cy = body.position.y;
  return parts.map((part) => part.vertices.map((v) => ({ x: v.x - cx, y: v.y - cy })));
}

/** Build the streamable Piece payload (local geometry + spawn) from a generated piece. */
export function toPiecePayload(piece: GeneratedPiece): Piece {
  return {
    verts: localVerts(piece.body),
    eyes: piece.eyes,
    skin: piece.skin,
    x: CENTER_X,
    y: GROUND_TOP - SPAWN_Y,
    spinSeed: piece.spinSeed,
  };
}

// ---------------------------------------------------------------------------
// World assembly (a fresh matter world from stored state, every reveal)
// ---------------------------------------------------------------------------

interface BuiltWorld {
  engine: Matter.Engine;
  platform: Matter.Body;
  placed: Matter.Body[];
  pendulum: Matter.Body | null;
}

/** A live piece to add to the world when simulating a drop: local loops + transform + cosmetics. */
export interface DropPiece {
  id: number;
  verts: Vec2[][];
  eyes: Eye[];
  skin: Skin;
  x: number;
  /** World-y of the piece's centroid at the drop origin. */
  y: number;
  angle: number;
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

/**
 * Assemble a fresh, deterministic matter world: gravity + solver iterations identical to the
 * prototype, the static platform, every stored tower body placed static at its transform, and the
 * pendulum when the level has one. Stored bodies are added STATIC so building the world never
 * perturbs the settled tower; the caller unfreezes them before simulating a drop.
 */
export function buildWorld(tower: StoredBody[], target: number, pendulum: boolean): BuiltWorld {
  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  const platform = makePlatform();
  Composite.add(engine.world, platform);

  const placed = tower.map((b) => {
    const body = bodyFromStored(b.verts, b.x, b.y, b.angle);
    Body.setStatic(body, true);
    return body;
  });
  Composite.add(engine.world, placed);

  const bob = pendulum ? addPendulum(engine, target) : null;
  return { engine, platform, placed, pendulum: bob };
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
export function towerHeight(placed: Matter.Body[]): number {
  let top = GROUND_TOP;
  for (const b of placed) top = Math.min(top, b.bounds.min.y);
  return Math.max(0, Math.round(GROUND_TOP - top));
}

/** The same height measure over stored bodies (used before a world is built). */
export function storedTowerHeight(tower: StoredBody[]): number {
  const world = buildWorld(tower, 0, false);
  return towerHeight(world.placed);
}

/**
 * The min-drop line: a piece must be dropped fully above the next unmet point line above the
 * current tower height. Returns that line's height (px above the platform), or null once every line
 * is cleared. Ported verbatim from the prototype.
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
// The settle simulation (the authoritative drop; records the keyframe track)
// ---------------------------------------------------------------------------

/** The result of simulating one drop: the settle track and the resulting tower + measurements. */
export interface SettleResult {
  track: Frame[];
  tower: StoredBody[];
  height: number;
}

/** Snapshot a live piece's local vertex loops (post-solver) so its stored geometry stays stable. */
function storedFrom(
  body: Matter.Body,
  id: number,
  skin: Skin,
  eyes: Eye[],
  verts: Vec2[][],
): StoredBody {
  return { id, verts, x: body.position.x, y: body.position.y, angle: body.angle, skin, eyes };
}

/**
 * Simulate a drop to settle, deterministically, recording a keyframe track. Rebuilds the world,
 * unfreezes the stored tower, drops `piece` at `{ x, angle }`, then steps at a FIXED timestep -
 * capping fall speed and driving the pendulum exactly like the prototype - until the tower is calm
 * for CALM_STEPS or MAX_STEPS is hit. Fallen bodies (past DEATH_Y) are culled. Returns the settle
 * track plus the new stored tower and height.
 */
export function simulateDrop(
  tower: StoredBody[],
  piece: DropPiece,
  target: number,
  pendulum: boolean,
): SettleResult {
  const world = buildWorld(tower, target, pendulum);
  const { engine, placed } = world;

  // Unfreeze the settled tower so the new piece can interact with it.
  for (const b of placed) Body.setStatic(b, false);

  // Add the dropped piece at its chosen transform.
  const dropBody = bodyFromStored(piece.verts, piece.x, piece.y, piece.angle);
  Body.setVelocity(dropBody, { x: 0, y: 0 });
  Body.setAngularVelocity(dropBody, 0);
  Composite.add(engine.world, dropBody);
  placed.push(dropBody);

  // Cosmetics + local geometry, tracked in parallel with the live bodies for the stored output.
  interface Live {
    body: Matter.Body;
    id: number;
    skin: Skin;
    eyes: Eye[];
    verts: Vec2[][];
  }
  const live: Live[] = tower.map((b, i) => ({
    body: placed[i] as Matter.Body,
    id: b.id,
    skin: b.skin,
    eyes: b.eyes,
    verts: b.verts,
  }));
  live.push({
    body: dropBody,
    id: piece.id,
    skin: piece.skin,
    eyes: piece.eyes,
    verts: piece.verts,
  });

  const track: Frame[] = [];
  let phase = 0;
  let calm = 0;
  let t = 0;

  const recordFrame = (): void => {
    track.push({
      t,
      bodies: live
        .filter((l) => l.body.position.y <= DEATH_Y)
        .map((l) => ({
          id: l.id,
          x: round2(l.body.position.x),
          y: round2(l.body.position.y),
          angle: round4(l.body.angle),
        })),
    });
  };

  recordFrame(); // t=0 opening frame so the client has the drop's starting pose.

  for (let step = 0; step < MAX_STEPS; step++) {
    // Cap fall speed so a dropped piece lands soft instead of slamming the tower sideways.
    for (const l of live) {
      if (l.body.velocity.y > MAX_FALL_SPEED) {
        Body.setVelocity(l.body, { x: l.body.velocity.x, y: MAX_FALL_SPEED });
      }
    }
    // Drive the pendulum (so it never dies out), matching the prototype.
    if (world.pendulum) {
      phase += 0.02;
      const f = 0.00042 * world.pendulum.mass * Math.sin(phase);
      Body.applyForce(world.pendulum, world.pendulum.position, { x: f, y: 0 });
    }

    Engine.update(engine, STEP_MS);
    t += STEP_MS;

    let maxSpeed = 0;
    for (const l of live) maxSpeed = Math.max(maxSpeed, l.body.speed);
    if (maxSpeed < CALM_SPEED) calm++;
    else calm = 0;

    if (step % TRACK_EVERY === 0) recordFrame();

    if (calm >= CALM_STEPS) break;
  }

  recordFrame(); // final resting pose.

  // Cull bodies that tumbled off the bottom, then read the settled tower.
  const survivors = live.filter((l) => l.body.position.y <= DEATH_Y);
  const survivorBodies = survivors.map((l) => l.body);
  const height = towerHeight(survivorBodies);
  const newTower = survivors.map((l) => storedFrom(l.body, l.id, l.skin, l.eyes, l.verts));

  return { track, tower: newTower, height };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/** Convert the stored tower into the world-space Body[] the prompt/reveal streams. */
export function toBodyPayloads(tower: StoredBody[]): BodyPayload[] {
  return tower.map((b) => ({
    id: b.id,
    verts: b.verts,
    x: round2(b.x),
    y: round2(b.y),
    angle: round4(b.angle),
    skin: b.skin,
    eyes: b.eyes,
  }));
}

/** Clamp a drop x to the legal horizontal range around center (mirrors the prototype's aiming). */
export function clampDropX(x: number): number {
  return Math.max(CENTER_X - DROP_HALF_RANGE, Math.min(CENTER_X + DROP_HALF_RANGE, x));
}

/** Margin (px) the piece's bottom is held above the required min-drop line at the drop origin. */
export const DROP_MARGIN = 8;

/**
 * The canonical drop origin (centroid world-y) for a piece at a given angle. The move contract is
 * `{ angle, dropX }` only, so the server picks the height: the piece is released from just above the
 * current required min-drop line (or, once all lines are cleared, just above the tower top), so a
 * straight aim is always legal on the line rule and gravity carries it down onto the tower. Returns
 * a y clamped to at most the spawn line so the piece never starts below the platform view.
 */
export function dropYFor(
  verts: Vec2[][],
  angle: number,
  requiredLine: number | null,
  height: number,
): number {
  // The piece's half-height below its centroid at this angle (how far its bottom hangs down).
  const probe = bodyFromStored(verts, 0, 0, angle);
  const bottomOffset = probe.bounds.max.y; // centroid is at 0, so this is the downward reach.
  // The line the bottom must sit above: the required line, or the tower top once lines are cleared.
  const clearLine = requiredLine ?? height;
  const lineY = GROUND_TOP - clearLine;
  const centroidY = lineY - DROP_MARGIN - bottomOffset;
  // Never start below the normal spawn line (keeps the drop on screen for short towers).
  return Math.min(centroidY, GROUND_TOP - SPAWN_Y);
}

/** A generated piece placed at `{ dropX, dropY, angle }`, ready to feed simulateDrop. */
export function pieceToDrop(
  id: number,
  piece: GeneratedPiece,
  angle: number,
  dropX: number,
  dropY: number,
): DropPiece {
  return {
    id,
    verts: localVerts(piece.body),
    eyes: piece.eyes,
    skin: piece.skin,
    x: clampDropX(dropX),
    y: dropY,
    angle,
  };
}

/**
 * Build the held body for a legality check at a given transform, without mutating anything: makes a
 * body from local vertex loops, positioned at the drop origin. Used by collectMove to reject an
 * illegal placement before it is stored. `x` is expected pre-clamped.
 */
export function heldBodyAt(verts: Vec2[][], x: number, y: number, angle: number): Matter.Body {
  return bodyFromStored(verts, x, y, angle);
}

/** The level for a given level index, clamped to the last level. */
export function levelAt(index: number): (typeof LEVELS)[number] {
  const level = LEVELS[Math.min(index, LEVELS.length - 1)];
  // LEVELS is non-empty; narrow for noUncheckedIndexedAccess.
  return level as (typeof LEVELS)[number];
}

// Keep floats compact + stable on the wire (avoids float jitter bloating the track).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
