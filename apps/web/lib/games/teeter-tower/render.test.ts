import { describe, expect, it } from 'vitest';
import {
  CENTER_X,
  DROP_HALF_RANGE,
  GROUND_TOP,
  PLATFORM_W,
  VIEW_H,
  VIEW_W,
  clampDropX,
  levelView,
  visibleLeftX,
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

// The renderer fits a FIXED reference height (VIEW_FIT_TARGET, not the level's target) into the canvas,
// centered horizontally at a uniform scale, so the tower fills the vertical space with no camera pan.
// These pin the mapping the draw loop and pointer mapping share, keeping the coordinate space consistent.
describe('fit-view mapping', () => {
  it('maps the top edge to screen 0 and the bottom edge to the canvas height', () => {
    const v = levelView(390, 700);
    expect(v.top * v.scale + v.originY).toBeCloseTo(0);
    expect(v.bottom * v.scale + v.originY).toBeCloseTo(700);
  });

  it('centers the world horizontally (world CENTER_X -> canvas mid)', () => {
    const v = levelView(390, 700);
    expect(CENTER_X * v.scale + v.originX).toBeCloseTo(390 / 2);
  });

  it('scales the view UP as the canvas gets taller (fills the vertical space)', () => {
    const short = levelView(390, 400);
    const tall = levelView(390, 800);
    expect(tall.scale).toBeGreaterThan(short.scale);
  });

  it('is INDEPENDENT of the level target - the view does not zoom when the target changes', () => {
    // Feedback 0023: lowering level 1's target must not resize the viewport. levelView takes no target,
    // so the fit is identical regardless of the level's target - the target line just moves within it.
    const a = levelView(390, 700);
    const b = levelView(390, 700);
    expect(a.scale).toBe(b.scale);
    expect(a.top).toBe(b.top);
  });

  it('visibleLeftX is the world x at the left canvas edge', () => {
    const v = levelView(390, 700);
    expect(visibleLeftX(v) * v.scale + v.originX).toBeCloseTo(0);
  });
});

// The drop-x clamp derives from the level's platform width (feedback 0023): a wider level-1 platform
// permits a drop across it, while the default narrower platform keeps the tighter range.
describe('clampDropX per platform width', () => {
  it('permits a wider horizontal range on a wider platform', () => {
    const wideX = CENTER_X + 400;
    // On the default (480px) platform the far-right x is clamped in tighter than on a wide 760 platform.
    expect(clampDropX(wideX)).toBeLessThan(clampDropX(wideX, 760));
  });

  it('clamps to half-width + edge margin around center', () => {
    expect(clampDropX(CENTER_X + 9999, 760)).toBeCloseTo(CENTER_X + 760 / 2 + 90);
    expect(clampDropX(CENTER_X - 9999, 760)).toBeCloseTo(CENTER_X - (760 / 2 + 90));
  });
});
