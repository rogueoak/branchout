// The Sketchy sketch stroke format (spec 0063): a compact, serializable vector drawing captured on a
// canvas and replayed read-only in the viewer. A sketch is an array of strokes; each stroke is a
// color plus a flat array of integer point coordinates `[x0, y0, x1, y1, ...]` on a fixed logical
// canvas (0..CANVAS_SIZE on each axis), so the format is resolution-independent and small. The move
// channel carries the sketch as a JSON string; the engine parses + bounds it (so a submission can
// never be unbounded) and the web replays it by scaling the logical coordinates to the rendered size.
//
// Kept deliberately minimal: no pressure, no timing, no bezier smoothing - a straight polyline per
// stroke is enough to read a doodle and is trivial to round-trip and to unit test.

import { ALL_PALETTE_COLORS } from '@branchout/protocol';

/** The fixed logical extent of the drawing surface on each axis. Points are clamped to [0, SIZE]. */
export const CANVAS_SIZE = 1000;

/** Bounds so a submitted sketch can never be unbounded (a hostile or runaway client is capped). */
export const MAX_STROKES = 400;
export const MAX_POINTS_PER_STROKE = 1000;
export const MAX_TOTAL_POINTS = 20_000;

/** One stroke: a color and a flat `[x0, y0, x1, y1, ...]` array of integer logical coordinates. */
export interface Stroke {
  color: string;
  points: number[];
}

/** A whole sketch: the ordered strokes that make up one drawing. */
export interface Sketch {
  strokes: Stroke[];
}

/** An empty sketch (a blank bark). */
export function emptySketch(): Sketch {
  return { strokes: [] };
}

/** True when a sketch has at least one stroke with at least one drawn point (a real drawing). */
export function isDrawn(sketch: Sketch): boolean {
  return sketch.strokes.some((stroke) => stroke.points.length >= 2);
}

function clampCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(CANVAS_SIZE, Math.round(value)));
}

function isColor(value: unknown, allowed: ReadonlySet<string>): value is string {
  return typeof value === 'string' && allowed.has(value);
}

/**
 * Coerce one raw stroke into a bounded, validated {@link Stroke}, or null when it is unusable. Points
 * are clamped to the logical canvas and truncated to {@link MAX_POINTS_PER_STROKE} (a whole even
 * count, so no dangling x with no y). A stroke whose color is not in `allowed`, or with fewer than
 * two coordinates (no drawn point), is a null - it is dropped by {@link parseSketch}. `allowed` is
 * the set of colors a stroke may use: the drawing player's own palette when the engine validates a
 * submission, so an off-palette color is dropped rather than trusted.
 */
function coerceStroke(raw: unknown, allowed: ReadonlySet<string>): Stroke | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { color, points } = raw as { color?: unknown; points?: unknown };
  if (!isColor(color, allowed) || !Array.isArray(points)) return null;
  // Truncate to an even count so points always pair into (x, y). Cap the length up front.
  const capped = points.slice(0, MAX_POINTS_PER_STROKE);
  const even = capped.length - (capped.length % 2);
  const coords: number[] = [];
  for (let i = 0; i < even; i++) coords.push(clampCoord(capped[i] as number));
  if (coords.length < 2) return null;
  return { color, points: coords };
}

/**
 * Serialize a sketch to the compact JSON string carried on the move channel. Only the color + points
 * of each stroke are emitted, so the wire form stays minimal.
 */
export function serializeSketch(sketch: Sketch): string {
  return JSON.stringify({
    strokes: sketch.strokes.map((stroke) => ({ color: stroke.color, points: stroke.points })),
  });
}

/**
 * Parse a move-channel string back into a bounded {@link Sketch}, or null when it is not a sketch at
 * all (malformed JSON / wrong shape). Every stroke is clamped + validated; unusable strokes are
 * dropped; the stroke count is capped at {@link MAX_STROKES} and the total point count at
 * {@link MAX_TOTAL_POINTS} (later strokes past the cap are dropped). A well-formed but empty sketch
 * parses to `{ strokes: [] }` (the caller decides whether an empty sketch is acceptable).
 *
 * `allowed` is the set of colors a stroke may use. The engine passes the DRAWING PLAYER's own
 * palette colors, so a client that sends an off-palette color has that stroke DROPPED - this is the
 * server-authoritative per-player palette enforcement. It defaults to the union of every palette's
 * colors ({@link ALL_PALETTE_COLORS}) for the lenient case (replaying a stored sketch that may use
 * any player's palette), where the strict per-player check has already happened at collection.
 */
export function parseSketch(
  raw: string,
  allowed: ReadonlySet<string> = ALL_PALETTE_COLORS,
): Sketch | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const strokesRaw = (value as { strokes?: unknown }).strokes;
  if (!Array.isArray(strokesRaw)) return null;

  const strokes: Stroke[] = [];
  let totalPoints = 0;
  for (const rawStroke of strokesRaw) {
    if (strokes.length >= MAX_STROKES) break;
    const stroke = coerceStroke(rawStroke, allowed);
    if (!stroke) continue;
    if (totalPoints + stroke.points.length > MAX_TOTAL_POINTS) break;
    totalPoints += stroke.points.length;
    strokes.push(stroke);
  }
  return { strokes };
}
