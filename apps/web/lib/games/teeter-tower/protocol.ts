// Teeter Tower's payload decoders for the game-pluggable client (spec 0023, spec 0043). The engine
// carries `prompt`/`reveal` as opaque `unknown` (spec 0007); the browser is a pure renderer that
// decodes them here at the client boundary. A shape the renderer does not understand is a null (a
// skipped render), never a thrown one - the same "opaque payload, the game owns the shape" contract
// the engine uses. These types mirror packages/games/teeter-tower/src/types.ts exactly; a drift here
// breaks rendering, so they stay in lockstep with that authoritative wire contract.

/** A 2D point in the sim's world coordinates (y grows downward; the tower grows up). */
export interface Vec2 {
  x: number;
  y: number;
}

/** A googly eye in a body's local coordinates (relative to its centroid). */
export interface Eye {
  x: number;
  y: number;
  r: number;
}

/** A palette entry: a fill/stroke pair the renderer paints a body with. */
export interface Skin {
  fill: string;
  stroke: string;
}

/**
 * A settled body in the tower, in WORLD space. `verts` is one polygon loop per collision part (a
 * compound piece has several); each loop's points are in the body's LOCAL frame - the renderer
 * places them via `x`/`y`/`angle`.
 */
export interface Body {
  id: number;
  verts: Vec2[][];
  x: number;
  y: number;
  angle: number;
  skin: Skin;
  eyes: Eye[];
}

/**
 * The piece currently being aimed. Geometry is LOCAL (centered on its own centroid); the renderer
 * spins it by `spinSeed` and lets the player choose the drop `angle`/`dropX`. `x`/`y` is its spawn
 * position in world space.
 */
export interface Piece {
  verts: Vec2[][];
  eyes: Eye[];
  skin: Skin;
  x: number;
  y: number;
  spinSeed: number;
}

/** The per-round prompt: the current tower plus the piece to aim. */
export interface TeeterPrompt {
  round: number;
  level: number;
  target: number;
  height: number;
  activePlayer: string;
  tower: Body[];
  piece: Piece;
}

/** The move a client submits, as the `move` string: `JSON.stringify({ angle, dropX })`. */
export interface TeeterMove {
  angle: number;
  dropX: number;
}

/** One recorded animation keyframe: every live body's transform at simulated time `t` (ms). */
export interface Frame {
  t: number;
  bodies: { id: number; x: number; y: number; angle: number }[];
}

/**
 * The per-drop reveal: the settle animation `track` the client plays back, the resulting `tower`
 * (final world-space transforms), the new `height`/`score`, the current `level`/`target`, and
 * whether this drop `cleared` the level.
 */
export interface TeeterReveal {
  track: Frame[];
  tower: Body[];
  height: number;
  score: number;
  level: number;
  target: number;
  cleared: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Decode a single `{ x, y }` point, or null. */
function asVec2(value: unknown): Vec2 | null {
  if (!isRecord(value)) return null;
  return isNum(value.x) && isNum(value.y) ? { x: value.x, y: value.y } : null;
}

/** Decode a list of `{ x, y }` points; returns null if any element is malformed. */
function asVec2Loop(value: unknown): Vec2[] | null {
  if (!Array.isArray(value)) return null;
  const out: Vec2[] = [];
  for (const item of value) {
    const v = asVec2(item);
    if (!v) return null;
    out.push(v);
  }
  return out;
}

/** Decode the compound-shape vertex loops (`Vec2[][]`); returns null on any malformed loop. */
function asVertLoops(value: unknown): Vec2[][] | null {
  if (!Array.isArray(value)) return null;
  const out: Vec2[][] = [];
  for (const loop of value) {
    const decoded = asVec2Loop(loop);
    if (!decoded) return null;
    out.push(decoded);
  }
  return out;
}

/** Decode a `{ fill, stroke }` skin, or null. */
function asSkin(value: unknown): Skin | null {
  if (!isRecord(value)) return null;
  return typeof value.fill === 'string' && typeof value.stroke === 'string'
    ? { fill: value.fill, stroke: value.stroke }
    : null;
}

/** Decode the googly eyes list; returns null if any eye is malformed. */
function asEyes(value: unknown): Eye[] | null {
  if (!Array.isArray(value)) return null;
  const out: Eye[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNum(item.x) || !isNum(item.y) || !isNum(item.r)) return null;
    out.push({ x: item.x, y: item.y, r: item.r });
  }
  return out;
}

