// The Sketchy stroke format on the web (spec 0063), mirrored from the engine package so the browser
// captures + replays the same compact serializable shape without importing the engine bundle. A
// sketch is `{ strokes: Stroke[] }`; a stroke is a palette color plus a flat `[x0, y0, x1, y1, ...]`
// array of integer coordinates on a fixed logical canvas (0..CANVAS_SIZE). The Remote captures
// pointer moves into this shape and serializes it onto the move channel; the Viewer/Remote scale the
// logical coordinates to the rendered size and replay each stroke read-only.

import { ALL_PALETTE_COLORS } from '@branchout/protocol';

export const CANVAS_SIZE = 1000;
export const MAX_STROKES = 400;
export const MAX_POINTS_PER_STROKE = 1000;

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

// Replay accepts any palette's colors: a sketch on screen may have been drawn by any player, each
// with their own palette (spec 0063), so the browser's read-only replay validates against the union
// of every palette color, not one player's three. The strict per-player check is the engine's, at
// collection time.
function isColor(value: unknown): value is string {
  return typeof value === 'string' && ALL_PALETTE_COLORS.has(value);
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
