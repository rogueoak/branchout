import { describe, expect, it } from 'vitest';
import { cellAt, cellBox, layoutBoard, resolveBoardChrome } from './board-render';

// Pure geometry tests for the reusable board renderer helper (spec 0054). The canvas draw loop is not
// jsdom-runnable, but the layout + hit-test math is - and it is the correctness-critical part (a tap
// must map to the same cell the draw loop paints). This math is shared by Checkers/Chess.

describe('layoutBoard', () => {
  it('fits a square board centered in a wide box', () => {
    // 200 wide, 100 tall, 8x8, margin 8: the board fits the HEIGHT (min axis), 100 - 16 = 84 px.
    const layout = layoutBoard(200, 100, 8, 8);
    expect(layout.cell).toBeCloseTo(84 / 8);
    expect(layout.size).toBe(8);
    // Centered: the board (84px) sits centered in 200 wide and 100 tall.
    expect(layout.originX).toBeCloseTo((200 - 84) / 2);
    expect(layout.originY).toBeCloseTo((100 - 84) / 2);
  });

  it('fits a square board centered in a tall box (fits the width)', () => {
    const layout = layoutBoard(100, 200, 8, 8);
    expect(layout.cell).toBeCloseTo(84 / 8);
    expect(layout.originX).toBeCloseTo((100 - 84) / 2);
  });
});

describe('cellBox + cellAt round-trip', () => {
  it('the center of a cell box hit-tests back to that cell', () => {
    const layout = layoutBoard(400, 400, 8);
    for (const [row, col] of [
      [0, 0],
      [3, 4],
      [7, 7],
      [2, 6],
    ] as const) {
      const box = cellBox(layout, row, col);
      const hit = cellAt(layout, box.x + box.size / 2, box.y + box.size / 2);
      expect(hit).toEqual({ row, col });
    }
  });

  it('a tap outside the grid returns null', () => {
    const layout = layoutBoard(400, 400, 8);
    // Above/left of the origin.
    expect(cellAt(layout, layout.originX - 5, layout.originY - 5)).toBeNull();
    // Past the far edge.
    const far = layout.originX + layout.cell * 8 + 5;
    expect(cellAt(layout, far, far)).toBeNull();
  });

  it('a zero-size board hit-tests to null (no divide-by-zero)', () => {
    const layout = layoutBoard(0, 0, 8);
    expect(cellAt(layout, 0, 0)).toBeNull();
  });
});

describe('resolveBoardChrome', () => {
  it('falls back to on-brand colors when no element / no window styles', () => {
    const chrome = resolveBoardChrome(null);
    // Violet discs from the grape ramp, Amber from sunbeam - concrete strings for the canvas.
    expect(chrome.violet).toMatch(/^#/);
    expect(chrome.amber).toMatch(/^#/);
    expect(chrome.light).toMatch(/^#/);
    expect(chrome.dark).toMatch(/^#/);
  });
});