/** Decode one world-space tower body, or null on any shape mismatch. */
function asBody(value: unknown): Body | null {
  if (!isRecord(value)) return null;
  const verts = asVertLoops(value.verts);
  const skin = asSkin(value.skin);
  const eyes = asEyes(value.eyes);
  if (
    isNum(value.id) &&
    verts &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNum(value.angle) &&
    skin &&
    eyes
  ) {
    return { id: value.id, verts, x: value.x, y: value.y, angle: value.angle, skin, eyes };
  }
  return null;
}

/** Decode the tower body list; returns null if any body is malformed. */
function asBodies(value: unknown): Body[] | null {
  if (!Array.isArray(value)) return null;
  const out: Body[] = [];
  for (const item of value) {
    const body = asBody(item);
    if (!body) return null;
    out.push(body);
  }
  return out;
}

/** Decode the piece being aimed, or null on any shape mismatch. */
function asPiece(value: unknown): Piece | null {
  if (!isRecord(value)) return null;
  const verts = asVertLoops(value.verts);
  const skin = asSkin(value.skin);
  const eyes = asEyes(value.eyes);
  if (verts && eyes && skin && isNum(value.x) && isNum(value.y) && isNum(value.spinSeed)) {
    return { verts, eyes, skin, x: value.x, y: value.y, spinSeed: value.spinSeed };
  }
  return null;
}

/** Decode one settle keyframe, or null. */
function asFrame(value: unknown): Frame | null {
  if (!isRecord(value) || !isNum(value.t) || !Array.isArray(value.bodies)) return null;
  const bodies: Frame['bodies'] = [];
  for (const item of value.bodies) {
    if (
      !isRecord(item) ||
      !isNum(item.id) ||
      !isNum(item.x) ||
      !isNum(item.y) ||
      !isNum(item.angle)
    ) {
      return null;
    }
    bodies.push({ id: item.id, x: item.x, y: item.y, angle: item.angle });
  }
  return { t: value.t, bodies };
}

/** Decode the settle track; returns null if any frame is malformed. */
function asTrack(value: unknown): Frame[] | null {
  if (!Array.isArray(value)) return null;
  const out: Frame[] = [];
  for (const item of value) {
    const frame = asFrame(item);
    if (!frame) return null;
    out.push(frame);
  }
  return out;
}

/** Decode a `prompt` payload as a Teeter prompt, or null if it is not one. */
export function asTeeterPrompt(value: unknown): TeeterPrompt | null {
  if (!isRecord(value)) return null;
  const tower = asBodies(value.tower);
  const piece = asPiece(value.piece);
  if (
    isNum(value.round) &&
    isNum(value.level) &&
    isNum(value.target) &&
    isNum(value.height) &&
    typeof value.activePlayer === 'string' &&
    tower &&
    piece
  ) {
    return {
      round: value.round,
      level: value.level,
      target: value.target,
      height: value.height,
      activePlayer: value.activePlayer,
      tower,
      piece,
    };
  }
  return null;
}

/** Decode a `reveal` payload as a Teeter reveal, or null if it is not one. */
export function asTeeterReveal(value: unknown): TeeterReveal | null {
  if (!isRecord(value)) return null;
  const track = asTrack(value.track);
  const tower = asBodies(value.tower);
  if (
    track &&
    tower &&
    isNum(value.height) &&
    isNum(value.score) &&
    isNum(value.level) &&
    isNum(value.target) &&
    typeof value.cleared === 'boolean'
  ) {
    return {
      track,
      tower,
      height: value.height,
      score: value.score,
      level: value.level,
      target: value.target,
      cleared: value.cleared,
    };
  }
  return null;
}

/** The most recent Teeter reveal in the round's streamed reveals, or null. */
export function pickTeeterReveal(reveals: readonly unknown[]): TeeterReveal | null {
  for (let i = reveals.length - 1; i >= 0; i--) {
    const decoded = asTeeterReveal(reveals[i]);
    if (decoded) return decoded;
  }
  return null;
}
