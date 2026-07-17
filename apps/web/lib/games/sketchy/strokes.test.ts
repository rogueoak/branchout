import { describe, expect, it } from 'vitest';
import {
  STROKE_COLORS,
  emptySketch,
  isDrawn,
  parseSketch,
  serializeSketch,
  type Sketch,
} from './strokes';

describe('web stroke serialize/replay round-trip', () => {
  it('round-trips a sketch through serialize + parse', () => {
    const sketch: Sketch = {
      strokes: [{ color: STROKE_COLORS[1], points: [1, 2, 3, 4, 5, 6] }],
    };
    expect(parseSketch(serializeSketch(sketch))).toEqual(sketch);
  });

  it('parses an already-parsed object as well as a JSON string', () => {
    const obj = { strokes: [{ color: STROKE_COLORS[0], points: [0, 0, 10, 10] }] };
    expect(parseSketch(obj)).toEqual(obj);
    expect(parseSketch(JSON.stringify(obj))).toEqual(obj);
  });

  it('returns null for malformed input and drops unknown colors', () => {
    expect(parseSketch('nope')).toBeNull();
    expect(parseSketch(42)).toBeNull();
    expect(parseSketch({ strokes: [{ color: '#123456', points: [1, 2] }] })).toEqual({
      strokes: [],
    });
  });

  it('isDrawn reflects whether any stroke has a point pair', () => {
    expect(isDrawn(emptySketch())).toBe(false);
    expect(isDrawn({ strokes: [{ color: STROKE_COLORS[0], points: [1, 2] }] })).toBe(true);
  });
});
