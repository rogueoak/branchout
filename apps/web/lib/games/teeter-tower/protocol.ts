// Teeter Tower's live-snapshot decoder for the game-pluggable client (spec 0044, spec 0023). Teeter is
// a LIVE game: the engine steps a continuously-running world and streams a `TeeterSim` on the `sim`
// frame (~25x/sec). The web is a pure renderer that decodes that opaque `unknown` snapshot here at the
// client boundary. A shape the renderer does not understand is a null (a skipped render), never a
// thrown one - the same "opaque payload, the game owns the shape" contract the engine uses. These
// types mirror packages/games/teeter-tower/src/types.ts exactly; a drift here breaks rendering, so
// they stay in lockstep with that authoritative wire contract.

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
 * A body in the live tower, in WORLD space. `verts` is one polygon loop per collision part (a compound
 * piece has several); each loop's points are in the body's LOCAL frame - the renderer places them via
 * `x`/`y`/`angle`. Geometry rides in every `sim` snapshot, so a joiner renders the whole live tower
 * from one frame.
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
 * The piece currently available to aim + drop. Geometry is LOCAL (centered on its own centroid); the
 * client spins it by `spinSeed`, then lets the player choose the drop `angle`, `dropX`, and `dropY`.
 * `x`/`y` is a suggested spawn position in world space.
 */
export interface Piece {
  id: number;
  verts: Vec2[][];
  eyes: Eye[];
  skin: Skin;
  x: number;
  y: number;
  spinSeed: number;
}

/** The move a client submits, as the `move` string: `JSON.stringify({ angle, dropX, dropY })`. */
export interface TeeterMove {
  angle: number;
  dropX: number;
  dropY: number;
}

/**
 * A live snapshot of the whole game, streamed each tick as the `sim` frame. The client REPLACES its
 * state from the newest snapshot and interpolates between two of them for smooth sway.
 */
export interface TeeterSim {
  bodies: Body[];
  /** The piece the active player may aim + drop now, or null when the game is over. */
  next: Piece | null;
  /** Whose turn it is to drop (playerId); the client enables input only when this is the local player. */
  activePlayer: string;
  height: number;
  score: number;
  level: number;
  target: number;
  /**
   * The world-y the piece's bottom must be ABOVE to drop (the next line above the tower). Since y grows
   * downward, a legal drop has its lowest point at `y < requiredLine`. The client draws this line and
   * previews legality; the server is authoritative.
   */
  requiredLine: number;
  /**
   * The current level's platform: its width (px) and whether it has short side walls. The client draws
   * the platform + walls and derives the horizontal drop clamp from this (authoritative), so a
   * per-level platform (level 1 is wider + walled) is honored without a hardcoded width.
   */
  platform: { width: number; walls: boolean };
  /** True once the final level is cleared - the game is over. */
  over: boolean;
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

/** Decode the aim piece, or null on any shape mismatch. */
function asPiece(value: unknown): Piece | null {
  if (!isRecord(value)) return null;
  const verts = asVertLoops(value.verts);
  const skin = asSkin(value.skin);
  const eyes = asEyes(value.eyes);
  if (
    isNum(value.id) &&
    verts &&
    eyes &&
    skin &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNum(value.spinSeed)
  ) {
    return {
      id: value.id,
      verts,
      eyes,
      skin,
      x: value.x,
      y: value.y,
      spinSeed: value.spinSeed,
    };
  }
  return null;
}

/** Decode the platform config `{ width, walls }`, or null on any shape mismatch. */
function asPlatform(value: unknown): { width: number; walls: boolean } | null {
  if (!isRecord(value)) return null;
  return isNum(value.width) && typeof value.walls === 'boolean'
    ? { width: value.width, walls: value.walls }
    : null;
}

/**
 * Decode a `sim` payload as a Teeter live snapshot, or null if it is not one. `bodies` may be empty
 * (a fresh tower) and `next` may be null (the game is over), so those are validated but not required
 * to be non-empty.
 */
export function asTeeterSim(value: unknown): TeeterSim | null {
  if (!isRecord(value)) return null;
  const bodies = asBodies(value.bodies);
  // next is Piece | null: either a decodable piece or an explicit null.
  const next = value.next === null ? null : asPiece(value.next);
  const nextOk = value.next === null || next !== null;
  const platform = asPlatform(value.platform);
  if (
    bodies &&
    nextOk &&
    platform &&
    typeof value.activePlayer === 'string' &&
    isNum(value.height) &&
    isNum(value.score) &&
    isNum(value.level) &&
    isNum(value.target) &&
    isNum(value.requiredLine) &&
    typeof value.over === 'boolean'
  ) {
    return {
      bodies,
      next,
      activePlayer: value.activePlayer,
      height: value.height,
      score: value.score,
      level: value.level,
      target: value.target,
      requiredLine: value.requiredLine,
      platform,
      over: value.over,
    };
  }
  return null;
}
