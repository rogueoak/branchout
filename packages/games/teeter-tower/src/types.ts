// The wire payloads Teeter Tower streams. These are opaque to the engine (it carries them as
// `unknown`); the web renderer decodes them. They are the authoritative contract the web team
// mirrors exactly - a wrong shape here breaks rendering, so they live in one place.

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
 * A settled body in the tower, in WORLD space, so a late joiner renders the whole tower from a
 * single prompt frame. `verts` is one polygon loop per collision part (a compound piece has several);
 * each loop's points are in the body's LOCAL frame - the renderer places them via `x`/`y`/`angle`.
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
 * whether this drop `cleared` the level (advanced the internal level index).
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
