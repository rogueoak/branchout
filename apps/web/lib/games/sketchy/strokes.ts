// The Sketchy stroke format on the web (spec 0063), mirrored from the engine package so the browser
// captures + replays the same compact serializable shape without importing the engine bundle. A
// sketch is `{ strokes: Stroke[] }`; a stroke is a palette color plus a flat `[x0, y0, x1, y1, ...]`
// array of integer coordinates on a fixed logical canvas (0..CANVAS_SIZE). The Remote captures
// pointer moves into this shape and serializes it onto the move channel; the Viewer/Remote scale the
// logical coordinates to the rendered size and replay each stroke read-only.

export const CANVAS_SIZE = 1000;
export const MAX_STROKES = 400;
export const MAX_POINTS_PER_STROKE = 1000;

/** The small fixed palette a player draws with. The first entry is the default twig color. */
export const STROKE_COLORS = ['#0d0a15', '#d2a463', '#7c3aed', '#ec4899', '#22c55e'] as const;

export type StrokeColor = (typeof STROKE_COLORS)[number];

export interface Stroke {
  color: string;
  points: number[];
}

export interface Sketch {
  strokes: Stroke[];
}

export function emptySketch(): Sketch {
  return { strokes: [] };
}

/** True when a sketch has at least one stroke with a drawn point pair. */
export function isDrawn(sketch: Sketch): boolean {
  return sketch.strokes.some((stroke) => stroke.points.length >= 2);
}

/** Serialize a sketch to the compact JSON string carried on the move channel. */
export function serializeSketch(sketch: Sketch): string {
  return JSON.stringify({
    strokes: sketch.strokes.map((stroke) => ({ color: stroke.color, points: stroke.points })),
  });
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && (STROKE_COLORS as readonly string[]).includes(value);
}

/** Parse a serialized sketch back to strokes for read-only replay, or null when malformed. */
export function parseSketch(raw: unknown): Sketch | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const strokesRaw = (value as { strokes?: unknown }).strokes;
  if (!Array.isArray(strokesRaw)) return null;
  const strokes: Stroke[] = [];
  for (const rawStroke of strokesRaw) {
    if (typeof rawStroke !== 'object' || rawStroke === null) continue;
    const { color, points } = rawStroke as { color?: unknown; points?: unknown };
    if (!isColor(color) || !Array.isArray(points)) continue;
    const coords = points.filter((n): n is number => typeof n === 'number');
    const even = coords.slice(0, coords.length - (coords.length % 2));
    if (even.length < 2) continue;
    strokes.push({ color, points: even });
  }
  return { strokes };
}
