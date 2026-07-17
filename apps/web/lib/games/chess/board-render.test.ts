import { describe, expect, it } from 'vitest';
import { cellAt, cellBox, decodePiece, glyphFor, layoutBoard } from './board-render';

// The Chess chrome re-exports the shared geometry (tested in ../board/geometry.test.ts) and adds the
// piece decode + glyph. These tests cover the Chess-specific helpers and confirm the geometry re-export
// round-trips (a tap maps to the cell the draw loop paints).

describe('board geometry re-export', () => {
  it('the center of a cell box hit-tests back to that cell', () => {
    const layout = layoutBoard(400, 400, 8);
    for (const [row, col] of [
      [0, 0],
      [3, 5],
      [7, 7],
    ] as const) {
      const box = cellBox(layout, row, col);
      const hit = cellAt(layout, box.x + box.size / 2, box.y + box.size / 2);
      expect(hit).toEqual({ row, col });
    }
  });
});

describe('decodePiece', () => {
  it('decodes a piece cell into color + type', () => {
    expect(decodePiece('wK')).toEqual({ color: 'w', type: 'K' });
    expect(decodePiece('bP')).toEqual({ color: 'b', type: 'P' });
  });

  it('returns null for an empty square', () => {
    expect(decodePiece('empty')).toBeNull();
  });
});

describe('glyphFor', () => {
  it('gives a distinct glyph for each piece type', () => {
    const glyphs = new Set(['K', 'Q', 'R', 'B', 'N', 'P'].map((t) => glyphFor(t as never)));
    expect(glyphs.size).toBe(6);
  });
});
