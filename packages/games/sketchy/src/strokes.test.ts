import { describe, expect, it } from 'vitest';
import {
  CANVAS_SIZE,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  MAX_TOTAL_POINTS,
  STROKE_COLORS,
  emptySketch,
  isDrawn,
  parseSketch,
  serializeSketch,
  type Sketch,
} from './strokes';

describe('stroke serialize/replay round-trip', () => {
  it('round-trips a multi-stroke sketch unchanged', () => {
    const sketch: Sketch = {
      strokes: [
        { color: STROKE_COLORS[0], points: [10, 20, 30, 40, 50, 60] },
        { color: STROKE_COLORS[1], points: [0, 0, 100, 100] },
      ],
    };
    const round = parseSketch(serializeSketch(sketch));
    expect(round).toEqual(sketch);
  });

  it('an empty sketch round-trips to an empty sketch', () => {
    expect(parseSketch(serializeSketch(emptySketch()))).toEqual({ strokes: [] });
  });

  it('isDrawn is false for empty and true once a stroke has a point pair', () => {
    expect(isDrawn(emptySketch())).toBe(false);
    expect(isDrawn({ strokes: [{ color: STROKE_COLORS[0], points: [1, 2] }] })).toBe(true);
    // A stroke with a single dangling coordinate is not a drawn point.
    expect(isDrawn({ strokes: [{ color: STROKE_COLORS[0], points: [1] }] })).toBe(false);
  });
});

describe('parseSketch bounding + validation', () => {
  it('returns null for malformed JSON or the wrong shape', () => {
    expect(parseSketch('not json')).toBeNull();
    expect(parseSketch('42')).toBeNull();
    expect(parseSketch('{}')).toBeNull();
    expect(parseSketch('{"strokes":"nope"}')).toBeNull();
  });

  it('drops strokes with an unknown color and clamps coordinates to the canvas', () => {
    const raw = JSON.stringify({
      strokes: [
        { color: '#ff0000', points: [1, 2, 3, 4] }, // not in the palette -> dropped
        { color: STROKE_COLORS[2], points: [-50, 20, 5000, 40] }, // clamped to [0, SIZE]
      ],
    });
    const parsed = parseSketch(raw);
    expect(parsed).toEqual({
      strokes: [{ color: STROKE_COLORS[2], points: [0, 20, CANVAS_SIZE, 40] }],
    });
  });

  it('truncates an odd point count to a whole (x, y) pair count', () => {
    const raw = JSON.stringify({ strokes: [{ color: STROKE_COLORS[0], points: [1, 2, 3] }] });
    expect(parseSketch(raw)).toEqual({ strokes: [{ color: STROKE_COLORS[0], points: [1, 2] }] });
  });

  it('caps the stroke count at MAX_STROKES', () => {
    const strokes = Array.from({ length: MAX_STROKES + 10 }, () => ({
      color: STROKE_COLORS[0],
      points: [1, 2],
    }));
    const parsed = parseSketch(JSON.stringify({ strokes }));
    expect(parsed?.strokes.length).toBe(MAX_STROKES);
  });

  it('caps points-per-stroke at MAX_POINTS_PER_STROKE', () => {
    const points = Array.from({ length: MAX_POINTS_PER_STROKE + 100 }, (_, i) => i % CANVAS_SIZE);
    const parsed = parseSketch(JSON.stringify({ strokes: [{ color: STROKE_COLORS[0], points }] }));
    // Truncated to the cap, then to an even count (the cap is even).
    expect(parsed?.strokes[0]?.points.length).toBeLessThanOrEqual(MAX_POINTS_PER_STROKE);
  });

  it('caps the total point count across strokes at MAX_TOTAL_POINTS', () => {
    const strokes = Array.from({ length: 100 }, () => ({
      color: STROKE_COLORS[0],
      points: Array.from({ length: 500 }, (_, i) => i % CANVAS_SIZE),
    }));
    const parsed = parseSketch(JSON.stringify({ strokes }));
    const total = parsed!.strokes.reduce((sum, s) => sum + s.points.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_POINTS);
  });
});
