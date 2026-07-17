// The Sketchy sketch stroke format (spec 0063): a compact, serializable vector drawing captured on a
// canvas and replayed read-only in the viewer. A sketch is an array of strokes; each stroke is a
// color plus a flat array of integer point coordinates `[x0, y0, x1, y1, ...]` on a fixed logical
// canvas (0..CANVAS_SIZE on each axis), so the format is resolution-independent and small. The move
// channel carries the sketch as a JSON string; the engine parses + bounds it (so a submission can
// never be unbounded) and the web replays it by scaling the logical coordinates to the rendered size.
//
// Kept deliberately minimal: no pressure, no timing, no bezier smoothing - a straight polyline per
// stroke is enough to read a doodle and is trivial to round-trip and to unit test.

/** The fixed logical extent of the drawing surface on each axis. Points are clamped to [0, SIZE]. */
export const CANVAS_SIZE = 1000;

/** Bounds so a submitted sketch can never be unbounded (a hostile or runaway client is capped). */
export const MAX_STROKES = 400;
export const MAX_POINTS_PER_STROKE = 1000;
export const MAX_TOTAL_POINTS = 20_000;

/** The small fixed palette a player draws with. The first entry is the default twig color. */
export const STROKE_COLORS = ['#0d0a15', '#d2a463', '#7c3aed', '#ec4899', '#22c55e'] as const;

export type StrokeColor = (typeof STROKE_COLORS)[number];

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

function isColor(value: unknown): value is string {
  return typeof value === 'string' && (STROKE_COLORS as readonly string[]).includes(value);
}

/**
 * Coerce one raw stroke into a bounded, validated {@link Stroke}, or null when it is unusable. Points
 * are clamped to the logical canvas and truncated to {@link MAX_POINTS_PER_STROKE} (a whole even
 * count, so no dangling x with no y). A stroke with fewer than two coordinates (no drawn point) is a
 * null - it is dropped by {@link parseSketch}.
 */
function coerceStroke(raw: unknown): Stroke | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { color, points } = raw as { color?: unknown; points?: unknown };
  if (!isColor(color) || !Array.isArray(points)) return null;
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
 */
export function parseSketch(raw: string): Sketch | null {
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
    const stroke = coerceStroke(rawStroke);
    if (!stroke) continue;
    if (totalPoints + stroke.points.length > MAX_TOTAL_POINTS) break;
    totalPoints += stroke.points.length;
    strokes.push(stroke);
  }
  return { strokes };
}
