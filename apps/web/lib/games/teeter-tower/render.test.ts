import { describe, expect, it } from 'vitest';
import {
  CENTER_X,
  DROP_HALF_RANGE,
  GROUND_TOP,
  PLATFORM_W,
  VIEW_H,
  VIEW_W,
  viewScale,
  visibleWorldHeight,
} from './render';
import { TEETER_TOTAL_ROUNDS } from './index';

// The browser is a pure renderer that mirrors the engine's world constants by hand (the web bundle
// deliberately does NOT depend on the headless physics package @branchout/game-teeter-tower - see the
// note in index.ts). This guard pins the mirrored constants to the engine's source-of-truth values so
// a drift is caught here instead of as a subtly wrong on-screen coordinate space.
//
// Source of truth: packages/games/teeter-tower/src/levels.ts (world constants) and TOTAL_ROUNDS.
describe('render world constants mirror the engine (packages/games/teeter-tower/src/levels.ts)', () => {
  it('matches the engine VIEW/GROUND/CENTER/platform constants', () => {
    expect(VIEW_W).toBe(820);
    expect(VIEW_H).toBe(620);
    expect(GROUND_TOP).toBe(540);
    expect(PLATFORM_W).toBe(480);
    expect(CENTER_X).toBe(410); // VIEW_W / 2
    expect(DROP_HALF_RANGE).toBe(PLATFORM_W / 2 + 90); // 330
  });

  it('matches the engine TOTAL_ROUNDS (11 + 20 + 22 piece budgets)', () => {
    expect(TEETER_TOTAL_ROUNDS).toBe(53);
  });
});

// The renderer fits the world to WIDTH (not letterboxed), so a taller canvas reveals more of the
// upward-growing tower. These pin the scale + visible-world-height helpers the draw loop, camera, and
// pointer mapping all share, keeping the on-screen coordinate space consistent across them.
describe('fit-width view mapping', () => {
  it('scales the world by width / VIEW_W', () => {
    expect(viewScale(VIEW_W)).toBe(1);
    expect(viewScale(VIEW_W / 2)).toBe(0.5);
    expect(viewScale(360)).toBeCloseTo(360 / VIEW_W);
  });

  it('shows exactly VIEW_H of world when the canvas is at the VIEW aspect ratio', () => {
    expect(visibleWorldHeight(VIEW_W, VIEW_H)).toBeCloseTo(VIEW_H);
  });

  it('reveals MORE vertical world as the canvas gets taller (no letterbox)', () => {
    const shortH = visibleWorldHeight(VIEW_W, VIEW_H);
    const tallH = visibleWorldHeight(VIEW_W, VIEW_H * 2);
    expect(tallH).toBeGreaterThan(shortH);
    expect(tallH).toBeCloseTo(VIEW_H * 2);
  });
});
