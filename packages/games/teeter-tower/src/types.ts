// The wire payloads Teeter Tower streams. Opaque to the engine (carried as `unknown`); the web
// renderer decodes them. This is the authoritative contract the web mirrors exactly - a wrong shape
// breaks rendering, so it lives in one place. Teeter is a LIVE game (spec 0044): the engine steps a
// continuously-running world and streams a `TeeterSim` snapshot on a fixed cadence, so the client
// renders the live, swaying tower rather than a one-shot settle.

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
 * A body in the tower, in WORLD space. `verts` is one polygon loop per collision part (a compound
 * piece has several); each loop's points are in the body's LOCAL frame - the renderer places them via
 * `x`/`y`/`angle`. Geometry rides in every `sim` snapshot (not just on spawn) so a joiner renders the
 * whole live tower from one frame; the body count is small, so this stays cheap.
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
 * client spins it by `spinSeed` and lets the player choose the drop `angle`, `dropX`, and `dropY`
 * (constrained above `requiredLine`). `x`/`y` is a suggested spawn position in world space.
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
 * A live snapshot of the whole game, streamed each tick as the `sim` frame AND returned by
 * `startRound` as the initial prompt (so a client renders immediately, before the first tick). The
 * client REPLACES its state from the newest snapshot and interpolates between them for smooth sway.
 */
export interface TeeterSim {
  /** The live tower bodies (world transforms + geometry), swaying in real time. */
  bodies: Body[];
  /** The piece the active player may aim + drop now, or null when the game is over. */
  next: Piece | null;
  /** Whose turn it is to drop (playerId); the client enables input only when this is the local player. */
  activePlayer: string;
  /** Current tower height (px above the platform) and cumulative game score. */
  height: number;
  score: number;
  /** Current internal level index and its target height. */
  level: number;
  target: number;
  /**
   * The world-y the piece's bottom must be ABOVE to drop (the next 25%-of-target line measured from
   * the tower's highest point). Since y grows downward, a legal drop has its lowest point at
   * `y < requiredLine`. The client draws this line and previews legality; the server is authoritative.
   */
  requiredLine: number;
  /** True once the final level is cleared - the game is over. */
  over: boolean;
}
